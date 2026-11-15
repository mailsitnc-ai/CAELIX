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
  favourites: [],
  sessions: [],
  activeId: null,
  session: null,
  project: '',
  codeProject: '',
  activePanelTab: 'changes',
  browserState: { visible: false, url: '', title: '', canBack: false, canForward: false, loading: false },
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
  theme: 'dark',
  viewMode: 'normal',
  surface: 'code',
  gitBranch: null,
  attachments: [],
  projectFiles: null,
  mentionQuery: null,
  mentionMatches: [],
  mentionIndex: 0,
  commandMatches: [],
  commandIndex: 0,
  mcpOpen: false,
  hooksOpen: false,
  helperOpen: false,
  retryBanner: null,
  lastUsageText: '',
  promptOpen: false,
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
  web_search: 'Search', notebook_edit: 'Notebook', skill: 'Skill',
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

function sessionSurface(session) {
  if (!session) return state.surface;
  if (session.surface === 'chat' || session.surface === 'code') return session.surface;
  if (state.info?.chatRoot && session.cwd === state.info.chatRoot) return 'chat';
  return 'code';
}

function renderSessions() {
  const list = $('#session-list');
  const query = $('#search').value.trim().toLowerCase();
  list.innerHTML = '';
  const groups = new Map();
  for (const session of state.sessions) {
    if (query && !String(session.title).toLowerCase().includes(query)) continue;
    if (sessionSurface(session) !== state.surface) continue;
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
      const scopeLabel = sessionSurface(session) === 'chat' ? 'Chat' : displayProject(session.cwd);
      button.innerHTML = `<span class="session-title">${escapeHtml(session.title)}</span><span class="session-meta">${escapeHtml(scopeLabel)} · ${escapeHtml(session.model || '')}</span><button class="session-delete" title="Delete chat" aria-label="Delete chat">×</button>`;
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
        const nextForSurface = state.sessions.find((item) => sessionSurface(item) === state.surface);
        if (nextForSurface) await openSession(nextForSurface.id);
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
  renderBypassWarning();
  renderComposerState();
  renderStatusStrip();
}

function renderBypassWarning() {
  const banner = $('#bypass-banner');
  if (!banner) return;
  banner.classList.toggle('hidden', state.session?.mode !== 'bypass');
}

function renderTodos(items = state.session?.todos) {
  const bar = $('#todo-bar');
  if (!bar) return;
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  const done = list.filter((item) => item.status === 'completed').length;
  const mark = { completed: '✓', in_progress: '●', pending: '○' };
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <div class="todo-head"><span>Tasks</span><span>${done}/${list.length} done</span></div>
    <div class="todo-items">${list.map((item) => `<div class="todo-item ${escapeHtml(item.status || 'pending')}"><span class="todo-mark">${mark[item.status] || '○'}</span><span>${escapeHtml(item.content)}</span></div>`).join('')}</div>`;
}

function renderComposerState() {
  const session = state.session;
  const warning = $('#key-warning');
  const sendBtn = $('#send-btn');
  if (!session || !warning || !sendBtn) return;
  const provider = state.providers.find((item) => item.id === session.provider);
  const keyInfo = state.keys.find((item) => item.id === session.provider);
  const missingKey = Boolean(provider && !provider.keyless && (!keyInfo || !keyInfo.configured));
  const missingModel = !session.model;
  if (missingKey) {
    $('#key-warning-text').textContent = `Add a ${provider.name} key in Keys or pick a keyless model to send.`;
    warning.classList.remove('hidden');
  } else if (missingModel) {
    $('#key-warning-text').textContent = 'Choose a model before sending.';
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }
  sendBtn.disabled = missingKey || missingModel;
}

function renderStatusStrip() {
  const folder = $('#strip-folder');
  const branch = $('#strip-branch');
  const ctx = $('#strip-context');
  const usage = $('#strip-usage');
  if (folder) {
    folder.textContent = state.surface === 'chat'
      ? ''
      : displayProject(state.codeProject || state.project || state.session?.cwd);
  }
  if (branch) {
    if (state.surface === 'code' && state.gitBranch) {
      branch.textContent = state.gitBranch;
      branch.classList.remove('hidden');
    } else {
      branch.classList.add('hidden');
    }
  }
  if (ctx) {
    const pct = state.contextReport ? `${state.contextReport.percent}%` : '0%';
    ctx.textContent = `${pct} context`;
  }
  if (usage) {
    usage.textContent = state.streaming
      ? 'Streaming reply…'
      : state.lastUsageText || 'CAELIX can make mistakes. Review changes.';
  }
}

async function refreshGitBranch() {
  if (state.surface === 'chat') {
    state.gitBranch = null;
    renderStatusStrip();
    return;
  }
  try {
    const res = await api.invoke('git:branch', { cwd: state.project || state.session?.cwd });
    state.gitBranch = res?.branch || null;
  } catch {
    state.gitBranch = null;
  }
  renderStatusStrip();
}

function renderAttachments() {
  const list = $('#attachment-list');
  if (!list) return;
  if (!state.attachments.length) {
    list.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  list.classList.remove('hidden');
  list.innerHTML = state.attachments.map((item, idx) => `
    <span class="att-chip">
      ${item.kind === 'image' && item.dataUrl ? `<img class="att-thumb" src="${item.dataUrl}" alt="">` : ''}
      <span>${escapeHtml(item.name)}</span>
      <button type="button" class="att-remove" data-att-idx="${idx}" aria-label="Remove attachment">×</button>
    </span>`).join('');
  for (const btn of $$('.att-remove', list)) {
    btn.addEventListener('click', () => {
      state.attachments.splice(Number(btn.dataset.attIdx), 1);
      renderAttachments();
    });
  }
}

function recentProjectFolders() {
  const chatDir = state.info?.chatRoot;
  const seen = new Set();
  const out = [];
  const codeSessions = (state.sessions || []).filter((s) => sessionSurface(s) === 'code');
  for (const dir of [state.codeProject, state.project, state.session?.cwd, ...codeSessions.map((s) => s.cwd)]) {
    if (!dir || dir === chatDir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
    if (out.length >= 5) break;
  }
  return out;
}

function folderBaseName(dir) {
  if (!dir) return 'Choose folder';
  const parts = String(dir).split('/').filter(Boolean);
  return parts[parts.length - 1] || dir;
}

function folderParentLabel(dir) {
  if (!dir) return '';
  const parts = String(dir).split('/');
  if (parts.length <= 2) return '/';
  return parts.slice(0, -1).join('/').replace(/^\/Users\/[^/]+/, '~');
}

function renderEmpty() {
  const transcript = $('#transcript');
  if (state.surface === 'chat') {
    transcript.innerHTML = `
      <div class="empty-state">
        <img src="../../assets/icon-1024.png" alt="CAELIX">
        <h1>How can I help today?</h1>
        <p>Chat cleanly while keeping MCP servers, Skills, Hooks and Agents active across your session.</p>
        <div class="chat-capability-pills">
          <button type="button" class="cap-pill" data-open-modal="mcp">MCP Servers</button>
          <button type="button" class="cap-pill" data-open-modal="hooks">Lifecycle Hooks</button>
          <button type="button" class="cap-pill" data-open-modal="helper">Agents</button>
          <button type="button" class="cap-pill" data-open-modal="memory">Skills &amp; Memory</button>
          <button type="button" class="cap-pill" id="empty-open-code">Switch to &lt;/&gt; Code</button>
        </div>
        <div class="empty-grid">
          <button class="empty-card" data-example="Summarize what my connected MCP tools and Skills can do right now."><b>Explore capabilities</b>Inspect connected MCP tools, Hooks, Agents &amp; Skills.</button>
          <button class="empty-card" data-example="Help me brainstorm, compare options, and save key decisions to memory."><b>Think &amp; remember</b>Reason through a question and save notes to Memory MCP.</button>
          <button class="empty-card" data-example="Research this topic and run a focused Agent to verify details."><b>Research with Agents</b>Delegate structured investigation to built-in Agents.</button>
        </div>
      </div>`;
    for (const pill of $$('.cap-pill[data-open-modal]', transcript)) {
      pill.addEventListener('click', () => {
        const target = pill.dataset.openModal;
        if (target === 'mcp') openMcp();
        else if (target === 'hooks') openHooks();
        else if (target === 'helper') openHelper();
        else if (target === 'memory') openMemory();
      });
    }
    $('#empty-open-code', transcript)?.addEventListener('click', () => applySurface('code', true));
  } else {
    const folders = recentProjectFolders();
    const folderRows = folders.map((dir) => {
      const active = dir === state.project;
      return `
        <button type="button" class="folder-pick-item${active ? ' active' : ''}" data-pick-folder="${escapeHtml(dir)}" title="${escapeHtml(dir)}">
          <span class="folder-pick-dot"></span>
          <span class="folder-pick-name">${escapeHtml(folderBaseName(dir))}</span>
          <span class="folder-pick-path">${escapeHtml(folderParentLabel(dir))}</span>
        </button>`;
    }).join('');
    transcript.innerHTML = `
      <div class="empty-state has-folder-picker">
        <img src="../../assets/icon-1024.png" alt="CAELIX">
        <h1>What should we build?</h1>
        <p>CAELIX Code works inside ${escapeHtml(displayProject(state.project))}. Tools, Changes, Terminal, MCP, Skills, Hooks and Agents stay ready.</p>
        <div class="folder-picker-card">
          <div class="folder-picker-head">
            <span>Code workspace folder</span>
            <span>${folders.length} recent</span>
          </div>
          ${folderRows}
          <button type="button" id="empty-choose-folder" class="folder-choose-btn">
            <span>Choose folder…</span>
            <span>Open</span>
          </button>
        </div>
        <div class="empty-grid">
          <button class="empty-card" data-example="Explain this project and list the most important files."><b>Explore</b>Map the project and the files that matter.</button>
          <button class="empty-card" data-example="Find one small improvement, make it, and verify it."><b>Improve</b>Find, change and check a real improvement.</button>
          <button class="empty-card" data-example="Run the tests and fix the first failure."><b>Fix</b>Run the checks and repair the first error.</button>
        </div>
      </div>`;
    for (const btn of $$('.folder-pick-item[data-pick-folder]', transcript)) {
      btn.addEventListener('click', () => {
        selectProjectFolder(btn.dataset.pickFolder).catch((error) => toast(error.message));
      });
    }
    $('#empty-choose-folder', transcript)?.addEventListener('click', pickProject);
  }
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
  card.className = `tool-card${state.viewMode === 'verbose' ? ' expanded' : ''}`;
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

function attachCopyButton(button, getText) {
  if (!button) return;
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    const text = String(getText() || '');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const prev = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = prev; }, 1200);
    } catch {
      toast('Clipboard unavailable.');
    }
  });
}

function buildUserMessageNode(content, attachments = []) {
  const node = document.createElement('div');
  node.className = 'msg user';
  const atts = Array.isArray(attachments) && attachments.length
    ? `<div class="msg-attachments">${attachments.map((att) => `<span class="msg-att">${escapeHtml(att.name)}</span>`).join('')}</div>`
    : '';
  node.innerHTML = `<div class="bubble">${atts}${escapeHtml(content)}</div><button type="button" class="msg-user-copy" title="Copy message">Copy</button>`;
  attachCopyButton(node.querySelector('.msg-user-copy'), () => content);
  return node;
}

function appendTurnSummaryCard(summary, container) {
  if (!summary || !summary.markdown || !container) return null;
  const card = document.createElement('div');
  card.className = `turn-summary-card ${summary.status || 'completed'}`;
  const sec = ((summary.elapsedMs || 0) / 1000).toFixed(1);
  const label = summary.status === 'failed'
    ? `Failed · ${summary.completedCount || 0} completed · ${sec}s`
    : summary.status === 'stopped'
      ? `Stopped · ${summary.completedCount || 0} completed · ${sec}s`
      : summary.status === 'paused'
        ? `Paused · awaiting permission · ${sec}s`
        : `Summary · ${summary.completedCount || 0} action(s) · ${sec}s`;
  card.innerHTML = `
    <div class="turn-summary-head">
      <span>${escapeHtml(label)}</span>
      <button type="button" class="turn-summary-copy">Copy summary</button>
    </div>
    <div class="md">${renderMarkdown(summary.markdown)}</div>`;
  attachCopyButton(card.querySelector('.turn-summary-copy'), () => summary.markdown);
  container.appendChild(card);
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

function buildResetDivider(summary) {
  const divider = document.createElement('div');
  divider.className = 'context-reset-divider';
  if (summary) divider.title = summary;
  divider.innerHTML = '<span>Context reset — usage cleared, context summary carried forward</span>';
  return divider;
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
  for (let idx = 0; idx < session.messages.length; idx += 1) {
    const message = session.messages[idx];
    if (session.contextOffset && idx === session.contextOffset) {
      transcript.appendChild(buildResetDivider(message.resetHandoff ? message.content : ''));
    }
    if (message.role === 'tool' || message.hidden) continue;
    if (message.role === 'user') {
      transcript.appendChild(buildUserMessageNode(message.content, message.attachments));
      continue;
    }
    if (message.role === 'assistant') {
      const node = document.createElement('div');
      node.className = 'msg assistant';
      const body = document.createElement('div');
      body.className = 'assistant-body';
      body.innerHTML = `<div class="msg-label"><img src="../../assets/icon-1024.png" alt=""><span>CAELIX</span><button type="button" class="msg-copy-btn" title="Copy reply">Copy</button></div><div class="md">${renderMarkdown(message.content || '')}</div>`;
      attachCopyButton(body.querySelector('.msg-copy-btn'), () => message.content || message.turnSummary?.markdown || body.querySelector('.md')?.innerText || '');
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
      if (message.turnSummary) appendTurnSummaryCard(message.turnSummary, body);
      node.appendChild(body);
      transcript.appendChild(node);
    }
  }
  if (session.contextOffset && session.contextOffset >= session.messages.length) {
    transcript.appendChild(buildResetDivider(''));
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

async function resetCurrentChatContext(focus = '') {
  if (!state.session) return;
  if (state.streaming) {
    toast('Stop the current reply before resetting context.');
    return;
  }
  toast('Summarizing context & resetting usage…');
  const res = await api.invoke('chat:reset', { sessionId: state.session.id, focus });
  state.session = await api.invoke('sessions:get', state.session.id);
  state.contextReport = res.report || await api.invoke('context:get', { sessionId: state.session.id }).catch(() => null);
  state.lastUsageText = '';
  renderAll();
  if (res.summarizedCount > 0) {
    appendInlineNote(
      'Context reset — ready to continue',
      `Summarized **${res.summarizedCount}** message(s) into a lightweight handoff note (**${res.beforeTokens.toLocaleString()} → ${res.afterTokens.toLocaleString()}** tokens) so CAELIX remembers what you were doing while resetting chat usage.\n\n${res.summary}`,
    );
  } else {
    toast('Context usage is already fresh.');
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
      <span class="context-unit">of ${report.limit.toLocaleString()} chat window</span>
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
    <div class="context-foot">${report.messages} active message(s) in AI memory${report.savedMessages > report.messages ? ` · ${report.savedMessages} kept in scroll` : ''}. Auto-resets at ${report.autoResetPercent || 70}% (/reset). Not an account limit.</div>
    <div class="context-actions-row">
      <button type="button" id="context-reset-btn" class="context-action-btn" title="Summarize what has happened so far and reset chat usage (/reset)">Reset chat context (/reset)</button>
    </div>`;
  $('#context-reset-btn', node)?.addEventListener('click', () => { resetCurrentChatContext().catch((err) => toast(err.message)); });
  if (state.promptOpen) loadPromptInspector().catch(() => {});
}

async function loadPromptInspector() {
  const pre = $('#prompt-inspector');
  if (!pre || !state.session) return;
  const data = await api.invoke('system:prompt', { sessionId: state.session.id });
  pre.textContent = data ? `${data.prompt}\n\n[${data.tokens.toLocaleString()} est. tokens · ${data.chars.toLocaleString()} chars]` : 'No active chat.';
}

async function togglePromptInspector() {
  state.promptOpen = !state.promptOpen;
  const pre = $('#prompt-inspector');
  const btn = $('#prompt-inspector-btn');
  if (!pre || !btn) return;
  pre.classList.toggle('hidden', !state.promptOpen);
  btn.textContent = state.promptOpen ? 'Hide system prompt' : 'Inspect system prompt';
  if (state.promptOpen) await loadPromptInspector();
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
    const masks = Array.isArray(provider.masks) ? provider.masks : (provider.masked ? [provider.masked] : []);
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
        <input id="key-input-${provider.id}" type="password" autocomplete="off" spellcheck="false" placeholder="${configured ? 'Paste another key (or comma-separated keys) to rotate' : 'Paste key(s) — comma-separate 3–6 keys to rotate'}">
        <button id="key-save-${provider.id}" class="primary">Save</button>
        <button id="key-add-${provider.id}" title="Add key(s) to rotation pool">+ Add</button>
        <button id="key-test-${provider.id}">Test</button>
        ${configured ? `<button id="key-delete-${provider.id}">Delete</button>` : ''}
      </div>
      ${masks.length > 1 || masks.length === 1 ? `<div class="key-pool" id="key-pool-${provider.id}">${masks.map((m, idx) => `<span class="key-chip">${escapeHtml(m)}<button type="button" data-rm-provider="${provider.id}" data-rm-idx="${idx}" title="Remove this key">×</button></span>`).join('')}</div>` : ''}
      <div class="key-hint" id="key-hint-${provider.id}"></div>`}
    `;
    rows.appendChild(row);

    if (!provider.keyless) {
      const input = $(`#key-input-${provider.id}`);
      const hint = $(`#key-hint-${provider.id}`);
      const saveHandler = async (append) => {
        const value = input.value.trim();
        if (!value) { hint.textContent = 'Paste a key first.'; return; }
        try {
          const res = await api.invoke('keys:save', { provider: provider.id, key: value, append });
          input.value = '';
          hint.textContent = res.count > 1 ? `Saved ${res.count} encrypted keys for automatic rotation.` : 'Saved, encrypted by macOS.';
          await refreshKeys();
          api.invoke('providers:refresh', { provider: provider.id })
            .then((refreshed) => {
              const target = state.providers.find((item) => item.id === provider.id);
              if (target && Array.isArray(refreshed?.models)) target.models = refreshed.models;
            })
            .catch(() => {});
        } catch (error) {
          hint.textContent = error.message;
        }
      };
      $(`#key-save-${provider.id}`).addEventListener('click', () => saveHandler(false));
      $(`#key-add-${provider.id}`)?.addEventListener('click', () => saveHandler(true));
      $(`#key-test-${provider.id}`).addEventListener('click', async () => {
        hint.textContent = 'Testing…';
        try {
          const model = state.session?.provider === provider.id ? state.session.model : undefined;
          const res = await api.invoke('keys:test', { provider: provider.id, key: input.value.trim() || undefined, model });
          hint.textContent = res?.message || 'Key accepted. It can reach the model.';
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
      for (const rm of $$('[data-rm-provider]', row)) {
        rm.addEventListener('click', async () => {
          await api.invoke('keys:remove-one', { provider: rm.dataset.rmProvider, index: Number(rm.dataset.rmIdx) });
          await refreshKeys();
          toast('Removed key from rotation pool.');
        });
      }
    }
  }
}

async function refreshKeys() {
  state.keys = await api.invoke('keys:status');
  renderKeys();
  renderComposerState();
}

let refreshSessionsSeq = 0;
let openSessionSeq = 0;

async function refreshSessions() {
  const seq = ++refreshSessionsSeq;
  const list = await api.invoke('sessions:list');
  if (seq !== refreshSessionsSeq) return;
  state.sessions = list.sessions;
  state.activeId = list.activeId;
  renderSessions();
}

function renderAll() {
  renderChips();
  renderTodos();
  renderAttachments();
  renderTranscript();
  renderChanges();
  renderTerminal();
  renderContext();
  renderCheckpoints();
  renderSessions();
  renderStatusStrip();
}

async function openSession(id) {
  const seq = ++openSessionSeq;
  const session = await api.invoke('sessions:get', id);
  if (!session || seq !== openSessionSeq) return;
  await api.invoke('sessions:set-active', id);
  if (seq !== openSessionSeq) return;
  const surf = sessionSurface(session);
  state.session = session;
  state.activeId = session.id;
  state.changes = (session.changes || []).filter((change) => change.file);
  state.terminal = session.terminal || [];
  if (surf === 'chat') {
    state.project = state.info?.chatRoot || session.cwd;
  } else {
    state.project = session.cwd;
    if (session.cwd && session.cwd !== state.info?.chatRoot) state.codeProject = session.cwd;
  }
  if (state.surface !== surf) {
    await applySurface(surf, true, { skipSessionSwitch: true });
    if (seq !== openSessionSeq) return;
  }
  state.projectFiles = null;
  state.lastUsageText = '';
  try {
    state.contextReport = await api.invoke('context:get', { sessionId: id });
  } catch {
    state.contextReport = null;
  }
  await loadCheckpoints();
  await loadTerminalTabs();
  if (seq !== openSessionSeq) return;
  if (surf === 'code') refreshGitBranch();
  renderAll();
  scrollToBottom(true);
}

async function newChat() {
  const targetSurface = state.surface === 'chat' ? 'chat' : 'code';
  const session = await api.invoke('sessions:create', {
    cwd: targetSurface === 'chat' ? null : (state.codeProject || state.project),
    surface: targetSurface,
    provider: state.session?.provider || (state.info.selfcheck ? 'simulator' : 'gemini'),
    model: state.session?.model || (state.info.selfcheck ? 'sim-1' : 'gemini-2.5-flash'),
    mode: state.session?.mode || 'ask',
  });
  state.session = session;
  state.activeId = session.id;
  state.project = session.cwd;
  if (targetSurface === 'code' && session.cwd && session.cwd !== state.info?.chatRoot) {
    state.codeProject = session.cwd;
  }
  state.changes = [];
  state.terminal = [];
  state.contextReport = null;
  state.checkpoints = [];
  state.terminalTabs = [];
  state.activeTerminalId = null;
  state.attachments = [];
  state.lastUsageText = '';
  await refreshSessions();
  renderAll();
  await loadTerminalTabs();
  refreshGitBranch();
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
  renderStatusStrip();
}

function ensureLiveAssistant() {
  if (state.currentAssistant) return state.currentAssistant;
  const node = document.createElement('div');
  node.className = 'msg assistant';
  const body = document.createElement('div');
  body.className = 'assistant-body';
  body.innerHTML = '<div class="msg-label"><img src="../../assets/icon-1024.png" alt=""><span>CAELIX</span><button type="button" class="msg-copy-btn" title="Copy reply">Copy</button></div><div class="md"><span class="typing"><i></i><i></i><i></i></span></div>';
  attachCopyButton(body.querySelector('.msg-copy-btn'), () => body.dataset.rawText || body.querySelector('.md')?.innerText || '');
  node.appendChild(body);
  $('#transcript').appendChild(node);
  state.currentAssistant = { node, body, md: $('.md', body) };
  scrollToBottom(true);
  return state.currentAssistant;
}

function paintLive() {
  if (!state.currentAssistant) return;
  state.currentAssistant.body.dataset.rawText = state.liveText;
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
  const prev = document.getElementById('permission-card');
  if (prev) {
    prev.removeAttribute('id');
    prev.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  }
  const card = document.createElement('div');
  card.className = 'permission-card';
  card.id = 'permission-card';
  card.dataset.permissionId = request.id;
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
        ? 'Cancelled. Remaining actions in this step stopped.'
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

function clearRetryBanner() {
  if (state.retryBanner) {
    state.retryBanner.remove();
    state.retryBanner = null;
  }
}

function appendError(message) {
  clearRetryBanner();
  if (state.currentAssistant && !state.liveText) {
    state.currentAssistant.md.innerHTML = '';
  }
  const card = document.createElement('div');
  card.className = 'error-card';
  const msg = document.createElement('div');
  msg.textContent = message;
  card.appendChild(msg);
  const actions = document.createElement('div');
  actions.className = 'error-actions';
  const showRecovery = /401|403|404|408|429|rate.?limit|key|billing|free tier|quota|permission_denied|not found for account|did not respond|timed out|stalled/i.test(message);
  actions.innerHTML = `${showRecovery ? '<button type="button" data-err-action="keys">Open Keys</button><button type="button" data-err-action="model">Switch Model</button>' : ''}<button type="button" data-err-action="copy">Copy error</button>`;
  actions.querySelector('[data-err-action="keys"]')?.addEventListener('click', openKeys);
  actions.querySelector('[data-err-action="model"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = $('#model-menu');
    menu.classList.remove('hidden');
    renderModelMenu('', { focus: true });
  });
  attachCopyButton(actions.querySelector('[data-err-action="copy"]'), () => message);
  card.appendChild(actions);
  if (state.currentAssistant) state.currentAssistant.body.appendChild(card);
  else $('#transcript').appendChild(card);
  scrollToBottom();
}

function appendInlineNote(title, markdown) {
  const card = document.createElement('div');
  card.className = 'btw-card';
  card.innerHTML = `
    <div class="btw-head"><span>${escapeHtml(title)}</span><button type="button" class="btw-close" title="Dismiss" aria-label="Dismiss">×</button></div>
    <div class="md">${renderMarkdown(markdown)}</div>`;
  card.querySelector('.btw-close').addEventListener('click', () => card.remove());
  $('#transcript').appendChild(card);
  scrollToBottom(true);
}

function onChatEvent(event) {
  switch (event.type) {
    case 'turn-start':
      state.sendStartedAt = performance.now();
      state.firstWordAt = null;
      clearRetryBanner();
      setStreaming(true);
      ensureLiveAssistant();
      break;
    case 'status': {
      ensureLiveAssistant();
      if (!state.liveText && state.currentAssistant.md.querySelector('.typing')) {
        state.currentAssistant.md.innerHTML = `<span class="typing"><i></i><i></i><i></i></span><span class="stream-note">${escapeHtml(event.message || '')}</span>`;
      }
      if (event.message) $('#stream-status').textContent = event.message;
      if (event.stage === 'fallback' && event.message) toast(event.message);
      break;
    }
    case 'text': {
      clearRetryBanner();
      if (!state.firstWordAt) state.firstWordAt = performance.now();
      if (state.currentAssistant?.hasTools) {
        if (state.liveRaf) {
          cancelAnimationFrame(state.liveRaf);
          state.liveRaf = 0;
        }
        state.currentAssistant.md.innerHTML = state.liveText ? renderMarkdown(state.liveText) : '';
        state.currentAssistant = null;
        state.liveText = '';
      }
      ensureLiveAssistant();
      state.liveText += event.delta;
      scheduleLivePaint();
      break;
    }
    case 'tool-start': {
      clearRetryBanner();
      ensureLiveAssistant();
      state.currentAssistant.hasTools = true;
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
    case 'subagent-start': {
      ensureLiveAssistant();
      state.currentAssistant.hasTools = true;
      if (state.currentAssistant.md.querySelector('.typing')) {
        state.currentAssistant.md.innerHTML = renderMarkdown(state.liveText);
      }
      const card = document.createElement('div');
      card.className = 'helper-card';
      card.id = `helper-${event.id}`;
      const agentTitle = event.agentName ? `Agent · ${event.agentName}` : 'Helper Agent';
      card.innerHTML = `
        <div class="helper-head"><span>${escapeHtml(agentTitle)}</span><span>${escapeHtml(String(event.task || '').slice(0, 120))}</span></div>
        <div class="helper-steps">Running investigation…</div>`;
      state.currentAssistant.body.appendChild(card);
      scrollToBottom();
      break;
    }
    case 'subagent-event': {
      const card = document.getElementById(`helper-${event.parentId}`);
      if (!card) break;
      const steps = card.querySelector('.helper-steps');
      const label = event.tool ? `${event.tool}${event.target ? ` · ${event.target}` : ''}` : event.type;
      if (label) {
        const line = document.createElement('div');
        line.textContent = `· ${label}`;
        if (steps.textContent === 'Running read-only investigation…') steps.textContent = '';
        steps.appendChild(line);
      }
      break;
    }
    case 'subagent-end': {
      const card = document.getElementById(`helper-${event.id}`);
      if (!card) break;
      const steps = card.querySelector('.helper-steps');
      if (steps && (steps.textContent === 'Running read-only investigation…' || steps.textContent === 'Running investigation…')) {
        steps.textContent = 'Completed investigation';
      }
      const md = document.createElement('div');
      md.className = 'md';
      md.innerHTML = renderMarkdown(String(event.summary || 'Helper finished.').slice(0, 1200));
      card.appendChild(md);
      scrollToBottom();
      break;
    }
    case 'hook-event': {
      if (!state.currentAssistant) break;
      const note = document.createElement('div');
      note.className = `hook-note${event.blocked ? ' blocked' : ''}`;
      note.textContent = `Hook ${event.event}${event.tool ? ` (${event.tool})` : ''}${event.blocked ? ' BLOCKED' : ''}: ${String(event.output || '').slice(0, 200)}`;
      state.currentAssistant.body.appendChild(note);
      scrollToBottom();
      break;
    }
    case 'permission-request':
      appendPermission(event);
      break;
    case 'permission-resolved': {
      const card = document.querySelector(`[data-permission-id="${event.id}"]`);
      if (card) {
        for (const button of $$('button', card)) button.disabled = true;
        const detail = card.querySelector('.permission-detail');
        if (detail) {
          detail.textContent = event.reason === 'stopped'
            ? 'Stopped while waiting for permission.'
            : 'Permission prompt timed out.';
        }
      }
      break;
    }
    case 'question-request':
      appendQuestion(event);
      break;
    case 'plan':
      appendPlan(event);
      break;
    case 'retry': {
      ensureLiveAssistant();
      if (!state.liveText && state.currentAssistant.md.querySelector('.typing')) {
        state.currentAssistant.md.innerHTML = '';
      }
      if (!state.retryBanner) {
        state.retryBanner = document.createElement('div');
        state.retryBanner.className = 'retry-banner';
        state.currentAssistant.body.appendChild(state.retryBanner);
      }
      const secs = Math.max(1, Math.ceil((event.remainingMs ?? event.waitMs ?? 1000) / 1000));
      const total = event.maxAttempts || 5;
      state.retryBanner.textContent = `${event.reason || 'Rate limit / provider error'}. Waiting ${secs}s before retry ${event.attempt}/${total}…`;
      $('#stream-status').textContent = `Retry ${event.attempt}/${total} in ${secs}s`;
      scrollToBottom();
      break;
    }
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
    case 'browser-state': {
      const appEl = $('#app');
      const needsPanel = Boolean(event.visible) && (
        state.activePanelTab !== 'browser'
        || appEl?.classList.contains('panel-collapsed')
        || (state.surface === 'chat' && !appEl?.classList.contains('browser-open'))
      );
      state.browserState = {
        visible: Boolean(event.visible),
        url: event.url || '',
        title: event.title || '',
        canBack: Boolean(event.canBack),
        canForward: Boolean(event.canForward),
        loading: Boolean(event.loading),
      };
      updateBrowserToolbar();
      if (event.error) toast(`Browser error: ${event.error}`);
      if (needsPanel) openBrowserPanel({ focusInput: false });
      break;
    }
    case 'todos':
      if (state.session) state.session.todos = event.items || [];
      renderTodos(event.items || []);
      break;
    case 'context':
      state.contextReport = event.report;
      renderContext();
      renderStatusStrip();
      if (event.compacted) toast(`Compacted ${event.compacted} older message(s) to fit the context window.`);
      break;
    case 'auto-reset':
      if (state.session && (!event.sessionId || event.sessionId === state.session.id)) {
        state.contextReport = event.report || state.contextReport;
        state.lastUsageText = '';
        api.invoke('sessions:get', state.session.id).then((fresh) => {
          if (!fresh || state.session?.id !== fresh.id) return;
          state.session = fresh;
          renderAll();
          if (event.summarizedCount > 0) {
            appendInlineNote(
              'Context auto-reset — ready to continue',
              `Context reached threshold and automatically ran **/reset**, summarizing **${event.summarizedCount}** message(s) (**${event.beforeTokens.toLocaleString()} → ${event.afterTokens.toLocaleString()}** tokens) so work continues cleanly.\n\n${event.summary}`,
            );
          }
          toast('Context reached threshold — auto-reset with /reset summary.');
        }).catch(() => {});
      }
      break;
    case 'checkpoint':
      state.checkpoints = [event.checkpoint, ...state.checkpoints.filter((item) => item.id !== event.checkpoint.id)];
      renderCheckpoints();
      break;
    case 'rewound':
      toast(`Restored ${event.restored.length} file(s).`);
      break;
    case 'done':
      if (state.liveRaf) {
        cancelAnimationFrame(state.liveRaf);
        state.liveRaf = 0;
      }
      if (state.currentAssistant && state.liveText) {
        paintLive();
      }
      setStreaming(false);
      if (event.context) {
        state.contextReport = event.context;
        renderContext();
      }
      if (event.compacted) toast(`Compacted ${event.compacted} older message(s) to fit the context window.`);
      if (state.currentAssistant) {
        if (!state.liveText) state.currentAssistant.md.innerHTML = '';
        if (event.summary && !event.error) {
          appendTurnSummaryCard(event.summary, state.currentAssistant.body);
        }
      }
      {
        const tokens = event.usage?.total_tokens || event.estimatedTokens;
        const sec = ((event.elapsedMs || 0) / 1000).toFixed(1);
        state.lastUsageText = tokens ? `${tokens} tokens · ${sec}s` : `${sec}s`;
        $('#stream-status').textContent = state.lastUsageText;
      }
      renderStatusStrip();
      state.currentAssistant = null;
      state.liveText = '';
      refreshSessions();
      break;
    case 'error':
      if (state.liveRaf) {
        cancelAnimationFrame(state.liveRaf);
        state.liveRaf = 0;
      }
      if (state.currentAssistant && state.liveText) {
        paintLive();
      }
      setStreaming(false);
      appendError(event.message);
      if (event.summary) {
        appendTurnSummaryCard(event.summary, state.currentAssistant ? state.currentAssistant.body : $('#transcript'));
      }
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

const SLASH_COMMANDS = [
  { name: '/compact', args: '[focus]', desc: 'Summarize older messages to save context tokens' },
  { name: '/reset', args: '', desc: 'Summarize what has happened so far and reset chat usage to continue cleanly' },
  { name: '/btw', args: '<question>', desc: 'Ask an ephemeral side question without saving to history' },
  { name: '/chat', args: '', desc: 'Switch workspace to Chat mode (MCP, Skills, Hooks & Agents stay active)' },
  { name: '/code', args: '', desc: 'Switch workspace to Code mode with Changes, Terminal & folder picker' },
  { name: '/folder', args: '', desc: 'Choose or switch the active Code project folder' },
  { name: '/helper', args: '<task>', desc: 'Run the read-only Helper Agent on a focused task' },
  { name: '/agent', args: '<task>', desc: 'Alias for /helper' },
  { name: '/mcp', args: '', desc: 'Manage stdio or HTTP MCP servers' },
  { name: '/hooks', args: '', desc: 'Manage PreToolUse, PostToolUse, UserPromptSubmit & Stop hooks' },
  { name: '/memory', args: '', desc: 'Open Project memory (CAELIX.md / AGENTS.md)' },
  { name: '/keys', args: '', desc: 'Open API Keys manager' },
  { name: '/model', args: '[id]', desc: 'Switch active model or open Model picker' },
  { name: '/mode', args: '[ask|accept|plan|bypass]', desc: 'Switch permission mode' },
  { name: '/context', args: '', desc: 'Inspect context window breakdown' },
  { name: '/cost', args: '', desc: 'Show session token & status summary' },
  { name: '/usage', args: '', desc: 'Alias for /cost' },
  { name: '/status', args: '', desc: 'Show session, provider, MCP & hook status' },
  { name: '/review', args: '', desc: 'Ask CAELIX to review recent project changes' },
  { name: '/export', args: '', desc: 'Save chat transcript as Markdown' },
  { name: '/clear', args: '', desc: 'Start a fresh chat' },
  { name: '/help', args: '', desc: 'List available slash commands' },
];

function hideCommands() {
  state.commandMatches = [];
  $('#command-menu')?.classList.add('hidden');
}

function updateCommands() {
  const prompt = $('#prompt');
  const menu = $('#command-menu');
  if (!prompt || !menu) return;
  const val = prompt.value;
  if (!val.startsWith('/') || /\s/.test(val.slice(1))) {
    hideCommands();
    return;
  }
  const q = val.slice(1).toLowerCase();
  const matches = SLASH_COMMANDS.filter((c) => c.name.slice(1).includes(q));
  if (!matches.length) {
    hideCommands();
    return;
  }
  state.commandMatches = matches;
  state.commandIndex = 0;
  menu.innerHTML = matches.map((c, idx) => `
    <button type="button" class="cmd-item${idx === 0 ? ' active' : ''}" data-cmd="${escapeHtml(c.name)}">
      <span class="cmd-name">${escapeHtml(c.name)}</span>
      <span class="cmd-desc">${escapeHtml(c.args ? `${c.args} · ` : '')}${escapeHtml(c.desc)}</span>
    </button>`).join('');
  menu.classList.remove('hidden');
  for (const item of $$('.cmd-item', menu)) {
    item.addEventListener('click', () => selectCommand(item.dataset.cmd));
  }
}

function selectCommand(cmdName) {
  const prompt = $('#prompt');
  const def = SLASH_COMMANDS.find((c) => c.name === cmdName);
  hideCommands();
  if (!def || !def.args) {
    prompt.value = cmdName;
    sendMessage();
    return;
  }
  prompt.value = `${cmdName} `;
  resizePrompt();
  prompt.focus();
}

async function runSlashCommand(raw) {
  const trimmed = raw.trim();
  const space = trimmed.indexOf(' ');
  const cmd = (space >= 0 ? trimmed.slice(0, space) : trimmed).toLowerCase();
  const arg = space >= 0 ? trimmed.slice(space + 1).trim() : '';

  switch (cmd) {
    case '/help': {
      const list = SLASH_COMMANDS.map((c) => `- \`${c.name}${c.args ? ` ${c.args}` : ''}\` — ${c.desc}`).join('\n');
      appendInlineNote('Slash commands', list);
      return true;
    }
    case '/mcp':
      await openMcp();
      return true;
    case '/hooks':
      await openHooks();
      return true;
    case '/memory':
      await openMemory();
      return true;
    case '/keys':
      openKeys();
      return true;
    case '/chat':
      applySurface('chat', true);
      toast('Switched to Chat mode.');
      return true;
    case '/code':
      applySurface('code', true);
      toast('Switched to Code mode.');
      return true;
    case '/folder':
      await pickProject();
      return true;
    case '/clear':
    case '/new':
      await newChat();
      toast('Started a fresh chat.');
      return true;
    case '/context':
      $('#app').classList.remove('panel-collapsed');
      document.querySelector('.panel-tab[data-tab="context"]')?.click();
      if (state.contextReport) {
        appendInlineNote('Context usage', `**${state.contextReport.total.toLocaleString()}** / ${state.contextReport.limit.toLocaleString()} tokens (${state.contextReport.percent}%) across **${state.contextReport.messages}** message(s).`);
      }
      return true;
    case '/cost':
    case '/usage':
    case '/status': {
      const report = state.contextReport || await api.invoke('context:get', { sessionId: state.session.id }).catch(() => null);
      const mcpCount = await api.invoke('mcp:list', { cwd: state.project }).then((r) => r.filter((s) => s.connected).length).catch(() => 0);
      const hooksCount = await api.invoke('hooks:list', { cwd: state.project }).then((h) => h.filter((i) => i.enabled).length).catch(() => 0);
      const summary = [
        `- **Project:** \`${state.project}\``,
        `- **Provider / Model:** \`${state.session.provider}\` / \`${state.session.model}\``,
        `- **Mode:** \`${state.session.mode}\``,
        report ? `- **Context:** ${report.total.toLocaleString()} tokens (${report.percent}% · ${report.messages} messages)` : '',
        `- **MCP connected:** ${mcpCount} · **Hooks active:** ${hooksCount}`,
        state.lastUsageText ? `- **Last turn:** ${state.lastUsageText}` : '',
      ].filter(Boolean).join('\n');
      appendInlineNote('Session status & usage', summary);
      return true;
    }
    case '/mode': {
      const alias = { manual: 'ask', ask: 'ask', accept: 'accept', 'accept-edits': 'accept', plan: 'plan', bypass: 'bypass' }[arg.toLowerCase()];
      if (alias) {
        await api.invoke('sessions:update', { id: state.session.id, mode: alias });
        state.session.mode = alias;
        renderChips();
        toast(`Mode switched to ${alias}.`);
      } else {
        const menu = $('#mode-menu');
        menu.classList.remove('hidden');
        renderModeMenu();
      }
      return true;
    }
    case '/model': {
      if (arg) {
        await chooseModel(state.session.provider, arg);
        toast(`Model switched to ${arg}.`);
      } else {
        const menu = $('#model-menu');
        menu.classList.remove('hidden');
        renderModelMenu('', { focus: true });
      }
      return true;
    }
    case '/compact': {
      toast('Compacting conversation…');
      const res = await api.invoke('chat:compact', { sessionId: state.session.id, focus: arg });
      state.session = await api.invoke('sessions:get', state.session.id);
      state.contextReport = await api.invoke('context:get', { sessionId: state.session.id }).catch(() => null);
      renderAll();
      appendInlineNote('Compacted context', `Compacted **${res.compactedCount}** older message(s) (${res.beforeTokens.toLocaleString()} → ${res.afterTokens.toLocaleString()} tokens).\n\n${res.summary}`);
      return true;
    }
    case '/reset': {
      await resetCurrentChatContext(arg);
      return true;
    }
    case '/btw': {
      if (!arg) {
        toast('Type a question after /btw');
        return true;
      }
      toast('Asking /btw side note…');
      const res = await api.invoke('chat:btw', { sessionId: state.session.id, question: arg });
      appendInlineNote(`/btw — ${res.question}`, res.answer);
      return true;
    }
    case '/helper':
    case '/agent': {
      if (!arg) {
        openHelper();
        return true;
      }
      await api.invoke('chat:helper', { sessionId: state.session.id, task: arg });
      return true;
    }
    case '/export': {
      const res = await api.invoke('chat:export', { sessionId: state.session.id });
      if (!res.canceled) toast(`Exported to ${res.filePath}`);
      return true;
    }
    case '/review':
      $('#prompt').value = 'Review recent changes in this workspace cleanly. Check for bugs, security risks, edge cases, and missing checks.';
      return false;
    default:
      appendInlineNote('Unknown command', `Unrecognized command \`${cmd}\`. Type \`/help\` to list available commands.`);
      return true;
  }
}

async function sendMessage() {
  const prompt = $('#prompt');
  const text = prompt.value.trim();
  const attachments = state.attachments.slice();
  if ((!text && !attachments.length) || state.streaming || !state.session) return;
  if (text.startsWith('/') && !attachments.length) {
    hideCommands();
    hideMentions();
    try {
      const handled = await runSlashCommand(text);
      if (handled) {
        prompt.value = '';
        resizePrompt();
        return;
      }
    } catch (error) {
      appendError(error.message);
      return;
    }
  }
  const finalPrompt = $('#prompt').value.trim();
  if ($('#send-btn').disabled) {
    openKeys();
    return;
  }
  hideCommands();
  hideMentions();
  prompt.value = '';
  state.attachments = [];
  renderAttachments();
  resizePrompt();
  state.sendStartedAt = performance.now();
  state.firstWordAt = null;
  state.liveText = '';
  state.currentAssistant = null;
  state.session.messages = state.session.messages || [];
  state.session.messages.push({ role: 'user', content: finalPrompt, attachments });
  const current = $('#transcript');
  if ($('.empty-state', current)) current.innerHTML = '';
  const node = buildUserMessageNode(finalPrompt, attachments);
  current.appendChild(node);
  scrollToBottom(true);
  setStreaming(true);
  ensureLiveAssistant();
  try {
    await api.invoke('chat:send', { sessionId: state.session.id, text: finalPrompt, attachments });
  } catch (error) {
    setStreaming(false);
    appendError(error.message);
  }
}

function updateBrowserToolbar() {
  const b = state.browserState || {};
  const back = $('#browser-back');
  const fwd = $('#browser-forward');
  const reload = $('#browser-reload');
  const urlInput = $('#browser-url');
  const empty = $('#browser-empty');
  if (back) back.disabled = !b.canBack;
  if (fwd) fwd.disabled = !b.canForward;
  if (reload) reload.textContent = b.loading ? '✕' : '↻';
  if (urlInput && document.activeElement !== urlInput && b.url) urlInput.value = b.url;
  if (empty) empty.classList.toggle('hidden', Boolean(b.url));
}

let lastBrowserBoxKey = '';

function syncBrowserView() {
  const appEl = $('#app');
  const viewport = $('#browser-viewport');
  if (!appEl || !viewport) return;
  const anyModal = Boolean(state.keysOpen || state.memoryOpen || state.mcpOpen || state.hooksOpen || state.helperOpen);
  const panelOpen = !appEl.classList.contains('panel-collapsed')
    && (state.surface === 'code' || appEl.classList.contains('browser-open'));
  const shouldShow = state.activePanelTab === 'browser' && panelOpen && !anyModal && Boolean(state.browserState?.url || state.browserState?.loading);
  if (!shouldShow) {
    if (lastBrowserBoxKey || state.browserState?.visible) {
      lastBrowserBoxKey = '';
      api.invoke('browser:hide').catch(() => {});
    }
    return;
  }
  const rect = viewport.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) {
    if (lastBrowserBoxKey || state.browserState?.visible) {
      lastBrowserBoxKey = '';
      api.invoke('browser:hide').catch(() => {});
    }
    return;
  }
  const box = {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
  const boxKey = `${box.x},${box.y},${box.width},${box.height}`;
  if (state.browserState?.visible && boxKey === lastBrowserBoxKey) return;
  lastBrowserBoxKey = boxKey;
  api.invoke('browser:show', box).catch(() => {});
}

function activatePanelTab(target) {
  state.activePanelTab = target;
  for (const tab of $$('.panel-tab')) tab.classList.toggle('active', tab.dataset.tab === target);
  $('#changes-view').classList.toggle('hidden', target !== 'changes');
  $('#terminal-view').classList.toggle('hidden', target !== 'terminal');
  $('#browser-view').classList.toggle('hidden', target !== 'browser');
  $('#context-view').classList.toggle('hidden', target !== 'context');
  if (target === 'terminal') {
    renderTerminalTabs();
    renderTerminal();
  }
  if (target === 'context') renderContext();
  requestAnimationFrame(() => syncBrowserView());
}

function openBrowserPanel({ focusInput = true } = {}) {
  const appEl = $('#app');
  if (!appEl) return;
  appEl.classList.remove('panel-collapsed');
  if (state.surface === 'chat') appEl.classList.add('browser-open');
  activatePanelTab('browser');
  if (focusInput && !state.browserState?.url) $('#browser-url')?.focus();
}

async function navigateBrowser(rawUrl) {
  const url = String(rawUrl || $('#browser-url')?.value || '').trim();
  if (!url) return;
  openBrowserPanel({ focusInput: false });
  try {
    const next = await api.invoke('browser:navigate', url);
    if (next) state.browserState = next;
    updateBrowserToolbar();
    syncBrowserView();
  } catch (error) {
    toast(error.message);
  }
}

function openKeys() {
  state.keysOpen = true;
  renderKeys();
  $('#keys-screen').classList.remove('hidden');
  syncBrowserView();
}
function closeKeys() {
  state.keysOpen = false;
  $('#keys-screen').classList.add('hidden');
  syncBrowserView();
}

function renderMcpRows(servers = []) {
  const list = $('#mcp-list');
  if (!servers.length) {
    list.innerHTML = '<div class="config-empty">No MCP servers configured yet. Add a stdio command or HTTP endpoint below.</div>';
    return;
  }
  list.innerHTML = '';
  for (const s of servers) {
    const row = document.createElement('div');
    row.className = 'config-item';
    row.dataset.name = s.name;
    const badgeClass = s.connected ? 'ok' : s.error ? 'err' : '';
    const badgeText = s.connected ? `${s.tools.length} tool(s)` : s.enabled ? (s.error ? 'Error' : 'Disconnected') : 'Disabled';
    const target = s.description || s.url || [s.command, ...(s.args || [])].join(' ');
    row.innerHTML = `
      <div class="config-item-head">
        <strong>${escapeHtml(s.name)}</strong>
        <span class="config-badge">${escapeHtml(s.scope)}</span>
        <span class="config-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
        <div class="config-actions">
          <button type="button" class="mcp-toggle">${s.enabled ? 'Disable' : 'Enable'}</button>
          <button type="button" class="mcp-remove">Remove</button>
        </div>
      </div>
      <div class="config-detail">${escapeHtml(s.error || target)}</div>`;
    row.querySelector('.mcp-toggle').addEventListener('click', async () => {
      const updated = await api.invoke('mcp:toggle', { name: s.name, scope: s.scope, cwd: state.project, enabled: !s.enabled });
      renderMcpRows(updated);
    });
    row.querySelector('.mcp-remove').addEventListener('click', async () => {
      const updated = await api.invoke('mcp:remove', { name: s.name, scope: s.scope, cwd: state.project });
      renderMcpRows(updated);
      toast(`Removed MCP server ${s.name}.`);
    });
    list.appendChild(row);
  }
}

async function openMcp() {
  state.mcpOpen = true;
  $('#mcp-screen').classList.remove('hidden');
  syncBrowserView();
  $('#mcp-list').innerHTML = '<div class="config-empty">Checking MCP servers…</div>';
  try {
    const servers = await api.invoke('mcp:list', { cwd: state.project });
    renderMcpRows(servers);
  } catch (error) {
    $('#mcp-list').innerHTML = `<div class="config-empty">${escapeHtml(error.message)}</div>`;
  }
}

function closeMcp() {
  state.mcpOpen = false;
  $('#mcp-screen').classList.add('hidden');
  syncBrowserView();
}

function renderHookRows(items = []) {
  const list = $('#hooks-list');
  if (!items.length) {
    list.innerHTML = '<div class="config-empty">No hooks configured yet. Add one below (exit code 2 blocks tools/prompts).</div>';
    return;
  }
  list.innerHTML = '';
  for (const h of items) {
    const row = document.createElement('div');
    row.className = 'config-item';
    row.dataset.id = h.id;
    row.dataset.command = h.command;
    row.innerHTML = `
      <div class="config-item-head">
        <strong>${escapeHtml(h.event)}</strong>
        <span class="config-badge">${escapeHtml(h.matcher || '*')}</span>
        <span class="config-badge">${escapeHtml(h.scope)}</span>
        <span class="config-badge ${h.enabled ? 'ok' : ''}">${h.enabled ? 'Enabled' : 'Disabled'}</span>
        <div class="config-actions">
          <button type="button" class="hook-toggle">${h.enabled ? 'Disable' : 'Enable'}</button>
          <button type="button" class="hook-remove">Remove</button>
        </div>
      </div>
      <div class="config-detail">${escapeHtml(h.command)}</div>`;
    row.querySelector('.hook-toggle').addEventListener('click', async () => {
      const updated = await api.invoke('hooks:toggle', { id: h.id, scope: h.scope, cwd: state.project, enabled: !h.enabled });
      renderHookRows(updated);
    });
    row.querySelector('.hook-remove').addEventListener('click', async () => {
      const updated = await api.invoke('hooks:remove', { id: h.id, scope: h.scope, cwd: state.project });
      renderHookRows(updated);
      toast('Hook removed.');
    });
    list.appendChild(row);
  }
}

async function openHooks() {
  state.hooksOpen = true;
  $('#hooks-screen').classList.remove('hidden');
  syncBrowserView();
  try {
    const items = await api.invoke('hooks:list', { cwd: state.project });
    renderHookRows(items);
  } catch (error) {
    $('#hooks-list').innerHTML = `<div class="config-empty">${escapeHtml(error.message)}</div>`;
  }
}

function closeHooks() {
  state.hooksOpen = false;
  $('#hooks-screen').classList.add('hidden');
  syncBrowserView();
}

function renderAgentsList(items = []) {
  const wrap = $('#agent-list');
  if (!wrap) return;
  if (!state.selectedAgent || !items.some((a) => a.id === state.selectedAgent)) {
    state.selectedAgent = items[0]?.id || 'explore';
  }
  wrap.innerHTML = '';
  for (const agent of items) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `agent-card${state.selectedAgent === agent.id ? ' active' : ''}`;
    card.dataset.agentId = agent.id;
    card.innerHTML = `
      <div class="agent-card-head">
        <strong>${escapeHtml(agent.name)}</strong>
        <span class="config-badge">${escapeHtml(agent.scope)}</span>
      </div>
      <div class="agent-card-desc">${escapeHtml(agent.description || '')}</div>`;
    card.addEventListener('click', () => {
      state.selectedAgent = agent.id;
      renderAgentsList(items);
      $('#helper-task')?.focus();
    });
    wrap.appendChild(card);
  }
}

async function openHelper() {
  state.helperOpen = true;
  $('#helper-screen').classList.remove('hidden');
  syncBrowserView();
  try {
    const list = await api.invoke('agents:list', { cwd: state.project });
    state.agents = list;
    renderAgentsList(list);
  } catch { /* fallback empty */ }
  $('#helper-task')?.focus();
}

function closeHelper() {
  state.helperOpen = false;
  $('#helper-screen').classList.add('hidden');
  syncBrowserView();
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
  syncBrowserView();
  try {
    await loadMemoryEditor();
  } catch (error) {
    $('#memory-status').textContent = error.message;
  }
}

function closeMemory() {
  state.memoryOpen = false;
  $('#memory-screen').classList.add('hidden');
  syncBrowserView();
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

function syncProviderCatalogs(onlyPid = null) {
  const targets = onlyPid
    ? [onlyPid, ...(onlyPid !== 'nvidia' ? ['nvidia'] : [])]
    : state.providers.filter((p) => !p.keyless && (p.id === 'nvidia' || state.keys.some((k) => k.id === p.id && k.configured))).map((p) => p.id);
  return Promise.allSettled(targets.map(async (pid) => {
    const res = await api.invoke('providers:refresh', { provider: pid });
    const target = state.providers.find((item) => item.id === pid);
    if (target && Array.isArray(res?.models) && res.models.length) target.models = res.models;
  }));
}

function favouriteKey(provider, model) {
  return `${provider}:${model}`;
}

async function toggleFavourite(provider, model) {
  const key = favouriteKey(provider, model);
  const next = state.favourites.includes(key)
    ? state.favourites.filter((item) => item !== key)
    : [...state.favourites, key];
  state.favourites = next;
  await api.invoke('settings:set', { favouriteModels: next }).catch(() => {});
  renderModelMenu($('#model-search')?.value || '');
}

function favouriteEntries(filter = '') {
  const query = filter.trim().toLowerCase();
  const entries = [];
  for (const item of state.favourites) {
    const [providerId, ...rest] = item.split(':');
    const model = rest.join(':');
    const provider = state.providers.find((p) => p.id === providerId);
    if (!provider || !model) continue;
    if (query && !model.toLowerCase().includes(query) && !provider.name.toLowerCase().includes(query)) continue;
    entries.push({ provider, model });
  }
  return entries;
}

function ensureModelMenuShell(menu) {
  if ($('#model-list', menu)) return;
  menu.innerHTML = [
    '<div class="pop-head-row"><input class="pop-search" id="model-search" placeholder="Search models"><button id="model-refresh" class="pop-refresh" type="button" title="Refresh live model catalog">Refresh</button></div>',
    '<div id="model-list"></div>',
    '<div class="pop-custom"><input id="custom-model" placeholder="Use any model ID"><button id="custom-model-use" type="button">Use</button></div>'
  ].join('');
  const search = $('#model-search', menu);
  search?.addEventListener('input', () => renderModelMenu());
  $('#model-refresh', menu)?.addEventListener('click', async () => {
    const pid = state.session?.provider || 'nvidia';
    const btn = $('#model-refresh', menu);
    btn.textContent = '…';
    btn.disabled = true;
    try {
      await syncProviderCatalogs(pid === 'simulator' ? null : pid);
      renderModelMenu();
      toast('Updated live model list.');
    } catch (error) {
      toast(error.message);
    } finally {
      btn.textContent = 'Refresh';
      btn.disabled = false;
    }
  });
  const applyCustomModel = async () => {
    const input = $('#custom-model', menu);
    const value = input?.value.trim();
    if (!value || !state.session) return;
    await chooseModel(state.session.provider, value);
    menu.classList.add('hidden');
  };
  $('#custom-model-use', menu)?.addEventListener('click', applyCustomModel);
  $('#custom-model', menu)?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyCustomModel();
    }
  });
}

function renderModelMenu(filter = null, options = {}) {
  const menu = $('#model-menu');
  ensureModelMenuShell(menu);
  const search = $('#model-search', menu);
  const list = $('#model-list', menu);
  if (typeof filter === 'string' && search && search.value !== filter) {
    search.value = filter;
  }
  const activeFilter = typeof filter === 'string' ? filter : (search?.value || '');
  if (!state.modelsAutoSynced && !state.info?.selfcheck) {
    state.modelsAutoSynced = true;
    syncProviderCatalogs().then(() => {
      if (!menu.classList.contains('hidden')) renderModelMenu();
    }).catch(() => {});
  }
  const query = activeFilter.trim().toLowerCase();
  const favourites = favouriteEntries(activeFilter);
  const chunks = [];
  if (favourites.length) {
    chunks.push(`<div class="pop-section">Favourites (${favourites.length})</div>`);
    for (const { provider, model } of favourites) {
      const active = state.session && state.session.provider === provider.id && state.session.model === model;
      const note = provider.modelNotes?.[model];
      const sub = active ? `Current model${note ? ` · ${note}` : ''}` : (note || provider.name);
      chunks.push(`<button class="pop-item${active ? ' active' : ''}" data-provider="${provider.id}" data-model="${escapeHtml(model)}"><span class="pop-dot" style="background:${provider.color}"></span><span><span class="pop-title">${escapeHtml(model)}</span><span class="pop-sub">${escapeHtml(sub)}</span></span><span class="pop-star filled" title="Remove from favourites">★</span></button>`);
    }
  }
  for (const provider of state.providers) {
    const models = provider.models.filter((model) => !query || model.toLowerCase().includes(query) || provider.name.toLowerCase().includes(query));
    if (!models.length) continue;
    chunks.push(`<div class="pop-section">${escapeHtml(provider.name)} (${models.length})</div>`);
    for (const model of models) {
      const active = state.session && state.session.provider === provider.id && state.session.model === model;
      const fav = state.favourites.includes(favouriteKey(provider.id, model));
      const note = provider.modelNotes?.[model];
      const sub = active ? `Current model${note ? ` · ${note}` : ''}` : (note || provider.name);
      chunks.push(`<button class="pop-item${active ? ' active' : ''}" data-provider="${provider.id}" data-model="${escapeHtml(model)}"><span class="pop-dot" style="background:${provider.color}"></span><span><span class="pop-title">${escapeHtml(model)}</span><span class="pop-sub">${escapeHtml(sub)}</span></span><span class="pop-star${fav ? ' filled' : ''}" title="${fav ? 'Remove from favourites' : 'Add to favourites'}">★</span></button>`);
    }
  }
  if (!chunks.length) {
    chunks.push('<div class="pop-section">No matching models</div>');
  }
  list.innerHTML = chunks.join('');
  for (const item of $$('.pop-item', list)) {
    item.querySelector('.pop-star')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      await toggleFavourite(item.dataset.provider, item.dataset.model);
    });
    item.addEventListener('click', async () => {
      await chooseModel(item.dataset.provider, item.dataset.model);
      menu.classList.add('hidden');
    });
  }
  if (options.focus && search && !menu.classList.contains('hidden')) {
    search.focus();
  }
}

async function chooseModel(provider, model) {
  if (!state.session) return;
  await api.invoke('sessions:update', { id: state.session.id, provider, model });
  state.session.provider = provider;
  state.session.model = model;
  renderChips();
  renderModelMenu();
}

function applyTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  const btn = $('#theme-btn');
  if (btn) btn.title = state.theme === 'light' ? 'Switch to dark appearance' : 'Switch to light appearance';
}

