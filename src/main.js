'use strict';

const {
  app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, shell, safeStorage, Notification,
} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { KeyStore, SessionStore, SettingsStore } = require('./store');
const { Engine } = require('./engine');
const { McpManager } = require('./engine/mcp');
const { HooksManager } = require('./engine/hooks');
const { AgentRegistry } = require('./engine/agents');
const { providerList, testKey, fetchProviderModels, PROVIDERS } = require('./engine/providers');
const omnirouteHelper = require('./omniroute');
const updater = require('./updater');
const { BrowserPanel } = require('./browser');

const PROCESS_STARTED = Date.now();
const APP_NAME = 'CAELIX';
const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'assets', 'icon-1024.png');
const SELF_CHECK = process.env.CAELIX_SELFCHECK === '1';

// Startup trace for the self-check: the packaged bundle occasionally stalls
// before its first paint with no log output anywhere (macOS routes packaged
// console output to the unified log, which stays empty), so append a marker
// line per startup milestone to a file instead.
function trace(message) {
  if (!SELF_CHECK) return;
  try {
    fs.mkdirSync(CHECKS_DIR, { recursive: true });
    fs.appendFileSync(path.join(CHECKS_DIR, 'selfcheck-trace.txt'), `${new Date().toISOString()} ${message}\n`);
  } catch { /* diagnostics only */ }
}
// A packaged app must never write inside its own bundle. Adding files under
// Contents/Resources breaks the code-signature seal, and macOS then rejects
// the whole app as "damaged" — which is not corruption, just a broken seal.
// Packaged self-checks therefore report to the isolated user-data folder.
const CHECKS_DIR = process.env.CAELIX_CHECKS_DIR
  ? path.resolve(process.env.CAELIX_CHECKS_DIR)
  : SELF_CHECK && app.isPackaged
    ? path.join(app.getPath('appData'), 'CAELIX-Selfcheck', 'checks')
    : path.join(ROOT, 'checks');

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('app.caelix.desktop');

if (SELF_CHECK) {
  const isolated = path.join(app.getPath('appData'), 'CAELIX-Selfcheck');
  app.setPath('userData', isolated);
  fs.mkdirSync(isolated, { recursive: true });
  for (const file of ['sessions.json', 'keys.enc', 'mcp.json', 'hooks.json', 'settings.json']) {
    try { fs.rmSync(path.join(isolated, file), { force: true }); } catch { /* fresh run */ }
  }
  for (const dir of ['checkpoints', 'agents']) {
    try { fs.rmSync(path.join(isolated, dir), { recursive: true, force: true }); } catch { /* fresh run */ }
  }
}

let win = null;
let browserPanel = null;
let keys = null;
let sessions = null;
let settings = null;
let mcp = null;
let hooks = null;
let agents = null;
let engine = null;
let windowReadyMs = null;
let firstPaintMs = null;
let lastError = null;
const pendingPermissions = new Map();
const pendingQuestions = new Map();

function emit(event) {
  if (win && !win.isDestroyed()) win.webContents.send('chat:event', event);
  if (event?.type === 'done' && !SELF_CHECK && win && !win.isDestroyed() && !win.isFocused()
    && (event.elapsedMs || 0) >= 5000 && Notification.isSupported()) {
    try {
      new Notification({ title: APP_NAME, body: event.error ? `Turn failed: ${event.error}` : 'Reply finished.' }).show();
    } catch { /* best effort */ }
  }
}

