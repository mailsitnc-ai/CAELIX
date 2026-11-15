'use strict';

// Real terminal tabs. Each tab is an interactive zsh running under a real
// PTY allocated by macOS expect(1), so prompts, colours, REPLs, pagers and
// progress bars behave like Terminal.app and load the user's ~/.zshrc.
//
// Command completion uses a trailing printf whose format string has `%s_%d`
// literally, while execution substitutes `<token>_<exitcode>`; therefore only
// actual execution (never the echoed command line) can match the marker.

const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');

const MAX_ENTRIES = 500;
const DEFAULT_TIMEOUT = 120000;

function stripAnsi(text) {
  return String(text)
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[@-Z\\-_]/g, '')
    .replace(/[\x00-\x07\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// Simulate carriage returns and backspaces (\x08) cleanly for a plain-text panel.
function normalise(text) {
  const cleaned = stripAnsi(text).replace(/\r+\n/g, '\n');
  const lines = [];
  let line = '';
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch === '\n') {
      lines.push(line);
      line = '';
    } else if (ch === '\r') {
      // Only overwrite if more printable content follows on the same line, or
      // discard trailing \r padding produced by zsh PROMPT_SP.
      line = '';
    } else if (ch === '\x08') {
      if (line.length) line = line.slice(0, -1);
    } else {
      line += ch;
    }
  }
  lines.push(line);
  return lines.join('\n');
}

function readLastLoginLine() {
  try {
    const user = process.env.USER || '';
    if (!user) return '';
    const out = execFileSync('/usr/bin/last', ['-1', user], { encoding: 'utf8', timeout: 250 });
    const first = String(out || '').split('\n').map((l) => l.trim()).find(Boolean);
    if (!first) return '';
    const match = first.match(/^\S+\s+(\S+)\s+(.+?)(?:\s+-\s+|\s+still|\s*$)/);
    if (match) return `Last login: ${match[2].trim()} on ${match[1].trim()}\n`;
  } catch {
    // Best effort only.
  }
  return '';
}

function stripMarkerLines(text) {
  return String(text || '')
    .replace(/^[^\n]*(?:echo\s+__C|__CX_)[^\n]*(?:\n|$)/gm, '');
}

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
    this.lineTail = '';

    if (!this.entries.length) {
      const loginLine = readLastLoginLine();
      if (loginLine) this.entries.push({ text: loginLine, at: Date.now() });
    }

    const expectScript = [
      'spawn -noecho /bin/zsh -i',
      'catch {stty cols 500 rows 40 < $spawn_out(slave,name)}',
      'interact',
    ].join('; ');

    this.child = spawn('/usr/bin/expect', ['-c', expectScript], {
      cwd,
      env: {
        ...process.env,
        CAELIX: '1',
        TERM: 'xterm-256color',
        COLUMNS: '500',
        PROMPT_EOL_MARK: '',
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
      if (this.lineTail) {
        const tail = stripMarkerLines(this.lineTail);
        this.lineTail = '';
        if (tail) this.push(tail);
      }
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

  emitVisible(text, recordPending = null) {
    if (!text) return;
    const combined = this.lineTail + text;
    this.lineTail = '';

    // Only hold back an incomplete trailing line if it could be our helper
    // printf echo or completion marker arriving split across PTY chunks.
    const lastNl = combined.lastIndexOf('\n');
    const completePart = lastNl >= 0 ? combined.slice(0, lastNl + 1) : '';
    const tailPart = lastNl >= 0 ? combined.slice(lastNl + 1) : combined;

    let visible = stripMarkerLines(completePart);
    if (tailPart) {
      if (/(?:echo\s+__C|__CX)/i.test(tailPart)) {
        this.lineTail = tailPart;
      } else {
        visible += stripMarkerLines(tailPart);
      }
    }

    if (visible) {
      if (recordPending) recordPending.collected += visible;
      this.push(visible);
    }
  }

  consume(chunk) {
    const text = normalise(chunk.toString());
    if (!text) return;

    if (!this.pending) {
      this.emitVisible(text);
      return;
    }

    this.pending.raw += text;
    const token = this.pending.token;
    const doneRe = new RegExp(`__CX_${token}_(\\d+)__`);
    const match = this.pending.raw.match(doneRe);
    if (!match) {
      this.emitVisible(text, this.pending);
      return;
    }

    const markerIdxInText = text.indexOf(match[0]);
    if (markerIdxInText >= 0) {
      const before = text.slice(0, markerIdxInText);
      const after = text.slice(markerIdxInText + match[0].length).replace(/^\n/, '');
      this.emitVisible(before, this.pending);
      this.finishRun(Number(match[1]), null);
      if (after) this.emitVisible(after);
    } else {
      // Marker spanned chunks: flush everything before, finish run cleanly.
      this.emitVisible(text, this.pending);
      this.finishRun(Number(match[1]), null);
    }
  }

  finishRun(exitCode, error) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.busy = false;
    clearTimeout(pending.timer);
    pending.raw = '';
    if (this.lineTail) {
      const tail = stripMarkerLines(this.lineTail);
      this.lineTail = '';
      if (tail) {
        pending.collected += tail;
        this.push(tail);
      }
    }
    if (error) pending.reject(error);
    else pending.resolve({ id: this.id, exitCode, output: stripMarkerLines(pending.collected) });
  }

  run(command, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
    if (this.closed) throw new Error('This terminal has exited. Open a new one.');
    if (this.busy) throw new Error('This terminal is still running a command — press Stop to interrupt it.');
    const text = String(command || '');
    if (!text.trim()) throw new Error('The command is empty.');
    const token = `t${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    this.busy = true;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finishRun(null, new Error('The command timed out. Press Stop or open a new tab.'));
        try { this.child.kill('SIGKILL'); } catch { /* already gone */ }
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
      this.child.stdin.write(`echo "__CX_${token}_$?__"\n`);
    });
  }

  // Sends Ctrl+C (0x03) to the PTY so a stuck interactive program releases the tab.
  interrupt() {
    try {
      this.child.stdin.write('\x03');
    } catch { /* shell gone */ }
    this.finishRun(null, new Error('Interrupted.'));
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
    try { this.child.kill('SIGTERM'); } catch { /* already gone */ }
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

  interrupt(sessionId, tabId) {
    const bucket = this.sessions.get(sessionId);
    if (!bucket) return false;
    const tab = bucket.tabs.find((item) => item.id === tabId) || bucket.tabs[0];
    if (!tab) return false;
    tab.interrupt();
    return true;
  }

  dispose() {
    for (const bucket of this.sessions.values()) {
      for (const tab of bucket.tabs) tab.dispose();
    }
    this.sessions.clear();
  }
}

module.exports = { TerminalManager };