function applyViewMode(viewMode) {
  state.viewMode = viewMode === 'verbose' ? 'verbose' : 'normal';
  const btn = $('#view-mode-btn');
  if (btn) btn.textContent = state.viewMode === 'verbose' ? 'Verbose' : 'Normal';
  for (const card of $$('.tool-card')) {
    card.classList.toggle('expanded', state.viewMode === 'verbose');
  }
}

async function applySurface(surface, persist = false, { skipSessionSwitch = false } = {}) {
  const next = surface === 'chat' ? 'chat' : 'code';
  state.surface = next;
  const appEl = $('#app');
  appEl?.setAttribute('data-surface', state.surface);
  if (next === 'chat') appEl?.classList.remove('browser-open');
  const chatBtn = $('#surface-chat');
  const codeBtn = $('#surface-code');
  chatBtn?.classList.toggle('active', state.surface === 'chat');
  codeBtn?.classList.toggle('active', state.surface === 'code');
  chatBtn?.setAttribute('aria-selected', String(state.surface === 'chat'));
  codeBtn?.setAttribute('aria-selected', String(state.surface === 'code'));
  const prompt = $('#prompt');
  if (prompt) {
    prompt.placeholder = state.surface === 'chat'
      ? 'Ask CAELIX anything — MCP, Skills, Hooks & Agents stay active (/ commands)'
      : 'Ask CAELIX to build, fix, or explain something… (/ commands, @ files)';
  }
  if (persist) {
    api.invoke('settings:set', { surface: state.surface }).catch(() => {});
  }
  if (!skipSessionSwitch && state.initialized && state.session && sessionSurface(state.session) !== next) {
    if ((state.session.messages || []).length > 0) {
      const existing = state.sessions.find((item) => sessionSurface(item) === next);
      if (existing) await openSession(existing.id);
      else await newChat();
    } else {
      const nextCwd = next === 'chat'
        ? (state.info?.chatRoot || state.project)
        : (state.codeProject || state.info?.project);
      await api.invoke('sessions:update', { id: state.session.id, surface: next, cwd: nextCwd }).catch(() => {});
      state.session.surface = next;
      state.session.cwd = nextCwd;
      state.project = nextCwd;
      const entry = state.sessions.find((item) => item.id === state.session.id);
      if (entry) {
        entry.surface = next;
        entry.cwd = nextCwd;
      }
      await loadTerminalTabs().catch(() => {});
      if (next === 'code') refreshGitBranch();
      renderAll();
    }
  } else {
    renderSessions();
    if (state.session) {
      renderChips();
      if (!(state.session.messages || []).length) renderEmpty();
    }
  }
  syncBrowserView();
}

