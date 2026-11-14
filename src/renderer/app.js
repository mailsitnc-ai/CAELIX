'use strict';

/* global window, document, performance, navigator, requestAnimationFrame */

const api = window.caelix;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

window.__caelixErrors = [];
window.addEventListener('error', (event) => {
  window.__caelixErrors.push({ kind: 'error', message: event.message, source: event.filename, line: event.lineno });
});
window.addEventListener('unhandledrejection', (event) => {
  window.__caelixErrors.push({ kind: 'rejection', message: String(event.reason && event.reason.message ? event.reason.message : event.reason) });
});

const state = {
  info: null,
  providers: [],
  keys: [],
  sessions: [],
  activeId: null,
  session: null,
  project: '',
  streaming: false,
  changes: [],
  terminal: [],
  live: null,
  liveText: '',
  liveRaf: 0,
  currentAssistant: null,
  firstWordAt: null,
  sendStartedAt: null,
  keysOpen: false,
  initialized: false,
  contextReport: null,
  memory: null,
  memoryOpen: false,
  checkpoints: [],
  terminalTabs: [],
  activeTerminalId: null,
};

const MODES = [
  { id: 'ask', title: 'Manual', sub: 'Ask before every action' },
  { id: 'accept', title: 'Accept edits', sub: 'In-project edits proceed automatically' },
  { id: 'plan', title: 'Plan', sub: 'Read-only research and a written plan' },
  { id: 'bypass', title: 'Bypass permissions', sub: 'In-project actions run without asking' },
];

const TOOL_LABELS = {
  read_file: 'Read', write_file: 'Write', edit_file: 'Edit', list_dir: 'List',
  glob: 'Glob', grep: 'Grep', bash: 'Terminal', todo_write: 'Tasks', web_fetch: 'Fetch',
  multi_edit: 'Multi-edit', task_start: 'Task', task_list: 'Tasks', task_stop: 'Stop task',
  ask_user: 'Question', present_plan: 'Plan', subagent: 'Subagent',
};

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
  return out;
}

