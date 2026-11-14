#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function check(name, ok, detail) {
  return { name, ok, detail };
}

async function doctor() {
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(check('Node.js', major >= 22, process.versions.node));

  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  checks.push(check('Electron binary', fs.existsSync(electron), electron));

  for (const asset of ['icon.svg', 'icon-1024.png', 'icon.icns']) {
    const file = path.join(ROOT, 'assets', asset);
    checks.push(check(`Asset ${asset}`, fs.existsSync(file), file));
  }

  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  checks.push(check('Git', git.status === 0, (git.stdout || git.stderr).trim()));

  const claude = path.join(os.homedir(), '.local', 'bin', 'claude');
  checks.push(check('Claude Code (optional provider)', fs.existsSync(claude), claude));

  const userData = path.join(os.homedir(), 'Library', 'Application Support', 'CAELIX');
  const keyFile = path.join(userData, 'keys.enc');
  checks.push(check('Encrypted key store', !fs.existsSync(keyFile) || fs.statSync(keyFile).size > 0, keyFile));

  for (const item of checks) {
    console.log(`${item.ok ? '✓' : '✗'} ${item.name}: ${item.detail}`);
  }
  const failed = checks.filter((item) => !item.ok && item.name !== 'Claude Code (optional provider)');
  console.log('');
  console.log(failed.length ? `Doctor found ${failed.length} problem(s).` : 'Doctor passed.');
  process.exitCode = failed.length ? 1 : 0;
}

async function main() {
  const command = process.argv[2] || 'help';
  if (command === 'doctor') return doctor();
  if (command === 'run') {
    console.log('Headless run is part of the phase 1 build plan. Use the window for now: npm start');
    return;
  }
  console.log('CAELIX');
  console.log('  caelix doctor        check the local runtime');
  console.log('  caelix run <prompt>  headless engine (phase 1)');
  console.log('  npm start            open the CAELIX window');
  console.log('  npm run selfcheck    drive the real app with the pretend model');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