function hideMentions() {
  state.mentionQuery = null;
  state.mentionMatches = [];
  $('#mention-menu')?.classList.add('hidden');
}

async function updateMentions() {
  if (state.surface === 'chat') {
    hideMentions();
    return;
  }
  const prompt = $('#prompt');
  const menu = $('#mention-menu');
  if (!prompt || !menu) return;
  const cursor = prompt.selectionStart || 0;
  const before = prompt.value.slice(0, cursor);
  const match = before.match(/(?:^|\s)@([^\s]*)$/);
  if (!match) {
    hideMentions();
    return;
  }
  const query = match[1].toLowerCase();
  if (!state.projectFiles) {
    try {
      state.projectFiles = await api.invoke('files:list', { cwd: state.project });
    } catch {
      state.projectFiles = [];
    }
  }
  const matches = state.projectFiles.filter((file) => file.toLowerCase().includes(query)).slice(0, 12);
  if (!matches.length) {
    hideMentions();
    return;
  }
  state.mentionQuery = match[1];
  state.mentionMatches = matches;
  state.mentionIndex = 0;
  menu.innerHTML = matches.map((file, idx) => `<button type="button" class="mention-item${idx === 0 ? ' active' : ''}" data-mention="${escapeHtml(file)}">${escapeHtml(file)}</button>`).join('');
  menu.classList.remove('hidden');
  for (const item of $$('.mention-item', menu)) {
    item.addEventListener('click', () => selectMention(item.dataset.mention));
  }
}

