#!/usr/bin/env node
// Build a portable Windows x64 build from the same sources as the macOS app.
//
// Dependency-free: downloads the official prebuilt Electron for Windows and
// assembles the app into it. No Wine, no native compilation, no installer
// toolchain. Output: dist/CAELIX-<version>-win-x64.zip
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(DIST, 'cache');
const BUILD = path.join(DIST, 'win-build');
const OUT_NAME = 'CAELIX-win-x64';
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

async function download(url, target) {
  if (fs.existsSync(target) && fs.statSync(target).size > 10 * 1024 * 1024) {
    console.log(`Using cached ${path.relative(ROOT, target)}`);
    return;
  }
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { headers: { 'user-agent': 'CAELIX-Build' } });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stream = fs.createWriteStream(target);
  await new Promise((resolve, reject) => {
    const body = Readable.fromWeb(response.body);
    body.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', resolve);
    body.pipe(stream);
  });
}

function unzip(archive, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === 'win32') {
    run('powershell.exe', ['-NoLogo', '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`]);
  } else {
    run('ditto', ['-x', '-k', archive, destination]);
  }
}

function zip(source, target) {
  fs.rmSync(target, { force: true });
  if (process.platform === 'win32') {
    run('powershell.exe', ['-NoLogo', '-NoProfile', '-Command',
      `Compress-Archive -LiteralPath '${source.replace(/'/g, "''")}' -DestinationPath '${target.replace(/'/g, "''")}' -Force`]);
  } else {
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', source, target]);
  }
}

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
}

async function main() {
  const electronVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  const archive = path.join(CACHE, `electron-v${electronVersion}-win32-x64.zip`);
  await download(`https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-win32-x64.zip`, archive);

  fs.rmSync(BUILD, { recursive: true, force: true });
  unzip(archive, BUILD);

  const appDir = path.join(DIST, OUT_NAME);
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.renameSync(BUILD, appDir);

  if (fs.existsSync(path.join(appDir, 'electron.exe'))) {
    fs.renameSync(path.join(appDir, 'electron.exe'), path.join(appDir, 'CAELIX.exe'));
  }
  if (!fs.existsSync(path.join(appDir, 'CAELIX.exe'))) {
    throw new Error('The Electron Windows archive did not contain electron.exe.');
  }
  fs.rmSync(path.join(appDir, 'resources', 'default_app.asar'), { force: true });

  const resourcesApp = path.join(appDir, 'resources', 'app');
  fs.rmSync(resourcesApp, { recursive: true, force: true });
  fs.mkdirSync(resourcesApp, { recursive: true });
  copy(path.join(ROOT, 'src'), path.join(resourcesApp, 'src'));
  copy(path.join(ROOT, 'assets'), path.join(resourcesApp, 'assets'));
  fs.writeFileSync(path.join(resourcesApp, 'package.json'), JSON.stringify({
    name: 'caelix',
    productName: 'CAELIX',
    version: pkg.version,
    description: pkg.description,
    main: 'src/main.js',
    private: true,
    license: pkg.license,
  }, null, 2));

  fs.writeFileSync(path.join(appDir, 'READ ME FIRST.txt'), [
    'CAELIX for Windows',
    '',
    '1. Keep this whole folder together (do not move CAELIX.exe out of it).',
    '2. Run CAELIX.exe.',
    '3. Windows SmartScreen may warn because the app is not code-signed:',
    '   click "More info", then "Run anyway". This is expected and only',
    '   happens on the first launch.',
    '4. Add a free API key in Keys, or start right away — Kilo needs no key.',
    '',
    'Updates: when a newer release exists, an Update button appears in the',
    'top bar and installs it automatically.',
    '',
  ].join('\r\n'));

  const out = path.join(DIST, `CAELIX-${pkg.version}-win-x64.zip`);
  zip(appDir, out);

  const exe = path.join(appDir, 'CAELIX.exe');
  if (!fs.existsSync(exe)) throw new Error('CAELIX.exe is missing after packaging.');
  const bytes = fs.statSync(out).size;
  console.log(`Built ${out} (${(bytes / 1024 / 1024).toFixed(1)} MB).`);
  console.log(`Windows app folder: ${path.relative(ROOT, appDir)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
