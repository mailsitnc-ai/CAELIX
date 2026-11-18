#!/usr/bin/env node
// Build a distributable DMG from the packaged CAELIX.app.
//
// Uses only macOS built-ins (hdiutil, codesign) — no extra dependencies. The
// DMG contains CAELIX.app plus a symlink to /Applications so the normal
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

// macOS reports a bundle whose seal does not match its files as "damaged".
// That is the single most common false "corrupted download" report, so the
// DMG is never built from a bundle that fails this check.
function assertSeal(target) {
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', target], { stdio: 'pipe' });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim();
    throw new Error(
      `Signature seal invalid at ${target} — macOS would report this app as "damaged".\n${detail}\n` +
      'Rebuild with `npm run package` and do not write into the bundle afterwards.',
    );
  }
}

if (!fs.existsSync(APP)) {
  throw new Error('dist/CAELIX.app not found — run `npm run package` first.');
}

// Gate 1: the app on disk must be internally consistent before it is copied.
assertSeal(APP);

// Self-check output belongs outside the bundle (see src/main.js). If a stale
// folder is found here it would be sealed into the app, so refuse to ship it.
if (fs.existsSync(path.join(APP, 'Contents', 'Resources', 'app', 'checks'))) {
  throw new Error(
    'dist/CAELIX.app contains a checks/ folder — that is self-check output inside the bundle.\n' +
    'It breaks the signature. Rebuild with `npm run package` and run self-checks with CAELIX_CHECKS_DIR outside dist/.',
  );
}

// Fresh staging folder: app + Applications symlink for drag-to-install.
fs.rmSync(STAGING, { recursive: true, force: true });
fs.mkdirSync(STAGING, { recursive: true });
fs.cpSync(APP, path.join(STAGING, 'CAELIX.app'), { recursive: true, verbatimSymlinks: true });
fs.symlinkSync('/Applications', path.join(STAGING, 'Applications'), 'dir');

// First-launch help, visible in the mounted image without opening the app.
fs.writeFileSync(path.join(STAGING, 'READ ME FIRST.txt'), [
  'CAELIX — first launch on macOS',
  '',
  '1. Drag CAELIX into the Applications folder.',
  '2. macOS will warn on the first launch because CAELIX is signed with a',
  '   local certificate, not a paid Apple one. It is not damaged.',
  '3. Open the Terminal app and run this once:',
  '',
  '     xattr -cr /Applications/CAELIX.app',
  '',
  '   Then open CAELIX normally. You only need to do this one time.',
  '',
  'Alternative without Terminal: right-click CAELIX -> Open -> Open.',
  'If macOS says the app is damaged, use the xattr command above; that',
  'message means the download was quarantined, not corrupted.',
  '',
].join('\n'));

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

// Integrity check, then a real mount test: the app binary must exist, carry
// the right version, and still pass the signature seal from inside the image.
run('hdiutil', ['verify', DMG]);
const MOUNT = path.join(ROOT, 'dist', 'dmg-verify');
fs.rmSync(MOUNT, { recursive: true, force: true });
fs.mkdirSync(MOUNT, { recursive: true });
run('hdiutil', ['attach', DMG, '-mountpoint', MOUNT, '-nobrowse', '-readonly']);
try {
  const mountedApp = path.join(MOUNT, 'CAELIX.app');
  const staged = path.join(mountedApp, 'Contents', 'Info.plist');
  const check = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', staged], { encoding: 'utf8' }).trim();
  const binary = fs.existsSync(path.join(mountedApp, 'Contents', 'MacOS', 'CAELIX'));
  if (check !== pkg.version || !binary) {
    throw new Error(`DMG content check failed: version=${check} binary=${binary}`);
  }
  if (!fs.existsSync(path.join(MOUNT, 'READ ME FIRST.txt'))) {
    throw new Error('DMG is missing the first-launch instructions.');
  }
  assertSeal(mountedApp);
  console.log(`DMG verified: CAELIX ${check}, binary present, signature seal valid.`);
} finally {
  try { execFileSync('hdiutil', ['detach', MOUNT, '-force'], { stdio: 'ignore' }); } catch { /* detach best-effort */ }
  fs.rmSync(MOUNT, { recursive: true, force: true });
}

const bytes = fs.statSync(DMG).size;
console.log(`Built ${DMG} (${(bytes / 1024 / 1024).toFixed(1)} MB).`);
