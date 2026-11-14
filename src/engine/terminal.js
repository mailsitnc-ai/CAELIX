'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');

const MAX_ENTRIES = 500;
const DEFAULT_TIMEOUT = 120000;

class ShellTab {
  constructor({ id, title, cwd, emit, history, sessionId }) {
    this.id = id;
    this.title = title;
    this.cwd = cwd;
    this.emit = emit;
    this.sessionId = sessionId;
    this.entries = Array.isArray(history)
      ? history.slice(-MAX_ENTRIES).map((item) => ({ text: String(item.text || ''), at: item.at || Date.now() }))
      : [];
    this.busy = false;
    this.pending = null;
    this.closed = false;

    this.child = spawn('/bin/zsh', ['-f'], {
      cwd,
      env: {
        ...process.env,
        CAELIX: '1',
        TERM: 'dumb',
        PS1: '',
        PROMPT: '',
        RPROMPT: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk) => this.consume(chunk));
    this.child.stderr.on('data', (chunk) => this.consume(chunk));
    this.child.on('error', (error) => {
      this.push(`\n[terminal error] ${error.message}\n`);
      this.finishRun(null, error);
    });
    this.child.on('close', (code) => {
      this.closed = true;
      this.push(`\n[shell exited with code ${code ?? 0}]\n`);
      const error = new Error(`The shell exited with code ${code ?? 0}.`);
      this.finishRun(null, error);
    });
  }

  push(text) {
    if (!text) return;
    this.entries.push({ text, at: Date.now() });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.emit({ type: 'terminal-output', sessionId: this.sessionId, tabId: this.id, text });
  }

  consume(chunk) {
    const text = chunk.toString();
    if (!this.pending) {
      this.push(text);
      return;
    }
    this.pending.raw += text;
    const marker = `__CAELIX_DONE_${this.pending.token}__`;
    const index = this.pending.raw.indexOf(marker);
    if (index === -1) {
      this.pending.collected += text;
      this.push(text);
      return;
    }
    const before = this.pending.raw.slice(0, index);
    const after = this.pending.raw.slice(index);
    const match = after.match(/^__CAELIX_DONE_[a-z0-9_]+__(\d+)/i);
    this.pending.collected += before;
    this.push(before);
    this.finishRun(match ? Number(match[1]) : null, null);
  }

  finishRun(exitCode, error) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.busy = false;
    clearTimeout(pending.timer);
    pending.raw = '';
    if (error) pending.reject(error);
    else pending.resolve({ id: this.id, exitCode, output: pending.collected });
  }

  run(command, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
    if (this.closed) throw new Error('This terminal has exited. Open a new one.');
    if (this.busy) throw new Error('This terminal is still running a command.');
    const text = String(command || '');
    if (!text.trim()) throw new Error('The command is empty.');
    const token = `t${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    this.busy = true;
    this.entries.push({ text: `\n$ ${text}\n`, at: Date.now() });
    this.emit({ type: 'terminal-output', sessionId: this.sessionId, tabId: this.id, text: `\n$ ${text}\n` });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.busy = false;
        this.pending = null;
        try { process.kill(-this.child.pid, 'SIGKILL'); } catch { /* already gone */ }
        reject(new Error('The command timed out. The shell was restarted in a new tab.'));
      }, Math.max(1000, Math.min(3_600_000, Number(timeoutMs) || DEFAULT_TIMEOUT)));
      this.pending = {
        token,
        raw: '',
        collected: '',
        timer,
        resolve,
        reject,
      };
      this.child.stdin.write(`${text}\n`);
      this.child.stdin.write(`print -r -- "__CAELIX_DONE_${token}__$?"\n`);
    });
  }

  summary() {
    return {
      id: this.id,
      title: this.title,
      cwd: this.cwd,
      busy: this.busy,
      closed: this.closed,
      entries: this.entries.slice(-MAX_ENTRIES),
    };
  }

  dispose() {
    this.closed = true;
    this.finishRun(null, new Error('The terminal was closed.'));
    try { process.kill(-this.child.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}

class TerminalManager {
  constructor(emit) {
    this.emit = emit;
    this.sessions = new Map();
    this.counter = 0;
  }

  bucket(sessionId, cwd, history) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { cwd, tabs: [], activeId: null, counter: 0, history: history || [] });
    }
    const bucket = this.sessions.get(sessionId);
    if (cwd) bucket.cwd = cwd;
    if (history && !bucket.tabs.length) bucket.history = history;
    return bucket;
  }

  ensure(sessionId, cwd, history) {
    const bucket = this.bucket(sessionId, cwd, history);
    if (!bucket.tabs.length) this.create(sessionId, cwd, history);
    return this.list(sessionId);
  }

  create(sessionId, cwd, history) {
    const bucket = this.bucket(sessionId, cwd, history);
    bucket.counter += 1;
    this.counter += 1;
    const tab = new ShellTab({
      id: `term_${sessionId.slice(-6)}_${bucket.counter}_${crypto.randomBytes(2).toString('hex')}`,
      title: `Terminal ${bucket.counter}`,
      cwd: bucket.cwd,
      emit: this.emit,
      sessionId,
      history: bucket.tabs.length ? [] : (history || bucket.history),
    });
    bucket.tabs.push(tab);
    bucket.activeId = tab.id;
    this.emit({ type: 'terminal-tabs', sessionId, tabs: this.summaries(bucket), activeId: bucket.activeId });
    return tab.summary();
  }

  summaries(bucket) {
    return bucket.tabs.map((tab) => ({ id: tab.id, title: tab.title, busy: tab.busy, closed: tab.closed }));
  }

  list(sessionId, cwd, history) {
    const bucket = this.bucket(sessionId, cwd, history);
    return {
      tabs: bucket.tabs.map((tab) => tab.summary()),
      activeId: bucket.activeId,
    };
  }

  setActive(sessionId, tabId) {
    const bucket = this.sessions.get(sessionId);
    if (!bucket) return null;
    if (tabId && !bucket.tabs.some((tab) => tab.id === tabId)) return null;
    bucket.activeId = tabId || bucket.activeId;
    return bucket.activeId;
  }

  close(sessionId, tabId) {
    const bucket = this.sessions.get(sessionId);
    if (!bucket) return null;
    const index = bucket.tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) return null;
    bucket.tabs[index].dispose();
    bucket.tabs.splice(index, 1);
    if (!bucket.tabs.length) {
      const tab = this.create(sessionId, bucket.cwd);
      return { tabs: [tab], activeId: bucket.activeId };
    }
    if (bucket.activeId === tabId) bucket.activeId = bucket.tabs[Math.max(0, index - 1)].id;
    return { tabs: bucket.tabs.map((tab) => tab.summary()), activeId: bucket.activeId };
  }

  async run(sessionId, tabId, command, options) {
    const bucket = this.sessions.get(sessionId);
    if (!bucket) throw new Error('This chat has no terminal yet.');
    const tab = bucket.tabs.find((item) => item.id === tabId) || bucket.tabs.find((item) => item.id === bucket.activeId) || bucket.tabs[0];
    if (!tab) throw new Error('This chat has no terminal yet.');
    const result = await tab.run(command, options);
    return { ...result, output: result.output || '' };
  }

  dispose() {
    for (const bucket of this.sessions.values()) {
      for (const tab of bucket.tabs) tab.dispose();
    }
    this.sessions.clear();
  }
}

module.exports = { TerminalManager };
