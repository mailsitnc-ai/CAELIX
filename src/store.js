'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { safeStorage } = require('electron');

function atomicWrite(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

class KeyStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'keys.enc');
    this.keys = {};
    this.lastError = null;
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is not available');
      const raw = safeStorage.decryptString(fs.readFileSync(this.file));
      this.keys = JSON.parse(raw);
    } catch (error) {
      this.lastError = error.message;
      this.keys = {};
    }
  }

  persist() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('The macOS keychain is unavailable, so CAELIX will not store keys.');
    }
    const payload = safeStorage.encryptString(JSON.stringify(this.keys));
    atomicWrite(this.file, payload, 0o600);
  }

  static parseKeys(raw) {
    const parts = String(raw || '')
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) throw new Error('That key looks too short.');
    const clean = [];
    const seen = new Set();
    for (const part of parts) {
      if (part.length < 8) throw new Error('Each API key must be at least 8 characters.');
      if (!seen.has(part)) {
        seen.add(part);
        clean.push(part);
      }
      if (clean.length >= 12) break;
    }
    return clean;
  }

  list(provider) {
    const entry = this.keys[provider];
    if (!entry) return [];
    const raw = Array.isArray(entry) ? entry : [entry];
    const clean = [];
    const seen = new Set();
    for (const item of raw) {
      const value = String(item || '').trim();
      if (value.length >= 8 && !seen.has(value)) {
        seen.add(value);
        clean.push(value);
      }
    }
    return clean;
  }

  set(provider, key) {
    const parsed = KeyStore.parseKeys(key);
    this.keys[provider] = parsed.length === 1 ? parsed[0] : parsed;
    this.persist();
    return parsed.length;
  }

  add(provider, key) {
    const incoming = KeyStore.parseKeys(key);
    const merged = [...this.list(provider)];
    const seen = new Set(merged);
    for (const item of incoming) {
      if (!seen.has(item) && merged.length < 12) {
        seen.add(item);
        merged.push(item);
      }
    }
    this.keys[provider] = merged.length === 1 ? merged[0] : merged;
    this.persist();
    return merged.length;
  }

  get(provider, index = 0) {
    const pool = this.list(provider);
    if (!pool.length) return null;
    return pool[index % pool.length];
  }

  removeAt(provider, index) {
    const pool = this.list(provider);
    if (index < 0 || index >= pool.length) return;
    pool.splice(index, 1);
    if (!pool.length) delete this.keys[provider];
    else this.keys[provider] = pool.length === 1 ? pool[0] : pool;
    this.persist();
  }

  delete(provider) {
    if (!this.keys[provider]) return;
    delete this.keys[provider];
    this.persist();
  }

  masks(provider) {
    return this.list(provider).map((key) => `${'\u2022'.repeat(8)}${key.slice(-4)}`);
  }

  masked(provider) {
    const all = this.masks(provider);
    if (!all.length) return null;
    if (all.length === 1) return all[0];
    return `${all[0]} (${all.length} keys)`;
  }

  status() {
    return Object.keys(this.keys)
      .filter((provider) => this.list(provider).length > 0)
      .map((provider) => {
        const masks = this.masks(provider);
        return {
          provider,
          configured: true,
          count: masks.length,
          masks,
          masked: this.masked(provider),
        };
      });
  }
}

class SessionStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'sessions.json');
    this.data = readJson(this.file, { activeId: null, sessions: [] });
    if (!Array.isArray(this.data.sessions)) this.data.sessions = [];
  }

  persist() {
    atomicWrite(this.file, JSON.stringify(this.data, null, 2));
  }

  list() {
    return {
      activeId: this.data.activeId,
      sessions: this.data.sessions
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(({ id, title, cwd, surface, provider, model, mode, updatedAt, createdAt }) => ({
          id, title, cwd, surface: surface || null, provider, model, mode, updatedAt, createdAt,
        })),
    };
  }

  normalizeChatSurfaceCwd(chatDir) {
    if (!chatDir) return false;
    let changed = false;
    for (const s of this.data.sessions) {
      if (s.surface === 'chat' && s.cwd !== chatDir) {
        s.cwd = chatDir;
        changed = true;
      }
    }
    if (changed) this.persist();
    return changed;
  }

  get(id) {
    return this.data.sessions.find((session) => session.id === id) || null;
  }

  active() {
    return this.get(this.data.activeId) || null;
  }

  create(input = {}) {
    const now = Date.now();
    const session = {
      id: `chat_${crypto.randomUUID()}`,
      title: input.title || 'New chat',
      cwd: input.cwd || os.homedir(),
      surface: input.surface === 'chat' ? 'chat' : (input.surface === 'code' ? 'code' : null),
      provider: input.provider || 'gemini',
      model: input.model || 'gemini-2.5-flash',
      mode: input.mode || 'ask',
      contextOffset: 0,
      messages: [],
      changes: [],
      terminal: [],
      todos: [],
      createdAt: now,
      updatedAt: now,
    };
    this.data.sessions.push(session);
    this.data.activeId = session.id;
    this.persist();
    return session;
  }

  update(id, patch) {
    const session = this.get(id);
    if (!session) return null;
    Object.assign(session, patch, { updatedAt: Date.now() });
    this.persist();
    return session;
  }

  rename(id, title) {
    const clean = String(title || '').trim().slice(0, 120);
    if (!clean) return null;
    return this.update(id, { title: clean });
  }

  remove(id) {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((session) => session.id !== id);
    if (this.data.activeId === id) {
      const remaining = this.data.sessions
        .slice()
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      this.data.activeId = remaining[0] ? remaining[0].id : null;
    }
    if (this.data.sessions.length !== before) this.persist();
    return this.list();
  }

  setActive(id) {
    if (!this.get(id)) return null;
    this.data.activeId = id;
    this.persist();
    return this.get(id);
  }

  appendMessage(id, message) {
    const session = this.get(id);
    if (!session) return null;
    session.messages.push(message);
    session.updatedAt = Date.now();
    this.persist();
    return message;
  }

  saveTurn(id, messages, extra = {}) {
    const session = this.get(id);
    if (!session) return null;
    session.messages.push(...messages);
    if (extra.changes) session.changes.push(...extra.changes);
    if (extra.terminal) session.terminal.push(...extra.terminal);
    if (extra.todos) session.todos = extra.todos;
    session.updatedAt = Date.now();
    this.persist();
    return session;
  }
}

class SettingsStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'settings.json');
    this.data = readJson(this.file, {});
  }

  get(key, fallback) {
    return this.data[key] === undefined ? fallback : this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    atomicWrite(this.file, JSON.stringify(this.data, null, 2));
    return value;
  }
}

module.exports = { KeyStore, SessionStore, SettingsStore };