function prose(text) {
  const lines = text.split('\n');
  const out = [];
  let list = null;
  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) { closeList(); out.push('<hr>'); continue; }
    if (/^>\s?/.test(line)) { closeList(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('');
}

function renderMarkdown(source) {
  const text = String(source ?? '');
  const parts = text.split(/```/);
  let html = '';
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 0) {
      html += prose(parts[i]);
    } else {
      const raw = parts[i];
      const firstLine = raw.indexOf('\n');
      const language = firstLine >= 0 ? raw.slice(0, firstLine).trim() : '';
      const code = firstLine >= 0 ? raw.slice(firstLine + 1) : raw;
      html += `<div class="codeblock"><div class="code-head"><span>${escapeHtml(language || 'code')}</span><button class="copy-btn">Copy</button></div><pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre></div>`;
    }
  }
  return html || '<p></p>';
}

function simpleDiff(beforeText, afterText) {
  const before = String(beforeText ?? '').split('\n');
  const after = String(afterText ?? '').split('\n');
  if (before.length * after.length > 250000) {
    return after.slice(0, 60).map((text) => ({ kind: 'add', text }));
  }
  const n = before.length;
  const m = after.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) { lines.push({ kind: 'same', text: before[i] }); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { lines.push({ kind: 'del', text: before[i] }); i += 1; }
    else { lines.push({ kind: 'add', text: after[j] }); j += 1; }
    if (lines.length > 600) break;
  }
  while (i < n && lines.length <= 600) { lines.push({ kind: 'del', text: before[i] }); i += 1; }
  while (j < m && lines.length <= 600) { lines.push({ kind: 'add', text: after[j] }); j += 1; }
  return lines;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.add('hidden'), 2600);
}

function scrollToBottom(force = false) {
  const wrap = $('#transcript-wrap');
  if (!wrap) return;
  const near = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 220;
  if (force || near) wrap.scrollTop = wrap.scrollHeight;
}

function displayProject(folder) {
  if (!folder) return 'Project';
  const parts = String(folder).split('/').filter(Boolean);
  return parts[parts.length - 1] || folder;
}

function bucket(ts) {
  const date = new Date(ts || Date.now());
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return 'Today';
  if (date.getTime() >= startOfToday - 6 * 86400000) return 'Previous 7 days';
  return 'Older';
}

function renderSessions() {
  const list = $('#session-list');
  const query = $('#search').value.trim().toLowerCase();
  list.innerHTML = '';
  const groups = new Map();
  for (const session of state.sessions) {
    if (query && !String(session.title).toLowerCase().includes(query)) continue;
    const label = bucket(session.updatedAt);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(session);
  }
  if (!groups.size) {
    list.innerHTML = '<div class="panel-empty">No chats yet</div>';
    return;
  }
  for (const [label, sessions] of groups) {
    const group = document.createElement('div');
    group.className = 'session-group';
    group.textContent = label;
    list.appendChild(group);
    for (const session of sessions) {
      const button = document.createElement('div');
      button.className = `session-item${session.id === state.activeId ? ' active' : ''}`;
      button.dataset.session = session.id;
      button.tabIndex = 0;
      button.setAttribute('role', 'button');
      button.innerHTML = `<span class="session-title">${escapeHtml(session.title)}</span><span class="session-meta">${escapeHtml(displayProject(session.cwd))} · ${escapeHtml(session.model || '')}</span><button class="session-delete" title="Delete chat" aria-label="Delete chat">×</button>`;
      button.addEventListener('click', (event) => {
        if (event.target.closest('.session-delete')) return;
        openSession(session.id);
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') openSession(session.id);
      });
      let armed = false;
      let disarmTimer = null;
      const deleteButton = button.querySelector('.session-delete');
      deleteButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (!armed) {
          armed = true;
          deleteButton.classList.add('armed');
          deleteButton.textContent = 'Delete?';
          disarmTimer = setTimeout(() => {
            armed = false;
            deleteButton.classList.remove('armed');
            deleteButton.textContent = '×';
          }, 2500);
          return;
        }
        clearTimeout(disarmTimer);
        await api.invoke('sessions:delete', session.id);
        await refreshSessions();
        if (state.activeId) await openSession(state.activeId);
        else await newChat();
        renderAll();
        toast('Chat deleted.');
      });
      list.appendChild(button);
    }
  }
}

function renderChips() {
  const session = state.session;
  if (!session) return;
  const mode = MODES.find((item) => item.id === session.mode) || MODES[0];
  $('#mode-chip').textContent = mode.title;
  $('#composer-mode').textContent = mode.title;
  $('#model-chip').textContent = session.model || 'Model';
  $('#composer-model').textContent = session.model || 'Model';
  $('#project-name').textContent = displayProject(state.project || session.cwd);
  $('#side-project-name').textContent = state.project || session.cwd;
  $('#chat-title').textContent = session.title || 'New chat';
}

function renderEmpty() {
  const transcript = $('#transcript');
  transcript.innerHTML = `
    <div class="empty-state">
      <img src="../../assets/icon-1024.png" alt="CAELIX">
      <h1>What should we build?</h1>
      <p>CAELIX works inside ${escapeHtml(displayProject(state.project))}. Ask for a change, a fix, or an explanation. Tools, permissions and every file change stay visible.</p>
      <div class="empty-grid">
        <button class="empty-card" data-example="Explain this project and list the most important files."><b>Explore</b>Map the project and the files that matter.</button>
        <button class="empty-card" data-example="Find one small improvement, make it, and verify it."><b>Improve</b>Find, change and check a real improvement.</button>
        <button class="empty-card" data-example="Run the tests and fix the first failure."><b>Fix</b>Run the checks and repair the first error.</button>
      </div>
    </div>`;
  for (const card of $$('.empty-card', transcript)) {
    card.addEventListener('click', () => {
      $('#prompt').value = card.dataset.example;
      resizePrompt();
      $('#prompt').focus();
    });
  }
}

function toolCard(options) {
  const {
    id, name, input, status = 'running', output = '', durationMs = null, ok = null,
  } = options;
  const card = document.createElement('div');
  card.className = 'tool-card';
  card.id = `tool-${id}`;
  const target = input?.path || input?.command || input?.pattern || input?.url || input?.items?.length || '';
  const label = TOOL_LABELS[name] || name;
  const statusText = status === 'running'
    ? '<span class="tool-spinner"></span>Running'
    : ok === false
      ? 'Failed'
      : `Done${durationMs ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''}`;
  card.innerHTML = `
    <div class="tool-head">
      <span class="tool-icon">${escapeHtml(label.slice(0, 1))}</span>
      <span class="tool-name">${escapeHtml(label)}</span>
      <span class="tool-target">${escapeHtml(target)}</span>
      <span class="tool-status ${status === 'running' ? '' : ok === false ? 'err' : 'ok'}">${statusText}</span>
      <button class="tool-toggle">Details</button>
    </div>
    <pre class="tool-output">${escapeHtml(output)}</pre>`;
  card.querySelector('.tool-toggle').addEventListener('click', (event) => {
    event.stopPropagation();
    card.classList.toggle('expanded');
  });
  card.querySelector('.tool-head').addEventListener('click', () => card.classList.toggle('expanded'));
  return card;
}

function updateToolCard(id, { ok, output, durationMs }) {
  const card = document.getElementById(`tool-${id}`);
  if (!card) return;
  const status = card.querySelector('.tool-status');
  status.className = `tool-status ${ok ? 'ok' : 'err'}`;
  status.textContent = ok ? `Done${durationMs ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''}` : 'Failed';
  const pre = card.querySelector('.tool-output');
  pre.textContent = output || '';
  if (!ok) card.classList.add('expanded');
}

function renderTranscript() {
  const transcript = $('#transcript');
  transcript.innerHTML = '';
  const session = state.session;
  if (!session || !session.messages || !session.messages.length) {
    renderEmpty();
    return;
  }
  const results = new Map();
  for (const message of session.messages) {
    if (message.role === 'tool') results.set(message.toolCallId, message);
  }
  for (const message of session.messages) {
    if (message.role === 'tool') continue;
    if (message.role === 'user') {
      const node = document.createElement('div');
      node.className = 'msg user';
      node.innerHTML = `<div class="bubble">${escapeHtml(message.content)}</div>`;
      transcript.appendChild(node);
      continue;
    }
    if (message.role === 'assistant') {
      const node = document.createElement('div');
      node.className = 'msg assistant';
      const body = document.createElement('div');
      body.className = 'assistant-body';
      body.innerHTML = `<div class="msg-label"><img src="../../assets/icon-1024.png" alt="">CAELIX</div><div class="md">${renderMarkdown(message.content || '')}</div>`;
      for (const call of message.toolCalls || []) {
        const result = results.get(call.id);
        body.appendChild(toolCard({
          id: call.id,
          name: call.name,
          input: call.input,
          status: result ? 'done' : 'running',
          output: result?.content || '',
          ok: result ? !String(result.content).startsWith('Error:') : null,
        }));
      }
      node.appendChild(body);
      transcript.appendChild(node);
    }
  }
  scrollToBottom(true);
}

function renderChanges() {
  const list = $('#changes-list');
  list.innerHTML = '';
  if (!state.changes.length) {
    list.innerHTML = '<div class="panel-empty">No changes yet</div>';
    return;
  }
  for (const change of state.changes) {
    const item = document.createElement('div');
    item.className = 'change-item';
    const lines = simpleDiff(change.before || '', change.after || '');
    const additions = change.additions ?? lines.filter((line) => line.kind === 'add').length;
    const deletions = change.deletions ?? lines.filter((line) => line.kind === 'del').length;
    item.innerHTML = `
      <div class="change-head">
        <span class="change-file">${escapeHtml(change.file)}</span>
        <span class="change-counts"><span class="add">+${additions}</span> <span class="del">−${deletions}</span></span>
      </div>
      <div class="diff">${lines.map((line) => `<div class="diff-line ${line.kind}"><span class="diff-sign">${line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span><span class="diff-text">${escapeHtml(line.text)}</span></div>`).join('')}</div>`;
    list.appendChild(item);
  }
}

function renderContext() {
  const node = $('#context-report');
  if (!node) return;
  const report = state.contextReport;
  if (!report) {
    node.innerHTML = '<div class="panel-empty">Context usage appears after the first reply</div>';
    return;
  }
  const rows = [
    ['System and memory', report.systemTokens],
    ['Messages', report.messageTokens],
    ['Tool results', report.toolTokens],
  ];
  const max = Math.max(1, report.total);
  node.innerHTML = `
    <div class="context-total">
      <span class="context-number">${report.total.toLocaleString()}</span>
      <span class="context-unit">of ${report.limit.toLocaleString()} tokens</span>
      <span class="context-percent">${report.percent}%</span>
    </div>
    <div class="context-bar"><span style="width:${Math.max(1, Math.min(100, report.percent))}%"></span></div>
    <div class="context-rows">
      ${rows.map(([label, value]) => `
        <div class="context-row">
          <span class="context-label">${label}</span>
          <span class="context-track"><i style="width:${Math.max(1, Math.round((value / max) * 100))}%"></i></span>
          <span class="context-value">${value.toLocaleString()}</span>
        </div>`).join('')}
    </div>
    <div class="context-foot">${report.messages} saved message(s) in this chat.</div>`;
}

function renderCheckpoints() {
  const node = $('#checkpoint-list');
  if (!node) return;
  if (!state.checkpoints.length) {
    node.innerHTML = '<div class="checkpoint-empty">Turns that change files can be restored here.</div>';
    return;
  }
  node.innerHTML = '';
  for (const checkpoint of state.checkpoints) {
    const item = document.createElement('div');
    item.className = 'checkpoint-item';
    const time = new Date(checkpoint.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    item.innerHTML = `
      <span class="checkpoint-dot"></span>
      <span class="checkpoint-time">${escapeHtml(time)}</span>
      <span class="checkpoint-files">${checkpoint.filesChanged} file${checkpoint.filesChanged === 1 ? '' : 's'}</span>
      <button class="checkpoint-restore">Restore</button>`;
    const button = item.querySelector('.checkpoint-restore');
    let armed = false;
    let timer = null;
    button.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        button.classList.add('armed');
        button.textContent = 'Restore?';
        timer = setTimeout(() => {
          armed = false;
          button.classList.remove('armed');
          button.textContent = 'Restore';
        }, 2500);
        return;
      }
      clearTimeout(timer);
      button.disabled = true;
      button.textContent = 'Restoring…';
      try {
        const result = await api.invoke('checkpoints:rewind', {
          sessionId: state.session.id,
          checkpointId: checkpoint.id,
        });
        toast(`Restored ${result.restored.length} file${result.restored.length === 1 ? '' : 's'}.`);
        await openSession(state.session.id);
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Restore';
        toast(error.message);
      }
    });
    node.appendChild(item);
  }
}

async function loadCheckpoints() {
  if (!state.session) {
    state.checkpoints = [];
    renderCheckpoints();
    return;
  }
  try {
    state.checkpoints = await api.invoke('checkpoints:list', { sessionId: state.session.id });
  } catch {
    state.checkpoints = [];
  }
  renderCheckpoints();
}

function activeTerminal() {
  return state.terminalTabs.find((tab) => tab.id === state.activeTerminalId) || state.terminalTabs[0] || null;
}

function renderTerminalTabs() {
  const node = $('#terminal-tabs');
  if (!node) return;
  node.innerHTML = '';
  for (const tab of state.terminalTabs) {
    const button = document.createElement('button');
    button.className = `terminal-tab${tab.id === state.activeTerminalId ? ' active' : ''}`;
    button.dataset.tabId = tab.id;
    button.innerHTML = `<span class="terminal-tab-name">${escapeHtml(tab.title)}</span><span class="terminal-tab-close" title="Close terminal">×</span>`;
    button.addEventListener('click', async (event) => {
      if (event.target.closest('.terminal-tab-close')) return;
      await selectTerminal(tab.id);
    });
    button.querySelector('.terminal-tab-close').addEventListener('click', async (event) => {
      event.stopPropagation();
      await closeTerminalTab(tab.id);
    });
    node.appendChild(button);
  }
}

function renderTerminal() {
  const node = $('#terminal');
  if (!node) return;
  const tab = activeTerminal();
  const rows = [];
  for (const entry of tab?.entries || []) {
    if (entry.text) rows.push(`<span>${escapeHtml(entry.text)}</span>`);
  }
  node.innerHTML = rows.join('') || '<span style="color:#6d747d">Commands and their output appear here.</span>';
  node.scrollTop = node.scrollHeight;
}

function appendTerminal(text, cls) {
  const node = $('#terminal');
  if (node.querySelector('span[style]')) node.innerHTML = '';
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  node.appendChild(span);
  node.scrollTop = node.scrollHeight;
}

async function loadTerminalTabs() {
  if (!state.session) {
    state.terminalTabs = [];
    state.activeTerminalId = null;
    renderTerminalTabs();
    renderTerminal();
    return;
  }
  try {
    const data = await api.invoke('terminal:tabs', { sessionId: state.session.id });
    state.terminalTabs = data.tabs || [];
    state.activeTerminalId = data.activeId || state.terminalTabs[0]?.id || null;
  } catch {
    state.terminalTabs = [];
    state.activeTerminalId = null;
  }
  renderTerminalTabs();
  renderTerminal();
}

async function selectTerminal(tabId) {
  state.activeTerminalId = tabId;
  renderTerminalTabs();
  renderTerminal();
  if (state.session) {
    api.invoke('terminal:active', { sessionId: state.session.id, tabId }).catch(() => {});
  }
  $('#terminal-cmd').focus();
}

async function newTerminalTab() {
  if (!state.session) return;
  const data = await api.invoke('terminal:new', { sessionId: state.session.id });
  state.terminalTabs = data.tabs || [];
  state.activeTerminalId = data.activeId || data.tab?.id || null;
  renderTerminalTabs();
  renderTerminal();
  $('#terminal-cmd').focus();
}

async function closeTerminalTab(tabId) {
  if (!state.session) return;
  const data = await api.invoke('terminal:close', { sessionId: state.session.id, tabId });
  state.terminalTabs = data.tabs || [];
  state.activeTerminalId = data.activeId || state.terminalTabs[0]?.id || null;
  renderTerminalTabs();
  renderTerminal();
}

function renderKeys() {
  const rows = $('#key-rows');
  rows.innerHTML = '';
  for (const provider of state.keys) {
    const configured = Boolean(provider.masked);
    const row = document.createElement('div');
    row.className = 'key-row';
    row.id = `key-row-${provider.id}`;
    row.innerHTML = `
      <div class="key-row-head">
        <span class="key-dot" style="background:${provider.color}"></span>
        <span class="key-name">${escapeHtml(provider.name)}</span>
        ${provider.consoleUrl ? `<a class="key-link" href="${provider.consoleUrl}" target="_blank" rel="noreferrer">Get a key</a>` : ''}
        <span class="key-state ${configured ? 'saved' : ''}" id="key-status-${provider.id}">${configured ? `Saved ${provider.masked}` : provider.keyless ? 'No key needed' : 'Not saved'}</span>
      </div>
      ${provider.keyless ? '' : `
      <div class="key-input-row">
        <input id="key-input-${provider.id}" type="password" autocomplete="off" spellcheck="false" placeholder="${configured ? 'Paste a new key to replace it' : 'Paste your key'}">
        <button id="key-save-${provider.id}" class="primary">Save</button>
        <button id="key-test-${provider.id}">Test</button>
        ${configured ? `<button id="key-delete-${provider.id}">Delete</button>` : ''}
      </div>
      <div class="key-hint" id="key-hint-${provider.id}"></div>`}
    `;
    rows.appendChild(row);

    if (!provider.keyless) {
      const input = $(`#key-input-${provider.id}`);
      const hint = $(`#key-hint-${provider.id}`);
      $(`#key-save-${provider.id}`).addEventListener('click', async () => {
        const value = input.value.trim();
        if (!value) { hint.textContent = 'Paste a key first.'; return; }
        try {
          await api.invoke('keys:save', { provider: provider.id, key: value });
          input.value = '';
          hint.textContent = 'Saved, encrypted by macOS.';
          await refreshKeys();
        } catch (error) {
          hint.textContent = error.message;
        }
      });
      $(`#key-test-${provider.id}`).addEventListener('click', async () => {
        hint.textContent = 'Testing…';
        try {
          await api.invoke('keys:test', { provider: provider.id, key: input.value.trim() || undefined });
          hint.textContent = 'Key accepted. It can reach the model.';
        } catch (error) {
          hint.textContent = error.message;
        }
      });
      const deleteButton = $(`#key-delete-${provider.id}`);
      if (deleteButton) {
        deleteButton.addEventListener('click', async () => {
          await api.invoke('keys:delete', { provider: provider.id });
          await refreshKeys();
          toast('Key deleted.');
        });
      }
    }
  }
}