const IMAGE_EXT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function readAttachmentFile(filePath, baseDir) {
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(baseDir || projectPath(), filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('Only files can be attached.');
  const ext = path.extname(resolved).toLowerCase();
  const name = baseDir && resolved.startsWith(`${path.resolve(baseDir)}${path.sep}`)
    ? path.relative(path.resolve(baseDir), resolved)
    : path.basename(resolved);
  if (IMAGE_EXT_MIME[ext]) {
    if (stat.size > 1_500_000) throw new Error('Image attachment exceeds 1.5 MB.');
    const buf = fs.readFileSync(resolved);
    return {
      name,
      kind: 'image',
      mimeType: IMAGE_EXT_MIME[ext],
      bytes: stat.size,
      dataUrl: `data:${IMAGE_EXT_MIME[ext]};base64,${buf.toString('base64')}`,
    };
  }
  if (stat.size > 256_000) throw new Error('Text attachment exceeds 256 KB.');
  const buf = fs.readFileSync(resolved);
  if (buf.includes(0)) throw new Error('Binary files cannot be attached as text.');
  return {
    name,
    kind: 'text',
    bytes: stat.size,
    text: buf.toString('utf8').slice(0, 32_000),
  };
}

function listProjectFiles(rootDir, limit = 300) {
  const root = path.resolve(rootDir);
  const out = [];
  const skip = new Set(['.git', 'node_modules', 'dist', '.next', '.venv']);
  const walkDir = (dir) => {
    if (out.length >= limit) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.isFile()) out.push(path.relative(root, full));
    }
  };
  walkDir(root);
  return out;
}

function userData() {
  return app.getPath('userData');
}

function requestPermission(request) {
  return new Promise((resolve) => {
    const id = `perm_${crypto.randomUUID()}`;
    const timeoutMs = SELF_CHECK ? 120000 : 1800000;
    const timer = setTimeout(() => {
      if (pendingPermissions.has(id)) {
        pendingPermissions.delete(id);
        emit({ type: 'permission-resolved', sessionId: request.sessionId, id, decision: 'deny', reason: 'timeout' });
        resolve('deny');
      }
    }, timeoutMs);
    pendingPermissions.set(id, { sessionId: request.sessionId, resolve, timer });
    emit({ type: 'permission-request', id, ...request });
  });
}

function answerPermission(id, decision) {
  const pending = pendingPermissions.get(id);
  if (!pending) return false;
  pendingPermissions.delete(id);
  clearTimeout(pending.timer);
  const resolved = decision === 'abort' ? 'abort' : decision === 'deny' ? 'deny' : decision === 'session' ? 'session' : 'allow';
  pending.resolve(resolved);
  return true;
}

function cancelSessionPrompts(sessionId) {
  for (const [id, pending] of pendingPermissions.entries()) {
    if (!sessionId || pending.sessionId === sessionId) {
      pendingPermissions.delete(id);
      clearTimeout(pending.timer);
      emit({ type: 'permission-resolved', sessionId: pending.sessionId, id, decision: 'abort', reason: 'stopped' });
      pending.resolve('abort');
    }
  }
  for (const [id, pending] of pendingQuestions.entries()) {
    if (!sessionId || pending.sessionId === sessionId) {
      pendingQuestions.delete(id);
      clearTimeout(pending.timer);
      pending.resolve('Cancelled.');
    }
  }
}

function requestQuestion(request) {
  return new Promise((resolve) => {
    const id = `question_${crypto.randomUUID()}`;
    const timeoutMs = SELF_CHECK ? 120000 : 1800000;
    const timer = setTimeout(() => {
      if (pendingQuestions.has(id)) {
        pendingQuestions.delete(id);
        resolve('No answer (timed out).');
      }
    }, timeoutMs);
    pendingQuestions.set(id, { sessionId: request.sessionId, resolve, timer });
    emit({ type: 'question-request', id, ...request });
  });
}

function answerQuestion(id, answer) {
  const pending = pendingQuestions.get(id);
  if (!pending) return false;
  pendingQuestions.delete(id);
  clearTimeout(pending.timer);
  const clean = String(answer ?? '').trim().slice(0, 4000);
  pending.resolve(clean || 'No answer.');
  return true;
}

function titleBarOverlayFor(theme) {
  return theme === 'light'
    ? { color: '#f6f7f9', symbolColor: '#1b2027', height: 48 }
    : { color: '#0b0d10', symbolColor: '#d7dde6', height: 48 };
}

