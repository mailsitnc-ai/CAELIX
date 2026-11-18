'use strict';

// Small cross-platform layer. macOS remains the primary platform, but every
// shell, terminal, hook and updater path goes through here so the same code
// runs on Windows instead of assuming /bin/zsh and POSIX tools exist.

const path = require('path');
const { spawn, execFileSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

// Windows PowerShell is the shell CAELIX uses for agent commands and hooks.
// `-Command -` style stdin piping is avoided: scripts receive JSON on stdin
// and run as a single -Command string.
const POWERSHELL = 'powershell.exe';

function shellCommand(command) {
  if (IS_WIN) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    return { file: comspec, args: ['/d', '/s', '/c', String(command)] };
  }
  return { file: '/bin/zsh', args: ['-lc', String(command)] };
}

function spawnShell(command, options = {}) {
  const { file, args } = shellCommand(command);
  return spawn(file, args, options);
}

// Hooks receive JSON on stdin, so they need an interpreter that runs a script
// string directly rather than a command line meant for cmd.exe.
function spawnHook(command, options = {}) {
  if (IS_WIN) {
    return spawn(POWERSHELL, [
      '-NoLogo', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-Command', String(command),
    ], { windowsHide: true, ...options });
  }
  return spawn('/bin/zsh', ['-lc', String(command)], options);
}

function killTree(child, signal = 'SIGKILL') {
  if (!child || !child.pid) return;
  if (IS_WIN) {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch { /* already gone */ }
    return;
  }
  try { process.kill(-child.pid, signal); } catch { /* group gone */ }
  try { child.kill(signal); } catch { /* already gone */ }
}

// GUI-launched apps get a short PATH. Rebuild it with the places developer
// tools actually live on each platform.
function mergedPath(extra = []) {
  const sep = IS_WIN ? ';' : ':';
  const current = process.env.PATH || process.env.Path || '';
  const defaults = IS_WIN
    ? [
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0'),
      process.env.ProgramFiles || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : '',
      process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : '',
      path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Microsoft', 'WindowsApps'),
    ]
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const dirs = [...new Set([...extra, ...defaults, ...current.split(sep)].filter(Boolean))];
  return dirs.join(sep);
}

function which(command) {
  try {
    const lines = execFileSync(IS_WIN ? 'where' : 'which', [command], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2500,
    }).trim().split(/\r?\n/);
    return lines[0] || null;
  } catch {
    return null;
  }
}

function pythonCommand() {
  for (const candidate of ['python3', 'python', 'py']) {
    if (which(candidate)) return candidate;
  }
  return null;
}

module.exports = {
  IS_WIN,
  IS_MAC,
  IS_LINUX,
  POWERSHELL,
  shellCommand,
  spawnShell,
  spawnHook,
  killTree,
  mergedPath,
  which,
  pythonCommand,
};
