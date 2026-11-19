'use strict';
// Persistent, key-free memory of how each model has actually behaved.
//
// Free gateways are unreliable in a very specific way: a model answers fine
// for a while, then quietly stops streaming mid-answer. Retrying the same
// model wastes minutes, so CAELIX remembers which models stalled recently and
// prefers the ones that finished. Nothing sensitive is stored here — only a
// provider id, a model id, counters and timings.

const fs = require('fs');
const path = require('path');

const FILE = 'model-health.json';
const NEUTRAL = 70;
const DEMOTE_STALLS = 2;
const DEMOTE_WINDOW_MS = 30 * 60_000;
const MAX_ENTRIES = 500;
const EXPIRE_MS = 30 * 24 * 60 * 60_000;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function keyOf(provider, model) {
  return `${provider || 'unknown'}:${model || 'default'}`;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

class ModelHealth {
  constructor(dir, options = {}) {
    this.dir = dir || null;
    this.file = dir ? path.join(dir, FILE) : null;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.entries = new Map();
    this.load();
  }

  load() {
    if (!this.file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [key, value] of Object.entries(raw?.entries || {})) {
        if (value && typeof value === 'object') this.entries.set(key, { ...value });
      }
    } catch {
      // A missing or unreadable file just means "no history yet".
    }
  }

  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const cutoff = this.now() - EXPIRE_MS;
      const entries = {};
      const keys = [...this.entries.entries()]
        .filter(([, value]) => (value.lastAt || 0) >= cutoff)
        .sort((a, b) => (b[1].lastAt || 0) - (a[1].lastAt || 0))
        .slice(0, MAX_ENTRIES);
      for (const [key, value] of keys) entries[key] = value;
      fs.writeFileSync(this.file, JSON.stringify({ version: 1, entries }, null, 2));
    } catch {
      // Health is an optimisation: never fail a turn because it could not write.
    }
  }

  entry(provider, model, create = false) {
    const key = keyOf(provider, model);
    let value = this.entries.get(key);
    if (!value && create) {
      value = {
        ok: 0,
        fail: 0,
        stalls: 0,
        consecutiveStalls: 0,
        samples: 0,
        lastAt: 0,
        lastStallAt: 0,
        lastError: '',
        totalMs: 0,
        ttfbMs: 0,
      };
      this.entries.set(key, value);
    }
    return value || null;
  }

  /**
   * Record what a single request did.
   * ok: finished with text or tool calls. stall: went silent. error: anything else.
   */
  record(provider, model, outcome = {}) {
    if (!provider || !model) return null;
    const value = this.entry(provider, model, true);
    const at = this.now();
    value.lastAt = at;
    if (outcome.ok) {
      value.ok += 1;
      value.consecutiveStalls = 0;
      if (Number.isFinite(outcome.elapsedMs)) {
        value.samples += 1;
        value.totalMs = Math.round(((value.totalMs || 0) * (value.samples - 1) + outcome.elapsedMs) / value.samples);
      }
      if (Number.isFinite(outcome.ttfbMs) && outcome.ttfbMs > 0) {
        value.ttfbMs = Math.round(((value.ttfbMs || 0) * Math.max(0, value.samples - 1) + outcome.ttfbMs) / Math.max(1, value.samples));
      }
    } else {
      value.fail += 1;
      if (outcome.stall) {
        value.stalls += 1;
        value.consecutiveStalls += 1;
        value.lastStallAt = at;
      } else {
        // A rate limit or auth error says nothing about model reliability, so
        // it must not push a model down the list.
        value.consecutiveStalls = 0;
      }
      if (outcome.error) value.lastError = String(outcome.error).slice(0, 160);
    }
    this.save();
    return value;
  }

  /**
   * 0..100. 70 means "unknown". Recent stalls pull a model down hard, recent
   * finishes pull it back up, and old history fades toward neutral.
   */
  score(provider, model) {
    const value = this.entry(provider, model);
    if (!value) return NEUTRAL;
    let score = NEUTRAL + value.ok * 6 - value.fail * 10 - value.stalls * 18
      - value.consecutiveStalls * 22;
    if (value.samples > 0 && value.totalMs > 0 && value.totalMs < 10_000 && value.consecutiveStalls === 0) {
      score += 3;
    }
    score = clamp(score, 0, 100);
    const ageH = Math.max(0, (this.now() - (value.lastAt || this.now())) / 3_600_000);
    const fade = clamp(ageH / 12, 0, 1);
    return Math.round(score * (1 - fade) + NEUTRAL * fade);
  }

  stats(provider, model) {
    return this.entry(provider, model);
  }

  isDemoted(provider, model) {
    const value = this.entry(provider, model);
    if (!value) return false;
    if (value.consecutiveStalls < DEMOTE_STALLS) return false;
    return this.now() - (value.lastStallAt || 0) <= DEMOTE_WINDOW_MS;
  }

  /** Higher score first, stable for equal scores; unknown models stay neutral. */
  rank(provider, models = []) {
    return [...models].sort((a, b) => {
      const diff = this.score(provider, b) - this.score(provider, a);
      return diff !== 0 ? diff : models.indexOf(a) - models.indexOf(b);
    });
  }

  /** Median of observed durations, used for "is this model unusually slow". */
  typicalMs(provider, model) {
    const value = this.entry(provider, model);
    return value && value.samples ? value.totalMs / value.samples : 0;
  }

  summary() {
    const rows = [...this.entries.entries()].map(([key, value]) => ({
      key,
      score: this.score(...key.split(':', 2)),
      stalls: value.stalls,
      consecutiveStalls: value.consecutiveStalls,
      ok: value.ok,
      fail: value.fail,
    }));
    return rows.sort((a, b) => b.score - a.score);
  }

  reset() {
    this.entries.clear();
    if (this.file) {
      try { fs.rmSync(this.file, { force: true }); } catch { /* ignore */ }
    }
  }
}

module.exports = { ModelHealth, keyOf, median, NEUTRAL, DEMOTE_STALLS, DEMOTE_WINDOW_MS };