function createWindow() {
  trace('createWindow: building BrowserWindow');
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0b0d10',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 17 } }
      : process.platform === 'win32'
        // One title bar: the native minimise/maximise/close buttons are drawn
        // over CAELIX's own top bar instead of adding a second one above it.
        ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: titleBarOverlayFor(settings?.get?.('theme', 'dark')),
        }
        : {}),
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  win.webContents.once('did-start-loading', () => trace('webContents: did-start-loading'));
  win.webContents.once('dom-ready', () => trace('webContents: dom-ready'));
  win.webContents.once('did-finish-load', () => trace('webContents: did-finish-load'));
  const tLoadStart = Date.now();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
    .then(() => trace(`createWindow: loadFile resolved (${Date.now() - tLoadStart}ms)`))
    .catch((error) => trace(`createWindow: loadFile failed: ${error.message}`));
  const tBrowserStart = Date.now();
  browserPanel = new BrowserPanel(win, (event) => emit(event));
  trace(`createWindow: BrowserPanel created (${Date.now() - tBrowserStart}ms)`);
  win.once('ready-to-show', () => {
    trace('createWindow: ready-to-show fired');
    windowReadyMs = Date.now() - PROCESS_STARTED;
    win.show();
    if (SELF_CHECK) {
      const { run } = require('./selfcheck');
      run({
        app,
        win,
        sessions,
        keys,
        settings,
        engine,
        startedAt: PROCESS_STARTED,
        getWindowReadyMs: () => windowReadyMs,
        getFirstPaintMs: () => firstPaintMs,
        getLastError: () => lastError,
        checksDir: CHECKS_DIR,
        workspace: path.join(CHECKS_DIR, 'selfcheck-workspace'),
      }).catch((error) => {
        try {
          fs.mkdirSync(CHECKS_DIR, { recursive: true });
          fs.writeFileSync(path.join(CHECKS_DIR, 'selfcheck-crash.txt'), String(error.stack || error));
        } catch { /* best effort */ }
        app.exit(1);
      });
    }
  });

  win.webContents.on('console-message', (event, level, message, line, source) => {
    const modern = typeof event === 'object' && typeof event.level === 'string';
    const name = modern ? event.level : ({ 0: 'debug', 1: 'info', 2: 'warning', 3: 'error' }[level] || 'info');
    if (name === 'error') {
      const text = modern ? event.message : message;
      lastError = {
        level: name,
        message: text,
        line: modern ? event.lineNumber : line,
        source: modern ? event.sourceId : source,
        at: new Date().toISOString(),
      };
      emit({ type: 'renderer-error', message: text, line, source });
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    lastError = { message: `Renderer gone: ${details.reason}`, at: new Date().toISOString() };
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  if (process.platform === 'win32') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [{ role: 'quit', label: 'Exit' }] },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
          { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
          { type: 'separator' }, { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Help',
        submenu: [{
          label: `About ${APP_NAME}`,
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: `About ${APP_NAME}`,
            message: `${APP_NAME} ${app.getVersion()}`,
            detail: 'A free, local AI coding agent. Electron + plain HTML/CSS/JS.',
          }),
        }],
      },
    ]));
    return;
  }
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `About ${APP_NAME}` },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${APP_NAME}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${APP_NAME}` },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        { type: 'separator' }, { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function projectPath() {
  return settings.get('lastCwd', os.homedir());
}

function sessionSummary(session) {
  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    surface: session.surface || null,
    provider: session.provider,
    model: session.model,
    mode: session.mode,
    messageCount: Array.isArray(session.messages) ? session.messages.filter((m) => !m.hidden).length : 0,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
  };
}

// Chats live in their own folder, never inside a code project.
function chatRoot() {
  const dir = path.join(os.homedir(), 'Documents', 'CAELIX Chats');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }
  return dir;
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    selfcheck: SELF_CHECK,
    userData: userData(),
    project: projectPath(),
    chatRoot: chatRoot(),
    windowReadyMs,
    firstPaintMs,
    encryption: SELF_CHECK ? true : safeStorage.isEncryptionAvailable(),
  }));

  ipcMain.handle('update:check', async () => {
    try {
      return await updater.check({ currentVersion: app.getVersion() });
    } catch (error) {
      // An offline machine or GitHub hiccup must never interrupt the app.
      return { available: false, current: app.getVersion(), error: error.message };
    }
  });

  ipcMain.handle('update:install', async (event) => {
    const result = await updater.install({
      app,
      currentVersion: app.getVersion(),
      fetchImpl: global.fetch,
      openPath: (target) => shell.openPath(target),
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('update:progress', progress);
      },
    });
    if (result?.started) setTimeout(() => app.exit(0), 600);
    return result;
  });

  ipcMain.handle('providers:list', () => {
    const version = app.getVersion();
    if (settings.get('providerCatalogVersion') !== version) {
      settings.set('providerModels', {});
      settings.set('providerCatalogVersion', version);
    }
    const cached = settings.get('providerModels', {});
    return providerList(SELF_CHECK).map((p) => ({
      ...p,
      models: Array.isArray(cached[p.id]) && cached[p.id].length ? [...new Set([...p.models, ...cached[p.id]])] : p.models,
    }));
  });

  ipcMain.handle('providers:refresh', async (_event, { provider } = {}) => {
    const models = await fetchProviderModels(provider, keys.get(provider));
    const cached = settings.get('providerModels', {});
    cached[provider] = models;
    settings.set('providerModels', cached);
    return { provider, models };
  });

  ipcMain.handle('settings:get', () => ({
    theme: settings.get('theme', 'dark'),
    viewMode: settings.get('viewMode', 'normal'),
    surface: settings.get('surface', 'code'),
    favouriteModels: settings.get('favouriteModels', []),
  }));

  ipcMain.handle('settings:set', (_event, patch = {}) => {
    if (patch.theme === 'dark' || patch.theme === 'light') {
      settings.set('theme', patch.theme);
      // Keep the native Windows window buttons readable in both themes.
      if (process.platform === 'win32' && win && !win.isDestroyed()) {
        try { win.setTitleBarOverlay(titleBarOverlayFor(patch.theme)); } catch { /* older Electron */ }
      }
    }
    if (patch.viewMode === 'normal' || patch.viewMode === 'verbose') settings.set('viewMode', patch.viewMode);
    if (patch.surface === 'chat' || patch.surface === 'code') settings.set('surface', patch.surface);
    if (Array.isArray(patch.favouriteModels)) {
      const clean = [...new Set(patch.favouriteModels
        .filter((item) => typeof item === 'string' && item.trim().length > 0 && item.length < 300)
        .map((item) => item.trim()))].slice(0, 24);
      settings.set('favouriteModels', clean);
    }
    return {
      theme: settings.get('theme', 'dark'),
      viewMode: settings.get('viewMode', 'normal'),
      surface: settings.get('surface', 'code'),
      favouriteModels: settings.get('favouriteModels', []),
    };
  });

  ipcMain.handle('git:branch', (_event, { cwd } = {}) => new Promise((resolve) => {
    const dir = path.resolve(cwd || projectPath());
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, timeout: 1500 }, (err, stdout) => {
      resolve({ branch: err ? null : String(stdout || '').trim() || null });
    });
  }));

  ipcMain.handle('system:prompt', (_event, { sessionId } = {}) => {
    const session = sessions.get(sessionId);
    if (!session) return null;
    const prompt = engine.systemPrompt(session);
    return {
      prompt,
      chars: prompt.length,
      tokens: Math.max(1, Math.round(prompt.length / 4)),
    };
  });

  ipcMain.handle('files:list', (_event, { cwd } = {}) => listProjectFiles(cwd || projectPath()));

  ipcMain.handle('files:pick', async (_event, { cwd } = {}) => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Attach files',
      defaultPath: cwd || projectPath(),
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return [];
    const items = [];
    for (const filePath of result.filePaths.slice(0, 5)) {
      items.push(readAttachmentFile(filePath, cwd || projectPath()));
    }
    return items;
  });

  ipcMain.handle('files:read-attachment', (_event, { filePath, cwd } = {}) => {
    const base = path.resolve(cwd || projectPath());
    const target = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(base, filePath);
    if (!path.isAbsolute(filePath) && target !== base && !target.startsWith(`${base}${path.sep}`)) {
      throw new Error('Attached project file must stay inside the project.');
    }
    return readAttachmentFile(target, base);
  });

  ipcMain.handle('keys:status', () => {
    const mask = new Map(keys.status().map((row) => [row.provider, row]));
    return providerList(SELF_CHECK).map((provider) => ({
      ...provider,
      configured: mask.has(provider.id),
      count: mask.get(provider.id)?.count || 0,
      masks: mask.get(provider.id)?.masks || [],
      masked: mask.get(provider.id)?.masked || null,
    }));
  });

  ipcMain.handle('keys:save', (_event, { provider, key, append = false }) => {
    if (!PROVIDERS[provider] || PROVIDERS[provider].keyless) throw new Error('That provider does not use a key.');
    const count = append ? keys.add(provider, key) : keys.set(provider, key);
    return { provider, count, masks: keys.masks(provider), masked: keys.masked(provider) };
  });

  ipcMain.handle('keys:add', (_event, { provider, key }) => {
    if (!PROVIDERS[provider] || PROVIDERS[provider].keyless) throw new Error('That provider does not use a key.');
    const count = keys.add(provider, key);
    return { provider, count, masks: keys.masks(provider), masked: keys.masked(provider) };
  });

  ipcMain.handle('keys:remove-one', (_event, { provider, index }) => {
    keys.removeAt(provider, Number(index));
    return { provider, count: keys.list(provider).length, masks: keys.masks(provider), masked: keys.masked(provider) };
  });

  ipcMain.handle('keys:delete', (_event, { provider }) => {
    keys.delete(provider);
    return { provider, count: 0, masks: [], masked: null };
  });

  ipcMain.handle('keys:test', async (_event, { provider, key, model }) => {
    const pool = key ? [String(key).trim()] : keys.list(provider);
    if (!pool.length) throw new Error('Paste a key first.');
    // OmniRoute needs its helper alive before a gateway key means anything;
    // this is the one place CAELIX launches it outside of a chat send.
    if (provider === 'omniroute') await omnirouteHelper.ensure(app.getPath('userData'));
    let passed = 0;
    let lastErr = null;
    let testedModel = null;
    let fallbackFrom = null;
    for (const candidate of pool) {
      try {
        const res = await testKey(provider, candidate, model);
        testedModel = res?.model || testedModel;
        fallbackFrom = res?.fallbackFrom || fallbackFrom;
        passed += 1;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!passed) throw lastErr || new Error('Key test failed.');
    if (pool.length > 1) {
      return { ok: true, message: passed === pool.length ? `All ${pool.length} keys accepted (${testedModel || 'verified'}).` : `${passed}/${pool.length} keys accepted (${lastErr?.message || 'one failed'}).` };
    }
    if (fallbackFrom && testedModel) {
      return { ok: true, message: `Key accepted (via ${testedModel}; ${fallbackFrom} is unavailable on this account).` };
    }
    return { ok: true, message: testedModel ? `Key accepted (${testedModel}).` : 'Key accepted.' };
  });

  ipcMain.handle('sessions:list', () => sessions.list());

  ipcMain.handle('sessions:get', (_event, id) => sessions.get(id));

  ipcMain.handle('sessions:create', (_event, input = {}) => {
    const surface = input.surface === 'chat' || input.surface === 'code'
      ? input.surface
      : settings.get('surface', 'code');
    const codeDir = input.cwd && input.cwd !== chatRoot() ? input.cwd : projectPath();
    const session = sessions.create({
      // Chat-surface chats never inherit a code project folder; they live in
      // their own space so the two never dilute each other.
      cwd: surface === 'chat' ? chatRoot() : codeDir,
      surface,
      provider: input.provider || (SELF_CHECK ? 'simulator' : 'gemini'),
      model: input.model || (SELF_CHECK ? 'sim-1' : 'gemini-3-flash-preview'),
      mode: input.mode || 'ask',
    });
    emit({ type: 'session-created', session: sessionSummary(session) });
    return session;
  });

  ipcMain.handle('sessions:set-active', (_event, id) => {
    const session = sessions.setActive(id);
    return session;
  });

  ipcMain.handle('sessions:rename', (_event, { id, title }) => {
    const session = sessions.rename(id, title);
    if (session) emit({ type: 'session-updated', session: sessionSummary(session) });
    return session ? sessionSummary(session) : null;
  });

  ipcMain.handle('sessions:delete', (_event, id) => {
    const result = sessions.remove(id);
    emit({ type: 'sessions-changed', ...result });
    return result;
  });

  ipcMain.handle('sessions:update', (_event, { id, ...patch }) => {
    const existing = sessions.get(id);
    const allowed = {};
    for (const key of ['provider', 'model', 'mode', 'cwd', 'title', 'review', 'teamDraftProvider', 'teamDraftModel', 'teamReviewProvider', 'teamReviewModel']) {
      if (patch[key] !== undefined) allowed[key] = patch[key];
    }
    if (patch.surface === 'chat' || patch.surface === 'code') {
      allowed.surface = patch.surface;
      if (patch.surface === 'chat') allowed.cwd = chatRoot();
    } else if (existing?.surface === 'chat') {
      delete allowed.cwd;
    }
    const session = sessions.update(id, allowed);
    if (session) emit({ type: 'session-updated', session: sessionSummary(session) });
    return session ? sessionSummary(session) : null;
  });

  ipcMain.handle('project:pick', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a project folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: projectPath(),
    });
    if (result.canceled || !result.filePaths[0]) return null;
    settings.set('lastCwd', result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle('project:set', (_event, folder) => {
    if (!folder || !fs.existsSync(folder)) throw new Error('That folder does not exist.');
    settings.set('lastCwd', folder);
    return folder;
  });

  ipcMain.handle('chat:set-review', (_event, payload = {}) => {
    const { sessionId, value, ...rest } = payload;
    if (value !== undefined && typeof value === 'object' && value !== null) {
      return engine.setReview(sessionId, value);
    }
    return engine.setReview(sessionId, Object.keys(rest).length ? { review: value, ...rest } : value);
  });

  ipcMain.handle('chat:send', async (_event, { sessionId, text, attachments } = {}) => {    const session = sessions.get(sessionId);
    if (!session) throw new Error('No such chat.');
    const dispatch = () => engine.send(sessionId, text, attachments).catch((error) => {
      emit({ type: 'error', message: error.message });
    });
    // The OmniRoute helper is launched on first use so no terminal is needed.
    if (session.provider === 'omniroute') {
      omnirouteHelper.ensure(app.getPath('userData'))
        .then(dispatch)
        .catch((error) => emit({ type: 'error', message: error.message }));
    } else {
      dispatch();
    }
    return { started: true };
  });
  ipcMain.handle('chat:stop', (_event, sessionId) => {
    cancelSessionPrompts(sessionId);
    engine.stop(sessionId);
    return { stopped: true };
  });

  ipcMain.handle('chat:compact', async (_event, { sessionId, focus } = {}) => engine.compactSession(sessionId, focus));

  ipcMain.handle('chat:reset', async (_event, { sessionId, focus } = {}) => engine.resetContext(sessionId, focus));

  ipcMain.handle('chat:btw', async (_event, { sessionId, question } = {}) => engine.askBtw(sessionId, question));

  ipcMain.handle('chat:helper', async (_event, { sessionId, task, agent } = {}) => engine.runHelper(sessionId, task, agent));

  ipcMain.handle('chat:export', async (_event, { sessionId } = {}) => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('No such chat.');
    const lines = [`# ${session.title || 'CAELIX Chat'}`, '', `- Project: \`${session.cwd}\``, `- Provider: \`${session.provider}\` · Model: \`${session.model}\``, ''];
    for (const msg of session.messages || []) {
      if (msg.hidden || msg.role === 'tool') continue;
      lines.push(`## ${msg.role === 'user' ? 'User' : 'CAELIX'}`, '', String(msg.content || ''), '');
    }
    const content = lines.join('\n');
    const result = await dialog.showSaveDialog(win, {
      title: 'Export chat transcript',
      defaultPath: path.join(session.cwd || projectPath(), `${(session.title || 'caelix-chat').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('mcp:list', (_event, { cwd } = {}) => mcp.status(cwd || projectPath()));

  ipcMain.handle('mcp:save', async (_event, payload = {}) => {
    mcp.saveServer({ ...payload, cwd: payload.cwd || projectPath() });
    return mcp.status(payload.cwd || projectPath());
  });

  ipcMain.handle('mcp:toggle', async (_event, payload = {}) => {
    mcp.toggleServer({ ...payload, cwd: payload.cwd || projectPath() });
    return mcp.status(payload.cwd || projectPath());
  });

  ipcMain.handle('mcp:remove', async (_event, payload = {}) => {
    mcp.removeServer({ ...payload, cwd: payload.cwd || projectPath() });
    return mcp.status(payload.cwd || projectPath());
  });

  ipcMain.handle('mcp:import-claude', async (_event, { cwd } = {}) => {
    const imported = mcp.importClaudeServers();
    const servers = await mcp.status(cwd || projectPath());
    return { imported, servers };
  });

  ipcMain.handle('agents:list', (_event, { cwd } = {}) => agents.list(cwd || projectPath()));

  ipcMain.handle('agents:save', (_event, payload = {}) => agents.saveAgent({ ...payload, cwd: payload.cwd || projectPath() }));

  ipcMain.handle('agents:remove', (_event, payload = {}) => agents.removeAgent({ ...payload, cwd: payload.cwd || projectPath() }));

  ipcMain.handle('hooks:list', (_event, { cwd } = {}) => hooks.list(cwd || projectPath()));

  ipcMain.handle('hooks:save', (_event, payload = {}) => hooks.saveHook({ ...payload, cwd: payload.cwd || projectPath() }));

  ipcMain.handle('hooks:toggle', (_event, payload = {}) => hooks.toggleHook({ ...payload, cwd: payload.cwd || projectPath() }));

  ipcMain.handle('hooks:remove', (_event, payload = {}) => hooks.removeHook({ ...payload, cwd: payload.cwd || projectPath() }));

  ipcMain.handle('permission:respond', (_event, { id, decision }) => answerPermission(id, decision));

  ipcMain.handle('question:respond', (_event, { id, answer }) => answerQuestion(id, answer));

  ipcMain.handle('tasks:list', () => engine.tasks.list());

  ipcMain.handle('tasks:stop', (_event, id) => engine.tasks.stop(id));

  ipcMain.handle('memory:list', (_event, { cwd } = {}) => {
    const root = path.resolve(cwd || projectPath());
    const entries = engine.memory(root);
    const prompt = engine.systemPrompt({ cwd: root, mode: 'ask', messages: [] });
    return {
      cwd: root,
      entries,
      promptTokens: Math.max(1, Math.round(prompt.length / 4)),
      promptChars: prompt.length,
    };
  });

  ipcMain.handle('memory:save', (_event, { cwd, file, text } = {}) => {
    const root = path.resolve(cwd || projectPath());
    const allowed = new Set(['CAELIX.md', 'AGENTS.md', path.join('.caelix', 'CAELIX.md')]);
    const name = String(file || 'CAELIX.md');
    if (!allowed.has(name)) throw new Error('That memory file is not supported.');
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('The memory file must stay inside the project.');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(text ?? ''), 'utf8');
    return { file: name, bytes: Buffer.byteLength(String(text ?? '')), entries: engine.memory(root) };
  });

  ipcMain.handle('context:get', (_event, { sessionId } = {}) => {
    const session = sessions.get(sessionId);
    if (!session) return null;
    return engine.contextReport(session);
  });

  ipcMain.handle('checkpoints:list', (_event, { sessionId } = {}) => engine.listCheckpoints(sessionId));

  ipcMain.handle('checkpoints:rewind', (_event, { sessionId, checkpointId } = {}) => engine.rewindCheckpoint(sessionId, checkpointId));

  ipcMain.handle('terminal:tabs', (_event, { sessionId } = {}) => engine.terminalTabs(sessionId));

  ipcMain.handle('terminal:new', (_event, { sessionId } = {}) => engine.newTerminal(sessionId));

  ipcMain.handle('terminal:close', (_event, { sessionId, tabId } = {}) => engine.closeTerminal(sessionId, tabId));

  ipcMain.handle('terminal:active', (_event, { sessionId, tabId } = {}) => engine.setActiveTerminal(sessionId, tabId));

  ipcMain.handle('terminal:run', async (_event, { sessionId, command, tabId } = {}) => engine.runTerminal(sessionId, command, tabId));

  ipcMain.handle('terminal:interrupt', (_event, { sessionId, tabId } = {}) => engine.interruptTerminal(sessionId, tabId));

  ipcMain.handle('browser:state', () => (browserPanel ? browserPanel.state() : { visible: false, url: '', title: '', canBack: false, canForward: false, loading: false }));

  ipcMain.handle('browser:navigate', async (_event, url) => {
    if (!browserPanel) throw new Error('Browser panel is unavailable.');
    return browserPanel.navigate(url);
  });

  ipcMain.handle('browser:back', () => (browserPanel ? browserPanel.back() : null));

  ipcMain.handle('browser:forward', () => (browserPanel ? browserPanel.forward() : null));

  ipcMain.handle('browser:reload', () => (browserPanel ? browserPanel.reload() : null));

  ipcMain.handle('browser:show', (_event, rect) => {
    if (!browserPanel) return null;
    if (rect) browserPanel.setBounds(rect);
    return browserPanel.show();
  });

  ipcMain.handle('browser:hide', () => (browserPanel ? browserPanel.hide() : null));

  ipcMain.handle('browser:bounds', (_event, rect) => {
    browserPanel?.setBounds(rect);
    return true;
  });

  ipcMain.handle('shell:open-external', (_event, url) => {
    if (/^https?:/i.test(url)) return shell.openExternal(url);
    return false;
  });

  ipcMain.handle('first-paint', (_event, value) => {
    firstPaintMs = Number(value) || null;
    return true;
  });
}

async function setup() {
  trace('setup: entered');
  keys = new KeyStore(userData());
  trace('setup: keys loaded');
  sessions = new SessionStore(userData());
  sessions.normalizeChatSurfaceCwd(chatRoot());
  settings = new SettingsStore(userData());
  mcp = new McpManager(userData());
  hooks = new HooksManager(userData());
  agents = new AgentRegistry(userData());
  engine = new Engine({
    sessions,
    keys,
    mcp,
    hooks,
    agents,
    emit,
    ask: requestPermission,
    askUser: requestQuestion,
    checkpointDir: path.join(userData(), 'checkpoints'),
    claudePath: path.join(os.homedir(), '.local', 'bin', 'claude'),
    browser: () => browserPanel,
  });

  if (SELF_CHECK) {
    const workspace = path.join(CHECKS_DIR, 'selfcheck-workspace');
    fs.mkdirSync(workspace, { recursive: true });
    fs.rmSync(path.join(workspace, 'caelix-note.md'), { force: true });
    settings.set('lastCwd', workspace);
    trace('setup: selfcheck workspace ready');
  }

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: 'CAELIX',
    credits: 'A local coding workspace.',
  });
  if (app.dock) {
    const image = nativeImage.createFromPath(ICON);
    if (!image.isEmpty()) app.dock.setIcon(image);
  }
  buildMenu();
  registerIpc();
  trace('setup: launching window');
  createWindow();
  trace('setup: createWindow returned');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock && !SELF_CHECK) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(setup);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || SELF_CHECK) app.quit();
  });
  app.on('before-quit', () => {
    try { browserPanel?.dispose(); } catch { /* best effort */ }
    try { engine?.dispose(); } catch { /* best effort */ }
    try { omnirouteHelper.stop(); } catch { /* best effort */ }
  });
  process.on('uncaughtException', (error) => {
    lastError = { message: error.message, stack: error.stack, at: new Date().toISOString() };
  });
}