async function refreshKeys() {
  state.keys = await api.invoke('keys:status');
  renderKeys();
}

async function refreshSessions() {
  const list = await api.invoke('sessions:list');
  state.sessions = list.sessions;
  state.activeId = list.activeId;
  renderSessions();
}

function renderAll() {
  renderChips();
  renderTranscript();
  renderChanges();
  renderTerminal();
  renderContext();
  renderCheckpoints();
  renderSessions();
}

async function openSession(id) {
  const session = await api.invoke('sessions:get', id);
  if (!session) return;
  state.session = session;
  state.activeId = session.id;
  state.changes = (session.changes || []).filter((change) => change.file);
  state.terminal = session.terminal || [];
  state.project = session.cwd;
  try {
    state.contextReport = await api.invoke('context:get', { sessionId: id });
  } catch {
    state.contextReport = null;
  }
  await loadCheckpoints();
  await loadTerminalTabs();
  await api.invoke('sessions:set-active', id);
  renderAll();
  scrollToBottom(true);
}

async function newChat() {
  const session = await api.invoke('sessions:create', {
    cwd: state.project,
    provider: state.session?.provider || (state.info.selfcheck ? 'simulator' : 'gemini'),
    model: state.session?.model || (state.info.selfcheck ? 'sim-1' : 'gemini-2.5-flash'),
    mode: state.session?.mode || 'ask',
  });
  state.session = session;
  state.activeId = session.id;
  state.changes = [];
  state.terminal = [];
  state.contextReport = null;
  state.checkpoints = [];
  state.terminalTabs = [];
  state.activeTerminalId = null;
  await refreshSessions();
  renderAll();
  await loadTerminalTabs();
  $('#prompt').focus();
}

