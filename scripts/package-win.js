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
    // No AppleDouble sidecars: a Windows user must not find __MACOSX or ._ files.
    run('ditto', ['-c', '-k', '--norsrc', '--noextattr', '--noqtn', '--keepParent', source, target]);
  }
}

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
}

// ---- Windows branding -----------------------------------------------------
// The Electron archive ships its own icon and product strings. Both live in
// the executable's resource section, so they are rewritten here with resedit
// (pure JavaScript, no native build step).

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

// Build a multi-size .ico whose entries hold PNG data (supported by Windows
// Vista and later). sips renders each size; no extra tooling required.
function buildIco(sourcePng, targetIco) {
  const work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'caelix-ico-'));
  const images = [];
  try {
    for (const size of ICON_SIZES) {
      const out = path.join(work, `${size}.png`);
      run('sips', ['-z', String(size), String(size), sourcePng, '--out', out], { stdio: 'pipe' });
      images.push({ size, data: fs.readFileSync(out) });
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(images.length * 16);
  let offset = header.length + entries.length;
  images.forEach((image, index) => {
    const base = index * 16;
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, base);
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, base + 1);
    entries.writeUInt8(0, base + 2);
    entries.writeUInt8(0, base + 3);
    entries.writeUInt16LE(1, base + 4);
    entries.writeUInt16LE(32, base + 6);
    entries.writeUInt32LE(image.data.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    offset += image.data.length;
  });

  fs.writeFileSync(targetIco, Buffer.concat([header, entries, ...images.map((image) => image.data)]));
  return targetIco;
}

function brandExecutable(exePath, icoPath) {
  let resedit;
  try {
    resedit = require('resedit');
  } catch {
    console.warn('resedit is not installed; leaving the Electron icon in place.');
    return false;
  }
  const { NtExecutable, NtExecutableResource, Resource, Data } = resedit;

  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  // 1. Application icon (first icon group in the executable).
  const iconFile = Data.IconFile.from(fs.readFileSync(icoPath));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    groupId,
    1033,
    iconFile.icons.map((icon) => icon.data),
  );

  // 2. "Properties → Details" strings and the taskbar tooltip.
  const versions = Resource.VersionInfo.fromEntries(res.entries);
  if (versions.length) {
    const version = versions[0];
    const [major, minor, build] = String(pkg.version).split('.').map((part) => Number(part) || 0);
    version.setFileVersion(major, minor, build, 0);
    version.setProductVersion(major, minor, build, 0);
    version.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: 'CAELIX',
      FileDescription: 'CAELIX — local AI coding agent',
      InternalName: 'CAELIX',
      OriginalFilename: 'CAELIX.exe',
      CompanyName: 'CAELIX',
      LegalCopyright: 'MIT licensed',
    });
    versions[0].outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  return true;
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

  // Give CAELIX.exe its own icon and product details, exactly like the
  // macOS bundle carries its own icon.
  const ico = path.join(DIST, 'cache', 'caelix.ico');
  buildIco(path.join(ROOT, 'assets', 'icon-1024.png'), ico);
  const branded = brandExecutable(path.join(appDir, 'CAELIX.exe'), ico);
  console.log(branded ? 'Branded CAELIX.exe (icon + version info).' : 'Skipped exe branding.');

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