async function selectMention(file) {
  const prompt = $('#prompt');
  const cursor = prompt.selectionStart || prompt.value.length;
  const before = prompt.value.slice(0, cursor).replace(/@([^\s]*)$/, `@${file} `);
  prompt.value = before + prompt.value.slice(cursor);
  hideMentions();
  resizePrompt();
  prompt.focus();
  if (!state.attachments.some((item) => item.name === file)) {
    try {
      const att = await api.invoke('files:read-attachment', { filePath: file, cwd: state.project });
      if (att) {
        state.attachments.push(att);
        renderAttachments();
      }
    } catch (error) {
      toast(error.message);
    }
  }
}

async function attachPickedFiles() {
  try {
    const items = await api.invoke('files:pick', { cwd: state.project });
    for (const item of items || []) {
      if (!state.attachments.some((existing) => existing.name === item.name)) {
        state.attachments.push(item);
      }
    }
    renderAttachments();
  } catch (error) {
    toast(error.message);
  }
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
  $('#mcp-btn')?.addEventListener('click', openMcp);
  $('#mcp-close')?.addEventListener('click', closeMcp);
  $('#mcp-screen')?.addEventListener('click', (event) => { if (event.target.id === 'mcp-screen') closeMcp(); });
  $('#mcp-refresh')?.addEventListener('click', openMcp);
  $('#mcp-add')?.addEventListener('click', async () => {
    const name = $('#mcp-name').value.trim();
    const raw = $('#mcp-command').value.trim();
    const scope = $('#mcp-scope').value;
    if (!name || !raw) { toast('Enter a server name and command or URL.'); return; }
    try {
      let payload;
      if (/^https?:\/\//i.test(raw)) {
        payload = { name, scope, cwd: state.project, url: raw };
      } else {
        const parts = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((s) => s.replace(/^["']|["']$/g, '')) || [raw];
        payload = { name, scope, cwd: state.project, command: parts[0], args: parts.slice(1) };
      }
      const updated = await api.invoke('mcp:save', payload);
      $('#mcp-name').value = '';
      $('#mcp-command').value = '';
      renderMcpRows(updated);
      toast(`Added MCP server "${name}".`);
    } catch (error) {
      toast(error.message);
    }
  });

  $('#hooks-btn')?.addEventListener('click', openHooks);
  $('#hooks-close')?.addEventListener('click', closeHooks);
  $('#hooks-screen')?.addEventListener('click', (event) => { if (event.target.id === 'hooks-screen') closeHooks(); });
  $('#hook-add')?.addEventListener('click', async () => {
    const event = $('#hook-event').value;
    const matcher = $('#hook-matcher').value.trim() || '*';
    const scope = $('#hook-scope').value;
    const command = $('#hook-command').value.trim();
    if (!command) { toast('Enter a shell command for the hook.'); return; }
    try {
      const updated = await api.invoke('hooks:save', { event, matcher, scope, command, cwd: state.project });
      $('#hook-command').value = '';
      renderHookRows(updated);
      toast(`Added ${event} hook.`);
    } catch (error) {
      toast(error.message);
    }
  });

  $('#helper-btn')?.addEventListener('click', openHelper);
  $('#helper-close')?.addEventListener('click', closeHelper);
  $('#helper-screen')?.addEventListener('click', (event) => { if (event.target.id === 'helper-screen') closeHelper(); });
  for (const preset of $$('.helper-preset')) {
    preset.addEventListener('click', async () => {
      const task = preset.dataset.helperTask;
      const agent = preset.dataset.helperAgent || state.selectedAgent || 'explore';
      closeHelper();
      await api.invoke('chat:helper', { sessionId: state.session.id, task, agent });
    });
  }
  $('#helper-run')?.addEventListener('click', async () => {
    const task = $('#helper-task').value.trim();
    if (!task) { toast('Enter a task for the selected agent.'); return; }
    const agent = state.selectedAgent || 'explore';
    closeHelper();
    $('#helper-task').value = '';
    await api.invoke('chat:helper', { sessionId: state.session.id, task, agent });
  });
  $('#agent-new-toggle')?.addEventListener('click', () => {
    $('#agent-custom-form')?.classList.toggle('hidden');
  });
  $('#agent-save')?.addEventListener('click', async () => {
    const name = $('#agent-name')?.value.trim();
    const description = $('#agent-desc')?.value.trim();
    const prompt = $('#agent-prompt')?.value.trim();
    const scope = $('#agent-scope')?.value || 'project';
    if (!name || !prompt) { toast('Enter an agent name and instructions.'); return; }
    try {
      const list = await api.invoke('agents:save', { name, description, prompt, scope, cwd: state.project });
      state.agents = list;
      state.selectedAgent = list.find((a) => a.name === name)?.id || state.selectedAgent;
      $('#agent-name').value = '';
      $('#agent-desc').value = '';
      $('#agent-prompt').value = '';
      $('#agent-custom-form')?.classList.add('hidden');
      renderAgentsList(list);
      toast(`Saved agent "${name}".`);
    } catch (error) {
      toast(error.message);
    }
  });
  for (const btn of $$('#mcp-presets .preset-chip[data-mcp-preset]')) {
    btn.addEventListener('click', () => {
      const p = btn.dataset.mcpPreset;
      const map = {
        filesystem: { name: 'filesystem', cmd: `npx -y @modelcontextprotocol/server-filesystem ${state.project || '.'}` },
        fetch: { name: 'fetch', cmd: 'uvx mcp-server-fetch' },
        git: { name: 'git', cmd: `uvx mcp-server-git --repository ${state.project || '.'}` },
      };
      if (map[p]) {
        $('#mcp-name').value = map[p].name;
        $('#mcp-command').value = map[p].cmd;
        $('#mcp-command').focus();
      }
    });
  }
  $('#mcp-import-claude')?.addEventListener('click', async () => {
    try {
      const res = await api.invoke('mcp:import-claude', { cwd: state.project });
      renderMcpRows(res.servers || []);
      toast(res.imported ? `Imported ${res.imported} MCP server(s) from Claude.` : 'No new Claude MCP servers found to import.');
    } catch (error) {
      toast(error.message);
    }
  });
  for (const btn of $$('#hooks-presets .preset-chip[data-hook-preset]')) {
    btn.addEventListener('click', () => {
      const p = btn.dataset.hookPreset;
      const map = {
        notify: { event: 'Stop', matcher: '*', cmd: 'osascript -e \'display notification "Turn finished" with title "CAELIX"\'' },
        'git-block': { event: 'PreToolUse', matcher: '^bash$', cmd: '/usr/bin/python3 -c \'import json,re,sys; d=json.load(sys.stdin); c=(d.get("input") or {}).get("command",""); re.search(r"git\\s+push\\s+.*--force",c) and (sys.stderr.write("Blocked force push\\n"), sys.exit(2))\'' },
        audit: { event: 'PostToolUse', matcher: '*', cmd: '/usr/bin/python3 -c \'import json,sys; d=json.load(sys.stdin); print("Logged", d.get("tool"))\'' },
      };
      if (map[p]) {
        $('#hook-event').value = map[p].event;
        $('#hook-matcher').value = map[p].matcher;
        $('#hook-command').value = map[p].cmd;
        $('#hook-command').focus();
      }
    });
  }

  $('#slash-btn')?.addEventListener('click', () => {
    const prompt = $('#prompt');
    prompt.value = '/';
    prompt.focus();
    resizePrompt();
    updateCommands();
  });

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
    if (!menu.classList.contains('hidden')) renderModelMenu('', { focus: true });
  });
  $('#composer-model').addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = $('#model-menu');
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) renderModelMenu('', { focus: true });
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
  $('#prompt').addEventListener('input', () => {
    resizePrompt();
    updateCommands();
    updateMentions().catch(() => {});
  });
  $('#prompt').addEventListener('keydown', (event) => {
    const cmdOpen = !$('#command-menu')?.classList.contains('hidden') && state.commandMatches.length > 0;
    if (cmdOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.commandIndex = (state.commandIndex + 1) % state.commandMatches.length;
        $$('.cmd-item').forEach((el, idx) => el.classList.toggle('active', idx === state.commandIndex));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.commandIndex = (state.commandIndex - 1 + state.commandMatches.length) % state.commandMatches.length;
        $$('.cmd-item').forEach((el, idx) => el.classList.toggle('active', idx === state.commandIndex));
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        selectCommand(state.commandMatches[state.commandIndex].name);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideCommands();
        return;
      }
    }
    const menuOpen = !$('#mention-menu').classList.contains('hidden') && state.mentionMatches.length > 0;
    if (menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.mentionIndex = (state.mentionIndex + 1) % state.mentionMatches.length;
        $$('.mention-item').forEach((el, idx) => el.classList.toggle('active', idx === state.mentionIndex));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.mentionIndex = (state.mentionIndex - 1 + state.mentionMatches.length) % state.mentionMatches.length;
        $$('.mention-item').forEach((el, idx) => el.classList.toggle('active', idx === state.mentionIndex));
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        selectMention(state.mentionMatches[state.mentionIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideMentions();
        return;
      }
    }
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
  $('#surface-chat')?.addEventListener('click', () => applySurface('chat', true));
  $('#surface-code')?.addEventListener('click', () => applySurface('code', true));

  $('#panel-toggle').addEventListener('click', () => {
    $('#app').classList.toggle('panel-collapsed');
    syncBrowserView();
  });
  $('#panel-close').addEventListener('click', () => {
    const appEl = $('#app');
    appEl.classList.add('panel-collapsed');
    appEl.classList.remove('browser-open');
    syncBrowserView();
  });
  $('#browser-btn')?.addEventListener('click', () => {
    const appEl = $('#app');
    const alreadyShowingBrowser = !appEl.classList.contains('panel-collapsed')
      && state.activePanelTab === 'browser'
      && (state.surface === 'code' || appEl.classList.contains('browser-open'));
    if (alreadyShowingBrowser) {
      if (state.surface === 'chat') appEl.classList.remove('browser-open');
      appEl.classList.add('panel-collapsed');
      syncBrowserView();
    } else {
      openBrowserPanel({ focusInput: true });
    }
  });
  for (const tab of $$('.panel-tab')) {
    tab.addEventListener('click', () => activatePanelTab(tab.dataset.tab));
  }
  $('#browser-back')?.addEventListener('click', () => { api.invoke('browser:back').catch(() => {}); });
  $('#browser-forward')?.addEventListener('click', () => { api.invoke('browser:forward').catch(() => {}); });
  $('#browser-reload')?.addEventListener('click', () => { api.invoke('browser:reload').catch(() => {}); });
  $('#browser-go')?.addEventListener('click', () => { navigateBrowser(); });
  $('#browser-url')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      navigateBrowser();
    }
  });
  $('#browser-ext')?.addEventListener('click', () => {
    const url = state.browserState?.url || $('#browser-url')?.value?.trim();
    if (url) api.invoke('shell:open-external', url).catch(() => {});
  });
  if (typeof window.ResizeObserver === 'function' && $('#browser-viewport')) {
    new window.ResizeObserver(() => syncBrowserView()).observe($('#browser-viewport'));
  }
  window.addEventListener('resize', syncBrowserView);

  $('#terminal-run').addEventListener('click', runTerminal);
  $('#terminal-stop').addEventListener('click', () => {
    const tab = activeTerminal();
    if (!tab || !state.session) return;
    api.invoke('terminal:interrupt', { sessionId: state.session.id, tabId: tab.id })
      .then(() => appendTerminal('^C\n'))
      .catch((error) => appendTerminal(`${error.message}\n`, 'err-line'));
  });
  $('#terminal-new').addEventListener('click', () => { newTerminalTab().catch((error) => toast(error.message)); });
  $('#terminal-cmd').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runTerminal();
  });
  $('#sidebar-toggle').addEventListener('click', () => $('#app').classList.toggle('sidebar-collapsed'));
  $('#attach-btn').addEventListener('click', attachPickedFiles);
  $('#key-warning-open').addEventListener('click', openKeys);
  $('#prompt-inspector-btn').addEventListener('click', () => { togglePromptInspector().catch((error) => toast(error.message)); });
  $('#theme-btn').addEventListener('click', async () => {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    await api.invoke('settings:set', { theme: next }).catch(() => {});
  });
  $('#view-mode-btn').addEventListener('click', async () => {
    const next = state.viewMode === 'normal' ? 'verbose' : 'normal';
    applyViewMode(next);
    await api.invoke('settings:set', { viewMode: next }).catch(() => {});
  });

  const composer = $('#composer');
  composer.addEventListener('dragover', (event) => {
    event.preventDefault();
    composer.classList.add('drag-over');
  });
  composer.addEventListener('dragleave', () => composer.classList.remove('drag-over'));
  composer.addEventListener('drop', async (event) => {
    event.preventDefault();
    composer.classList.remove('drag-over');
    const files = [...(event.dataTransfer?.files || [])];
    for (const file of files.slice(0, 5)) {
      if (!file.path) continue;
      try {
        const att = await api.invoke('files:read-attachment', { filePath: file.path, cwd: state.project });
        if (att && !state.attachments.some((existing) => existing.name === att.name)) {
          state.attachments.push(att);
        }
      } catch (error) {
        toast(error.message);
      }
    }
    renderAttachments();
  });

  document.addEventListener('keydown', (event) => {
    if (event.metaKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      newChat();
    } else if (event.metaKey && event.key === '\\') {
      event.preventDefault();
      $('#app').classList.toggle('panel-collapsed');
    } else if (event.metaKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      $('#app').classList.toggle('sidebar-collapsed');
    } else if (event.metaKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      $('#search').focus();
    } else if (event.ctrlKey && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      $('#view-mode-btn').click();
    } else if (event.ctrlKey && event.key === '`') {
      event.preventDefault();
      $('#app').classList.remove('panel-collapsed');
      document.querySelector('.panel-tab[data-tab="terminal"]')?.click();
      $('#terminal-cmd')?.focus();
    } else if (event.key === 'Escape') {
      if (state.keysOpen) closeKeys();
      else if (state.memoryOpen) closeMemory();
      else if (state.mcpOpen) closeMcp();
      else if (state.hooksOpen) closeHooks();
      else if (state.helperOpen) closeHelper();
      else if (state.streaming && state.session) api.invoke('chat:stop', state.session.id).catch(() => {});
    }
  });

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
  state.terminalRunning = (state.terminalRunning || 0) + 1;
  try {
    const result = await api.invoke('terminal:run', { sessionId: state.session.id, command, tabId: tab.id });
    if (result && result.exitCode) appendTerminal(`exit ${result.exitCode}\n`, 'err-line');
  } catch (error) {
    appendTerminal(`${error.message}\n`, 'err-line');
  } finally {
    state.terminalRunning = Math.max(0, (state.terminalRunning || 1) - 1);
  }
}

