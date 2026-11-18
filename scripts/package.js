#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const APP = path.join(OUT, 'CAELIX.app');
const ELECTRON_APP = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
const SHORTCUT = path.join(os.homedir(), 'Desktop', 'CAELIX.app');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function plist(file, key, value) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, file], { stdio: 'ignore' });
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, file], { stdio: 'ignore' });
  }
}

function deletePlistKey(file, key) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, file], { stdio: 'ignore' });
  } catch {
    // key absent
  }
}

// Electron bundles rely on relative framework symlinks (Versions/Current/...).
// fs.cpSync resolves symlinks to absolute source paths unless told not to, which
// leaves a bundle that cannot find icudtl.dat outside this project folder.
function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
}

function createShortcut(targetApp) {
  const desktop = path.dirname(SHORTCUT);
  if (!fs.existsSync(desktop)) return null;
  try {
    const stat = fs.lstatSync(SHORTCUT);
    if (stat.isSymbolicLink() || stat.isFile()) {
      fs.unlinkSync(SHORTCUT);
    } else {
      return null;
    }
  } catch {
    // shortcut does not exist yet
  }
  fs.symlinkSync(targetApp, SHORTCUT);
  return SHORTCUT;
}

function main() {
  const skipShortcut = process.argv.includes('--no-shortcut');
  if (!fs.existsSync(ELECTRON_APP)) {
    throw new Error('Electron is not installed. Run npm install first.');
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  copy(ELECTRON_APP, APP);

  const contents = path.join(APP, 'Contents');
  const macos = path.join(contents, 'MacOS');
  const resources = path.join(contents, 'Resources');
  const info = path.join(contents, 'Info.plist');

  fs.renameSync(path.join(macos, 'Electron'), path.join(macos, 'CAELIX'));
  plist(info, 'CFBundleExecutable', 'CAELIX');
  plist(info, 'CFBundleName', 'CAELIX');
  plist(info, 'CFBundleDisplayName', 'CAELIX');
  plist(info, 'CFBundleIdentifier', 'app.caelix.desktop');
  plist(info, 'CFBundleShortVersionString', pkg.version);
  plist(info, 'CFBundleVersion', pkg.version);
  plist(info, 'CFBundleIconFile', 'caelix.icns');
  plist(info, 'LSApplicationCategoryType', 'public.app-category.developer-tools');
  plist(info, 'NSHumanReadableCopyright', 'CAELIX');
  deletePlistKey(info, 'ElectronAsarIntegrity');

  fs.copyFileSync(path.join(ROOT, 'assets', 'icon.icns'), path.join(resources, 'caelix.icns'));
  fs.rmSync(path.join(resources, 'electron.icns'), { force: true });
  fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });

  const appDir = path.join(resources, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  // Self-check artifacts must never end up inside the bundle: they would be
  // sealed by the signature and then rewritten on the next run, invalidating it.
  fs.rmSync(path.join(appDir, 'checks'), { recursive: true, force: true });
  copy(path.join(ROOT, 'src'), path.join(appDir, 'src'));
  copy(path.join(ROOT, 'assets'), path.join(appDir, 'assets'));
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
    name: 'caelix',
    productName: 'CAELIX',
    version: pkg.version,
    description: pkg.description,
    main: 'src/main.js',
    private: true,
    license: pkg.license,
  }, null, 2));

  // Sign with the stable local "CAELIX Local" identity. An ad-hoc signature
  // changes the code hash on every build, so macOS asks for the keychain
  // password again after each rebuild before CAELIX can read "CAELIX Safe
  // Storage". A stable identity keeps one keychain ACL entry valid forever:
  // the user approves it once, and no rebuild ever prompts again. The signing
  // key lives in ~/Library/Keychains/caelix-signing.keychain.
  const signingKeychain = path.join(os.homedir(), 'Library', 'Keychains', 'caelix-signing.keychain-db');
  let signed = false;
  if (fs.existsSync(signingKeychain)) {
    try {
      run('security', ['unlock-keychain', '-p', 'cx-sign-local', signingKeychain]);
      run('codesign', ['--force', '--deep', '--sign', 'CAELIX Local', '--identifier', 'app.caelix.desktop', APP]);
      signed = true;
    } catch (error) {
      console.warn(`Stable signing failed (${error.message.split('\n')[0]}); falling back to ad-hoc.`);
    }
  }
  if (!signed) {
    try {
      run('codesign', ['--force', '--sign', '-', '--identifier', 'app.caelix.desktop', APP]);
    } catch {
      console.warn('Ad-hoc signing failed; the bundle may still run from this Mac.');
    }
  }

  // A bundle that fails this check is reported by macOS as "damaged" the
  // moment it is downloaded, so never hand out a build that does not pass.
  // Codesign walks the nested helpers and frameworks as well.
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', APP], { stdio: 'pipe' });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim();
    throw new Error(`Signature seal is invalid — macOS would call this app "damaged".\n${detail}\nFix the build before packaging: nothing may be written into dist/CAELIX.app after signing.`);
  }
  console.log('Signature seal valid (codesign --verify --deep --strict).');

  const shortcut = skipShortcut ? null : createShortcut(APP);
  console.log('');
  console.log(`Built ${path.relative(ROOT, APP)} (${pkg.version}).`);
  if (shortcut) console.log(`Desktop shortcut: ${shortcut}`);
  console.log(`Open it with: open "${path.relative(ROOT, APP)}"`);
}

main();