function resizePrompt() {
  const prompt = $('#prompt');
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(200, prompt.scrollHeight)}px`;
}

function setStreaming(value) {
  state.streaming = value;
  $('#send-btn').classList.toggle('hidden', value);
  $('#stop-btn').classList.toggle('hidden', !value);
  $('#stream-status').textContent = value ? 'Streaming…' : '';
}

function ensureLiveAssistant() {
  if (state.currentAssistant) return state.currentAssistant;
  const node = document.createElement('div');
  node.className = 'msg assistant';
  const body = document.createElement('div');
  body.className = 'assistant-body';
  body.innerHTML = '<div class="msg-label"><img src="../../assets/icon-1024.png" alt="">CAELIX</div><div class="md"><span class="typing"><i></i><i></i><i></i></span></div>';
  node.appendChild(body);
  $('#transcript').appendChild(node);
  state.currentAssistant = { node, body, md: $('.md', body) };
  scrollToBottom(true);
  return state.currentAssistant;
}

function paintLive() {
  if (!state.currentAssistant) return;
  state.currentAssistant.md.innerHTML = renderMarkdown(state.liveText) || '<span class="typing"><i></i><i></i><i></i></span>';
  scrollToBottom();
}

function scheduleLivePaint() {
  if (state.liveRaf) return;
  state.liveRaf = requestAnimationFrame(() => {
    state.liveRaf = 0;
    paintLive();
  });
}

function appendPermission(request) {
  if (!state.currentAssistant) ensureLiveAssistant();
  const card = document.createElement('div');
  card.className = 'permission-card';
  card.id = 'permission-card';
  const target = request.target || request.detail || '';
  card.innerHTML = `
    <div class="permission-title"><span>◆</span>${escapeHtml(request.action || 'Permission needed')}</div>
    <div class="permission-detail">CAELIX wants to use <code>${escapeHtml(request.tool)}</code> on <code>${escapeHtml(target)}</code>.</div>
    <div class="permission-actions">
      <button class="primary" data-decision="session" id="permission-session">Always allow</button>
      <button data-decision="allow" id="permission-allow">Allow once</button>
      <button data-decision="deny" id="permission-deny">Cancel</button>
    </div>`;
  for (const button of $$('button', card)) {
    button.addEventListener('click', async () => {
      const decision = button.dataset.decision;
      for (const other of $$('button', card)) other.disabled = true;
      card.querySelector('.permission-detail').textContent = decision === 'deny'
        ? 'Cancelled. The model receives the refusal.'
        : decision === 'session'
          ? 'Allowed for this session. The same action will not ask again.'
          : 'Allowed once. Running the action…';
      await api.invoke('permission:respond', { id: request.id, decision });
    });
  }
  state.currentAssistant.body.appendChild(card);
  scrollToBottom();
}

function appendQuestion(request) {
  if (!state.currentAssistant) ensureLiveAssistant();
  const card = document.createElement('div');
  card.className = 'question-card';
  card.id = 'question-card';
  const options = Array.isArray(request.options) ? request.options : [];
  card.innerHTML = `
    <div class="question-title"><span>?</span>CAELIX asks</div>
    <div class="question-text">${escapeHtml(request.question || '')}</div>
    <div class="question-options">${options.map((option) => `<button data-answer="${escapeHtml(option)}">${escapeHtml(option)}</button>`).join('')}</div>
    ${request.allowOther === false ? '' : '<div class="question-other"><input id="question-input" placeholder="Or type an answer" aria-label="Your answer"><button id="question-send">Answer</button></div>'}`;

  const finish = async (answer) => {
    if (card.dataset.answered) return;
    card.dataset.answered = 'yes';
    for (const button of $$('button', card)) button.disabled = true;
    const input = $('#question-input', card);
    if (input) input.disabled = true;
    const note = document.createElement('div');
    note.className = 'question-answer';
    note.textContent = `Answer: ${answer}`;
    card.appendChild(note);
    await api.invoke('question:respond', { id: request.id, answer });
  };

  for (const button of $$('[data-answer]', card)) {
    button.addEventListener('click', () => finish(button.dataset.answer));
  }
  const send = $('#question-send', card);
  if (send) {
    send.addEventListener('click', () => {
      const value = $('#question-input', card).value.trim();
      if (value) finish(value);
    });
  }
  state.currentAssistant.body.appendChild(card);
  scrollToBottom();
}

function appendPlan(event) {
  if (!state.currentAssistant) ensureLiveAssistant();
  const card = document.createElement('div');
  card.className = 'plan-card';
  card.innerHTML = `
    <div class="plan-head"><span class="plan-badge">Plan</span><span class="plan-title">${escapeHtml(event.title || 'Proposed plan')}</span></div>
    <div class="plan-body md">${renderMarkdown(event.plan || '')}</div>`;
  state.currentAssistant.body.appendChild(card);
  scrollToBottom();
}

function appendError(message) {  const card = document.createElement('div');
  card.className = 'error-card';
  card.textContent = message;
  if (state.currentAssistant) state.currentAssistant.body.appendChild(card);
  else $('#transcript').appendChild(card);
  scrollToBottom();
}

function onChatEvent(event) {
  switch (event.type) {
    case 'turn-start':
      state.sendStartedAt = performance.now();
      state.firstWordAt = null;
      setStreaming(true);
      ensureLiveAssistant();
      break;
    case 'text': {
      if (!state.firstWordAt) state.firstWordAt = performance.now();
      ensureLiveAssistant();
      state.liveText += event.delta;
      scheduleLivePaint();
      break;
    }
    case 'tool-start': {
      ensureLiveAssistant();
      if (state.currentAssistant.md.querySelector('.typing')) {
        state.currentAssistant.md.innerHTML = renderMarkdown(state.liveText);
      }
      const card = toolCard({
        id: event.id, name: event.name, input: event.input, status: 'running',
      });
      state.currentAssistant.body.appendChild(card);
      scrollToBottom();
      break;
    }
    case 'tool-result':
      updateToolCard(event.id, event);
      break;
    case 'permission-request':
      appendPermission(event);
      break;
    case 'question-request':
      appendQuestion(event);
      break;
    case 'plan':
      appendPlan(event);
      break;
    case 'retry':
      toast(`Provider error. Retrying (${event.attempt}) in ${Math.round((event.waitMs || 0) / 100) / 10}s.`);
      break;
    case 'change':
      state.changes.push(event);
      renderChanges();
      break;
    case 'terminal-output': {
      const tab = state.terminalTabs.find((item) => item.id === event.tabId);
      if (tab) {
        tab.entries = tab.entries || [];
        tab.entries.push({ text: event.text, at: Date.now() });
        if (tab.entries.length > 500) tab.entries.splice(0, tab.entries.length - 500);
      }
      if (event.tabId === state.activeTerminalId) appendTerminal(event.text);
      break;
    }
    case 'terminal-tabs':
      state.terminalTabs = event.tabs || [];
      state.activeTerminalId = event.activeId || state.terminalTabs[0]?.id || null;
      renderTerminalTabs();
      renderTerminal();
      break;
    case 'todos':
      break;
    case 'context':
      state.contextReport = event.report;
      renderContext();
      if (event.compacted) toast(`Compacted ${event.compacted} older message(s) to fit the context window.`);
      break;
    case 'checkpoint':
      state.checkpoints = [event.checkpoint, ...state.checkpoints.filter((item) => item.id !== event.checkpoint.id)];
      renderCheckpoints();
      break;
    case 'rewound':
      toast(`Restored ${event.restored.length} file(s).`);
      break;
    case 'done':
      setStreaming(false);
      if (event.context) {
        state.contextReport = event.context;
        renderContext();
      }
      if (event.compacted) toast(`Compacted ${event.compacted} older message(s) to fit the context window.`);
      if (state.currentAssistant) {
        if (!state.liveText) state.currentAssistant.md.innerHTML = '';
        const status = $('#stream-status');
        const tokens = event.usage?.total_tokens;
        status.textContent = tokens ? `${tokens} tokens · ${((event.elapsedMs || 0) / 1000).toFixed(1)}s` : '';
      }
      state.currentAssistant = null;
      state.liveText = '';
      refreshSessions();
      break;
    case 'error':
      setStreaming(false);
      appendError(event.message);
      if (state.currentAssistant) {
        state.currentAssistant = null;
        state.liveText = '';
      }
      break;
    case 'session-updated':
      if (state.session && event.session.id === state.session.id) {
        Object.assign(state.session, event.session);
        $('#chat-title').textContent = event.session.title;
      }
      refreshSessions();
      break;
    case 'session-created':
    case 'sessions-changed':
      refreshSessions();
      break;
    default:
      break;
  }
}

async function sendMessage() {
  const prompt = $('#prompt');
  const text = prompt.value.trim();
  if (!text || state.streaming || !state.session) return;
  prompt.value = '';
  resizePrompt();
  state.sendStartedAt = performance.now();
  state.firstWordAt = null;
  state.liveText = '';
  state.currentAssistant = null;
  state.session.messages = state.session.messages || [];
  state.session.messages.push({ role: 'user', content: text });
  const current = $('#transcript');
  if ($('.empty-state', current)) current.innerHTML = '';
  const node = document.createElement('div');
  node.className = 'msg user';
  node.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  current.appendChild(node);
  scrollToBottom(true);
  setStreaming(true);
  ensureLiveAssistant();
  try {
    await api.invoke('chat:send', { sessionId: state.session.id, text });
  } catch (error) {
    setStreaming(false);
    appendError(error.message);
  }
}

function openKeys() {
  state.keysOpen = true;
  renderKeys();
  $('#keys-screen').classList.remove('hidden');
}
function closeKeys() {
  state.keysOpen = false;
  $('#keys-screen').classList.add('hidden');
}

async function refreshMemory() {
  const data = await api.invoke('memory:list', { cwd: state.project });
  state.memory = data;
  const badge = $('#memory-count');
  if (badge) badge.textContent = data.entries.length ? String(data.entries.length) : '';
  return data;
}

function renderMemoryFiles(data) {
  const node = $('#memory-files');
  if (!data.entries.length) {
    node.innerHTML = '<span class="memory-none">No project instructions yet.</span>';
    return;
  }
  node.innerHTML = data.entries.map((entry) => `<button class="memory-chip" data-memory-file="${escapeHtml(entry.file)}">${escapeHtml(entry.file)} · ${entry.bytes.toLocaleString()} B</button>`).join('');
  for (const chip of $$('.memory-chip', node)) {
    chip.addEventListener('click', async () => {
      const select = $('#memory-file');
      if ([...select.options].some((option) => option.value === chip.dataset.memoryFile)) select.value = chip.dataset.memoryFile;
      await loadMemoryEditor();
    });
  }
}

async function loadMemoryEditor() {
  const data = await refreshMemory();
  const file = $('#memory-file').value || 'CAELIX.md';
  const entry = data.entries.find((item) => item.file === file);
  $('#memory-text').value = entry ? entry.text : '';
  $('#memory-status').textContent = entry ? `${entry.bytes.toLocaleString()} bytes loaded into every reply` : 'Not created yet';
  $('#memory-prompt-info').textContent = `${data.promptTokens.toLocaleString()} prompt tokens with memory`;
  renderMemoryFiles(data);
}

async function openMemory() {
  state.memoryOpen = true;
  $('#memory-screen').classList.remove('hidden');
  try {
    await loadMemoryEditor();
  } catch (error) {
    $('#memory-status').textContent = error.message;
  }
}

function closeMemory() {
  state.memoryOpen = false;
  $('#memory-screen').classList.add('hidden');
}

async function saveMemory() {
  const file = $('#memory-file').value;
  const text = $('#memory-text').value;
  try {
    await api.invoke('memory:save', { cwd: state.project, file, text });
    await loadMemoryEditor();
    toast(`${file} saved. New replies include it.`);
  } catch (error) {
    $('#memory-status').textContent = error.message;
  }
}

function renderModelMenu(filter = '') {
  const menu = $('#model-menu');
  const query = filter.trim().toLowerCase();
  const chunks = [`<input class="pop-search" id="model-search" placeholder="Search models" value="${escapeHtml(filter)}">`];
  for (const provider of state.providers) {
    const models = provider.models.filter((model) => !query || model.toLowerCase().includes(query) || provider.name.toLowerCase().includes(query));
    if (!models.length) continue;
    chunks.push(`<div class="pop-section">${escapeHtml(provider.name)}</div>`);
    for (const model of models) {
      const active = state.session && state.session.provider === provider.id && state.session.model === model;
      chunks.push(`<button class="pop-item${active ? ' active' : ''}" data-provider="${provider.id}" data-model="${escapeHtml(model)}"><span class="pop-dot" style="background:${provider.color}"></span><span><span class="pop-title">${escapeHtml(model)}</span><span class="pop-sub">${active ? 'Current model' : escapeHtml(provider.name)}</span></span></button>`);
    }
  }
  chunks.push('<div class="pop-custom"><input id="custom-model" placeholder="Use any model ID"><button id="custom-model-use">Use</button></div>');
  menu.innerHTML = chunks.join('');
  const search = $('#model-search');
  if (search) {
    search.addEventListener('input', () => renderModelMenu(search.value));
    search.focus();
  }
  for (const item of $$('.pop-item', menu)) {
    item.addEventListener('click', async () => {
      await chooseModel(item.dataset.provider, item.dataset.model);
      menu.classList.add('hidden');
    });
  }
  $('#custom-model-use').addEventListener('click', async () => {
    const value = $('#custom-model').value.trim();
    if (!value) return;
    await chooseModel(state.session.provider, value);
    menu.classList.add('hidden');
  });
}

async function chooseModel(provider, model) {
  if (!state.session) return;
  await api.invoke('sessions:update', { id: state.session.id, provider, model });
  state.session.provider = provider;
  state.session.model = model;
  renderChips();
  renderModelMenu();
}

function renderModeMenu() {
  const menu = $('#mode-menu');
  menu.innerHTML = MODES.map((mode) => `<button class="pop-item${state.session?.mode === mode.id ? ' active' : ''}" data-mode="${mode.id}"><span><span class="pop-title">${mode.title}</span><span class="pop-sub">${mode.sub}</span></span></button>`).join('');
  for (const item of $$('.pop-item', menu)) {
    item.addEventListener('click', async () => {
      await api.invoke('sessions:update', { id: state.session.id, mode: item.dataset.mode });
      state.session.mode = item.dataset.mode;
      renderChips();
      menu.classList.add('hidden');
    });
  }
}

function bind() {
  $('#new-chat').addEventListener('click', newChat);
  $('#search').addEventListener('input', renderSessions);
  $('#keys-btn').addEventListener('click', openKeys);
  $('#keys-close').addEventListener('click', closeKeys);
  $('#keys-screen').addEventListener('click', (event) => { if (event.target.id === 'keys-screen') closeKeys(); });
  $('#memory-btn').addEventListener('click', openMemory);
  $('#memory-close').addEventListener('click', closeMemory);
  $('#memory-save').addEventListener('click', saveMemory);
  $('#memory-file').addEventListener('change', () => { loadMemoryEditor().catch(() => {}); });
  $('#memory-screen').addEventListener('click', (event) => { if (event.target.id === 'memory-screen') closeMemory(); });

  $('#model-chip').addEventListener('click', (event) => {
    event.stopPropagation();
    $('#mode-menu').classList.add('hidden');
    const menu = $('#model-menu');
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) renderModelMenu();
  });
  $('#composer-model').addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = $('#model-menu');
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) renderModelMenu();
  });
  $('#mode-chip').addEventListener('click', (event) => {
    event.stopPropagation();
    $('#model-menu').classList.add('hidden');
    const menu = $('#mode-menu');
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) renderModeMenu();
  });
  $('#composer-mode').addEventListener('click', (event) => {
    event.stopPropagation();
    $('#model-menu').classList.add('hidden');
    const menu = $('#mode-menu');
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) renderModeMenu();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.chip-wrap')) {
      $('#model-menu').classList.add('hidden');
      $('#mode-menu').classList.add('hidden');
    }
  });

  $('#send-btn').addEventListener('click', sendMessage);
  $('#stop-btn').addEventListener('click', async () => {
    if (!state.session) return;
    $('#stream-status').textContent = 'Stopping…';
    await api.invoke('chat:stop', state.session.id);
  });
  $('#prompt').addEventListener('input', resizePrompt);
  $('#prompt').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  $('#chat-title-btn').addEventListener('click', () => {
    if (!state.session) return;
    $('#chat-title-btn').classList.add('hidden');
    const input = $('#title-input');
    input.value = state.session.title;
    input.classList.remove('hidden');
    input.focus();
    input.select();
  });
  const finishRename = async () => {
    const input = $('#title-input');
    if (input.classList.contains('hidden')) return;
    const value = input.value.trim();
    input.classList.add('hidden');
    $('#chat-title-btn').classList.remove('hidden');
    if (value && state.session && value !== state.session.title) {
      await api.invoke('sessions:rename', { id: state.session.id, title: value });
      state.session.title = value;
      $('#chat-title').textContent = value;
      refreshSessions();
    }
  };
  $('#title-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); finishRename(); }
    if (event.key === 'Escape') {
      $('#title-input').classList.add('hidden');
      $('#chat-title-btn').classList.remove('hidden');
    }
  });
  $('#title-input').addEventListener('blur', finishRename);

  $('#project-btn').addEventListener('click', pickProject);
  $('#side-project').addEventListener('click', pickProject);

  $('#panel-toggle').addEventListener('click', () => $('#app').classList.toggle('panel-collapsed'));
  $('#panel-close').addEventListener('click', () => $('#app').classList.add('panel-collapsed'));
  for (const tab of $$('.panel-tab')) {
    tab.addEventListener('click', () => {
      for (const other of $$('.panel-tab')) other.classList.toggle('active', other === tab);
      const target = tab.dataset.tab;
      $('#changes-view').classList.toggle('hidden', target !== 'changes');
      $('#terminal-view').classList.toggle('hidden', target !== 'terminal');
      $('#context-view').classList.toggle('hidden', target !== 'context');
      if (target === 'terminal') {
        renderTerminalTabs();
        renderTerminal();
      }
      if (target === 'context') renderContext();
    });
  }

  $('#terminal-run').addEventListener('click', runTerminal);
  $('#terminal-new').addEventListener('click', () => { newTerminalTab().catch((error) => toast(error.message)); });
  $('#terminal-cmd').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runTerminal();
  });
  $('#sidebar-toggle').addEventListener('click', () => $('#app').classList.toggle('sidebar-collapsed'));
  $('#attach-btn').addEventListener('click', () => toast('Attachments arrive with the next version.'));

  document.addEventListener('click', async (event) => {
    const copy = event.target.closest('.copy-btn');
    if (copy) {
      const code = copy.closest('.codeblock')?.querySelector('code');
      if (code) {
        await navigator.clipboard.writeText(code.textContent);
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      }
    }
    const link = event.target.closest('a[target="_blank"]');
    if (link) {
      event.preventDefault();
      api.invoke('shell:open-external', link.href);
    }
  });
}

async function runTerminal() {
  if (!state.session) return;
  const input = $('#terminal-cmd');
  const command = input.value.trim();
  if (!command) return;
  const tab = activeTerminal();
  if (!tab) {
    toast('Open a terminal first.');
    return;
  }
  input.value = '';
  try {
    const result = await api.invoke('terminal:run', { sessionId: state.session.id, command, tabId: tab.id });
    if (result && result.exitCode) appendTerminal(`exit ${result.exitCode}\n`, 'err-line');
  } catch (error) {
    appendTerminal(`${error.message}\n`, 'err-line');
  }
}

async function pickProject() {
  const folder = await api.invoke('project:pick');
  if (!folder) return;
  state.project = folder;
  if (state.session) {
    await api.invoke('sessions:update', { id: state.session.id, cwd: folder });
    state.session.cwd = folder;
  }
  renderChips();
  toast('Project folder changed.');
}

function reportFirstPaint() {
  requestAnimationFrame(() => {
    const paint = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint');
    const value = paint ? paint.startTime : performance.now();
    api.invoke('first-paint', value).catch(() => {});
    window.__caelixFirstPaint = value;
  });
}

async function init() {
  api.on('chat:event', onChatEvent);
  const [info, providers, keys, sessions] = await Promise.all([
    api.invoke('app:info'),
    api.invoke('providers:list'),
    api.invoke('keys:status'),
    api.invoke('sessions:list'),
  ]);
  state.info = info;
  state.providers = providers;
  state.keys = keys;
  state.sessions = sessions.sessions;
  state.activeId = sessions.activeId;
  state.project = info.project;

  if (state.activeId) {
    const session = await api.invoke('sessions:get', state.activeId);
    if (session) {
      state.session = session;
      state.project = session.cwd || state.project;
      state.changes = (session.changes || []).filter((change) => change.file);
      state.terminal = session.terminal || [];
      try {
        state.contextReport = await api.invoke('context:get', { sessionId: session.id });
      } catch {
        state.contextReport = null;
      }
      await loadCheckpoints();
    }
  }
  if (!state.session) {
    state.session = await api.invoke('sessions:create', { cwd: state.project });
    state.activeId = state.session.id;
    await refreshSessions();
  }

  bind();
  try { await refreshMemory(); } catch { state.memory = null; }
  await loadTerminalTabs();
  renderAll();
  resizePrompt();
  reportFirstPaint();
  state.initialized = true;
  window.__caelixReady = true;
  window.__caelixState = state;
}

init().catch((error) => {
  window.__caelixErrors.push({ kind: 'init', message: error.message, stack: error.stack });
  document.body.innerHTML = `<pre style="padding:30px;color:#ffb4b4">CAELIX failed to start.\n\n${escapeHtml(error.stack || error.message)}</pre>`;
});
