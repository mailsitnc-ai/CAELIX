#!/usr/bin/env node
// Build a distributable DMG from the packaged CAELIX.app.
//
// Uses only macOS built-ins (hdiutil) — no extra dependencies. The DMG
// contains CAELIX.app plus a symlink to /Applications so the normal
// drag-to-Install flow works. Run `npm run package` first.
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'dist', 'CAELIX.app');
const STAGING = path.join(ROOT, 'dist', 'dmg-staging');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const DMG = path.join(ROOT, 'dist', `CAELIX-${pkg.version}.dmg`);

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

if (!fs.existsSync(APP)) {
  throw new Error('dist/CAELIX.app not found — run `npm run package` first.');
}

// Fresh staging folder: app + Applications symlink for drag-to-install.
fs.rmSync(STAGING, { recursive: true, force: true });
fs.mkdirSync(STAGING, { recursive: true });
fs.cpSync(APP, path.join(STAGING, 'CAELIX.app'), { recursive: true, verbatimSymlinks: true });
fs.symlinkSync('/Applications', path.join(STAGING, 'Applications'), 'dir');

// A stale volume or DMG from a previous run would make hdiutil fail or ship
// a cached image, so clear both first.
try { execFileSync('hdiutil', ['detach', '/Volumes/CAELIX', '-force'], { stdio: 'ignore' }); } catch { /* not mounted */ }
fs.rmSync(DMG, { force: true });

run('hdiutil', [
  'create',
  '-volname', 'CAELIX',
  '-srcfolder', STAGING,
  '-format', 'UDZO',
  '-fs', 'HFS+',
  DMG,
]);

fs.rmSync(STAGING, { recursive: true, force: true });

// Integrity check, then a real mount test: the app binary must exist and the
// bundle must carry the right version before this DMG is called done.
run('hdiutil', ['verify', DMG]);
const MOUNT = path.join(ROOT, 'dist', 'dmg-verify');
fs.rmSync(MOUNT, { recursive: true, force: true });
fs.mkdirSync(MOUNT, { recursive: true });
run('hdiutil', ['attach', DMG, '-mountpoint', MOUNT, '-nobrowse', '-readonly']);
try {
  const staged = path.join(MOUNT, 'CAELIX.app', 'Contents', 'Info.plist');
  const check = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', staged], { encoding: 'utf8' }).trim();
  const binary = fs.existsSync(path.join(MOUNT, 'CAELIX.app', 'Contents', 'MacOS', 'CAELIX'));
  if (check !== pkg.version || !binary) {
    throw new Error(`DMG content check failed: version=${check} binary=${binary}`);
  }
  console.log(`DMG verified: CAELIX ${check}, binary present.`);
} finally {
  try { execFileSync('hdiutil', ['detach', MOUNT, '-force'], { stdio: 'ignore' }); } catch { /* detach best-effort */ }
  fs.rmSync(MOUNT, { recursive: true, force: true });
}

const bytes = fs.statSync(DMG).size;
console.log(`Built ${DMG} (${(bytes / 1024 / 1024).toFixed(1)} MB).`);
