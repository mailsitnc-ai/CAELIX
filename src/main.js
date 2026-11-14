'use strict';

const {
  app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, shell, safeStorage,
} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { KeyStore, SessionStore, SettingsStore } = require('./store');
const { Engine } = require('./engine');
const { providerList, testKey, PROVIDERS } = require('./engine/providers');

const PROCESS_STARTED = Date.now();
const APP_NAME = 'CAELIX';
const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'assets', 'icon-1024.png');
const SELF_CHECK = process.env.CAELIX_SELFCHECK === '1';

app.setName(APP_NAME);

if (SELF_CHECK) {
  const isolated = path.join(app.getPath('appData'), 'CAELIX Selfcheck');
  app.setPath('userData', isolated);
  fs.mkdirSync(isolated, { recursive: true });
  for (const file of ['sessions.json', 'keys.enc']) {
    try { fs.rmSync(path.join(isolated, file), { force: true }); } catch { /* fresh run */ }
  }
}

let win = null;
let keys = null;
let sessions = null;
let settings = null;
let engine = null;
let windowReadyMs = null;
let firstPaintMs = null;
let lastError = null;
const pendingPermissions = new Map();
const pendingQuestions = new Map();

function emit(event) {
  if (win && !win.isDestroyed()) win.webContents.send('chat:event', event);
}

function userData() {
  return app.getPath('userData');
}

function requestPermission(request) {
  return new Promise((resolve) => {
    const id = `perm_${crypto.randomUUID()}`;
    const timer = setTimeout(() => {
      if (pendingPermissions.has(id)) {
        pendingPermissions.delete(id);
        resolve('deny');
      }
    }, 120000);
    pendingPermissions.set(id, { resolve, timer });
    emit({ type: 'permission-request', id, ...request });
  });
}

function answerPermission(id, decision) {
  const pending = pendingPermissions.get(id);
  if (!pending) return false;
  pendingPermissions.delete(id);
  clearTimeout(pending.timer);
  pending.resolve(decision === 'deny' ? 'deny' : decision === 'session' ? 'session' : 'allow');
  return true;
}

function requestQuestion(request) {
  return new Promise((resolve) => {
    const id = `question_${crypto.randomUUID()}`;
    const timer = setTimeout(() => {
      if (pendingQuestions.has(id)) {
        pendingQuestions.delete(id);
        resolve('No answer (timed out).');
      }
    }, 600000);
    pendingQuestions.set(id, { resolve, timer });
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

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0b0d10',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 17 },
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

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
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
        checksDir: path.join(ROOT, 'checks'),
        workspace: path.join(ROOT, 'checks', 'selfcheck-workspace'),
      }).catch((error) => {
        try {
          fs.mkdirSync(path.join(ROOT, 'checks'), { recursive: true });
          fs.writeFileSync(path.join(ROOT, 'checks', 'selfcheck-crash.txt'), String(error.stack || error));
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
    provider: session.provider,
    model: session.model,
    mode: session.mode,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
  };
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
    windowReadyMs,
    firstPaintMs,
    encryption: safeStorage.isEncryptionAvailable(),
  }));

  ipcMain.handle('providers:list', () => providerList(SELF_CHECK));

  ipcMain.handle('keys:status', () => {
    const mask = new Map(keys.status().map((row) => [row.provider, row]));
    return providerList(SELF_CHECK).map((provider) => ({
      ...provider,
      configured: mask.has(provider.id),
      masked: mask.get(provider.id)?.masked || null,
    }));
  });

  ipcMain.handle('keys:save', (_event, { provider, key }) => {
    if (!PROVIDERS[provider] || PROVIDERS[provider].keyless) throw new Error('That provider does not use a key.');
    keys.set(provider, key);
    return { provider, masked: keys.masked(provider) };
  });

  ipcMain.handle('keys:delete', (_event, { provider }) => {
    keys.delete(provider);
    return { provider, masked: null };
  });

  ipcMain.handle('keys:test', async (_event, { provider, key }) => {
    const value = key || keys.get(provider);
    if (!value) throw new Error('Paste a key first.');
    await testKey(provider, value);
    return { ok: true, message: 'Key accepted.' };
  });

  ipcMain.handle('sessions:list', () => sessions.list());

  ipcMain.handle('sessions:get', (_event, id) => sessions.get(id));

  ipcMain.handle('sessions:create', (_event, input = {}) => {
    const session = sessions.create({
      cwd: input.cwd || projectPath(),
      provider: input.provider || (SELF_CHECK ? 'simulator' : 'gemini'),
      model: input.model || (SELF_CHECK ? 'sim-1' : 'gemini-2.5-flash'),
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
    const allowed = {};
    for (const key of ['provider', 'model', 'mode', 'cwd', 'title']) {
      if (patch[key] !== undefined) allowed[key] = patch[key];
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

  ipcMain.handle('chat:send', async (_event, { sessionId, text }) => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('No such chat.');
    if (session.title === 'New chat' && String(text).trim()) {
      const title = String(text).trim().replace(/\s+/g, ' ').slice(0, 52);
      sessions.rename(sessionId, title);
      emit({ type: 'session-updated', session: sessionSummary(sessions.get(sessionId)) });
    }
    engine.send(sessionId, text).catch((error) => {
      emit({ type: 'error', message: error.message });
    });
    return { started: true };
  });

  ipcMain.handle('chat:stop', (_event, sessionId) => {
    engine.stop(sessionId);
    return { stopped: true };
  });

  ipcMain.handle('permission:respond', (_event, { id, decision }) => answerPermission(id, decision));

  ipcMain.handle('question:respond', (_event, { id, answer }) => answerQuestion(id, answer));

  ipcMain.handle('tasks:list', () => engine.tasks.list());

  ipcMain.handle('tasks:stop', (_event, id) => engine.tasks.stop(id));

  ipcMain.handle('terminal:run', async (_event, { sessionId, command }) => engine.runTerminal(sessionId, command));

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
  keys = new KeyStore(userData());
  sessions = new SessionStore(userData());
  settings = new SettingsStore(userData());
  engine = new Engine({
    sessions,
    keys,
    emit,
    ask: requestPermission,
    askUser: requestQuestion,
    claudePath: path.join(os.homedir(), '.local', 'bin', 'claude'),
  });

  if (SELF_CHECK) {
    const workspace = path.join(ROOT, 'checks', 'selfcheck-workspace');
    fs.mkdirSync(workspace, { recursive: true });
    fs.rmSync(path.join(workspace, 'caelix-note.md'), { force: true });
    settings.set('lastCwd', workspace);
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
  createWindow();
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
  process.on('uncaughtException', (error) => {
    lastError = { message: error.message, stack: error.stack, at: new Date().toISOString() };
  });
}
