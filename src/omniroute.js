'use strict';

// Owns the local OmniRoute helper process (https://www.omniroute.online/).
// CAELIX starts it on demand the first time an OmniRoute model is used or
// tested, reuses it while it answers on port 20128, and shuts it down when
// CAELIX quits. CAELIX never passes provider keys to the helper — users
// connect their own credentials once in the OmniRoute dashboard.

const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const platform = require('./platform');

const PORT = 20128;
const EXTRA_BIN_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(os.homedir(), '.npm-global', 'bin'),
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), 'bin'),
];

let child = null;
let stopping = false;
let startup = null;
let lastExit = null;

function probeOnce() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/v1/models', timeout: 1500 }, (res) => {
      res.resume();
      // Any HTTP answer — 200 or 401 — means the gateway is alive.
      resolve(true);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function isUp() {
  if (await probeOnce()) return true;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return probeOnce();
}

// The omniroute binary is a `#!/usr/bin/env node` script, so the child PATH
// must include a directory that has node — GUI-launched Electron apps get a
// minimal PATH, so we rebuild it around what we actually find.
function childEnv(binDir) {
  const merged = platform.mergedPath([binDir, ...EXTRA_BIN_DIRS].filter(Boolean));
  return { ...process.env, PATH: merged, Path: merged };
}

function findLauncher() {
  const direct = platform.which('omniroute');
  if (direct) return { cmd: direct, args: [], binDir: path.dirname(direct) };
  // Fallback: npx resolves the package from its cache. `where` on Windows
  // returns the .cmd shim, which spawn needs explicitly.
  const npx = platform.which('npx');
  if (npx) return { cmd: npx, args: ['-y', 'omniroute'], binDir: path.dirname(npx) };
  return { cmd: 'npx', args: ['-y', 'omniroute'], binDir: null };
}

function launch(logDir) {
  const { cmd, args, binDir } = findLauncher();
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch { /* best effort */ }
  const logPath = path.join(logDir, 'omniroute-helper.log');
  let logStream = null;
  try { logStream = fs.createWriteStream(logPath, { flags: 'a' }); } catch { /* best effort */ }

  const started = Date.now();
  try {
    child = spawn(cmd, args, {
      stdio: ['ignore', logStream ? 'pipe' : 'ignore', logStream ? 'pipe' : 'ignore'],
      env: childEnv(binDir),
    });
  } catch (error) {
    child = null;
    throw new Error(`Could not start the OmniRoute helper (${error.message}).`);
  }
  if (logStream) {
    logStream.write(`\n[${new Date().toISOString()}] CAELIX launched ${cmd} ${args.join(' ')}\n`);
    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });
  }
  child.on('exit', (code, signal) => {
    lastExit = { code, signal, at: new Date().toISOString(), ranMs: Date.now() - started };
    if (!stopping) child = null; // crashed or was killed — next ensure() relaunches
  });
  child.on('error', () => { if (!stopping) child = null; });
}

function waitUntilUp(deadline) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await probeOnce()) { resolve(); return; }
      if (child && child.exitCode !== null) {
        reject(new Error('The OmniRoute helper exited during startup. Run `npx omniroute` in a terminal to see why.'));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error('The OmniRoute helper did not answer on localhost:20128 in time. Try again, or run `npx omniroute` in a terminal.'));
        return;
      }
      setTimeout(tick, 700);
    };
    tick();
  });
}

// Starts the helper if needed and resolves once the gateway answers.
// Concurrent callers share one startup attempt.
async function ensure(logDir, timeoutMs = 180000) {
  if (await isUp()) return { up: true, started: false };
  if (!startup) {
    startup = (async () => {
      stopping = false;
      launch(logDir);
      await waitUntilUp(Date.now() + timeoutMs);
      return { up: true, started: true };
    })().finally(() => { startup = null; });
  }
  return startup;
}

async function status() {
  return { up: await isUp(), managed: Boolean(child), lastExit };
}

function stop() {
  if (!child) return;
  stopping = true;
  const dying = child;
  child = null;
  try { dying.kill('SIGTERM'); } catch { /* already gone */ }
  setTimeout(() => {
    try { if (dying.exitCode === null) dying.kill('SIGKILL'); } catch { /* gone */ }
  }, 2000).unref?.();
}

module.exports = { ensure, status, stop, isUp, PORT };