async function selectProjectFolder(folder) {
  if (!folder) return;
  if (state.surface === 'chat') {
    await applySurface('code', true);
  }
  state.project = folder;
  if (folder !== state.info?.chatRoot) state.codeProject = folder;
  state.projectFiles = null;
  if (state.session) {
    await api.invoke('sessions:update', { id: state.session.id, cwd: folder });
    state.session.cwd = folder;
  }
  refreshGitBranch();
  refreshMemory().catch(() => {});
  renderChips();
  if (state.session && !(state.session.messages || []).length) {
    renderEmpty();
  }
  $('#prompt')?.focus();
  toast(`Workspace folder: ${folderBaseName(folder)}`);
}

async function pickProject() {
  const folder = await api.invoke('project:pick');
  if (!folder) return;
  await selectProjectFolder(folder);
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
  const [info, providers, keys, sessions, savedSettings] = await Promise.all([
    api.invoke('app:info'),
    api.invoke('providers:list'),
    api.invoke('keys:status'),
    api.invoke('sessions:list'),
    api.invoke('settings:get').catch(() => ({ theme: 'dark', viewMode: 'normal', surface: 'code', favouriteModels: [] })),
  ]);
  applyTheme(savedSettings?.theme);
  applyViewMode(savedSettings?.viewMode);
  applySurface(savedSettings?.surface);
  state.favourites = Array.isArray(savedSettings?.favouriteModels) ? savedSettings.favouriteModels : [];
  state.info = info;
  state.providers = providers;
  state.keys = keys;
  state.sessions = sessions.sessions;
  state.activeId = sessions.activeId;
  state.codeProject = (info.project && info.project !== info.chatRoot) ? info.project : '';
  state.project = state.surface === 'chat' ? (info.chatRoot || info.project) : (state.codeProject || info.project);

  const matchingSession = (state.activeId && state.sessions.find((s) => s.id === state.activeId && sessionSurface(s) === state.surface))
    || state.sessions.find((s) => sessionSurface(s) === state.surface);

  if (matchingSession) {
    const session = await api.invoke('sessions:get', matchingSession.id);
    if (session) {
      state.session = session;
      state.activeId = session.id;
      if (sessionSurface(session) === 'code' && session.cwd && session.cwd !== info.chatRoot) {
        state.project = session.cwd;
        state.codeProject = session.cwd;
      } else {
        state.project = info.chatRoot || session.cwd;
      }
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
    state.session = await api.invoke('sessions:create', {
      cwd: state.surface === 'chat' ? null : (state.codeProject || state.project),
      surface: state.surface,
    });
    state.activeId = state.session.id;
    state.project = state.session.cwd;
    await refreshSessions();
  }

  bind();
  try { await refreshMemory(); } catch { state.memory = null; }
  await loadTerminalTabs();
  refreshGitBranch();
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
