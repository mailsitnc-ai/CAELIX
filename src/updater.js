'use strict';

// In-app updates. The installed app asks GitHub for the latest published
// release, downloads its DMG, verifies the image and the code signature, then
// swaps the running bundle for the new one and relaunches. Because the check
// always reads `releases/latest`, shipping a future version only needs a new
// GitHub release — no code change and no second repository update.

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { execFileSync, spawn } = require('child_process');

const REPO = 'mailsitnc-ai/CAELIX';
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const USER_AGENT = 'CAELIX-Updater';

function versionParts(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => {
      const match = String(part).match(/^\d+/);
      return match ? Number(match[0]) : 0;
    });
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

// Turn a GitHub release payload into the small shape the UI needs.
function parseRelease(data, currentVersion) {
  const latest = String(data?.tag_name || '').replace(/^v/i, '');
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const dmg = assets.find((asset) => /\.dmg$/i.test(String(asset?.name || '')));
  return {
    current: String(currentVersion || ''),
    latest,
    available: Boolean(latest) && compareVersions(latest, currentVersion) > 0,
    assetName: dmg?.name || null,
    assetUrl: dmg?.browser_download_url || null,
    assetSize: Number(dmg?.size || 0) || null,
    pageUrl: data?.html_url || `https://github.com/${REPO}/releases/latest`,
    notes: String(data?.body || ''),
  };
}

async function check({ currentVersion, fetchImpl = global.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('No network fetch available.');
  const response = await fetchImpl(LATEST_API, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} while checking for updates.`);
  }
  return parseRelease(await response.json(), currentVersion);
}

async function download(url, target, onProgress) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok || !response.body) {
    throw new Error(`Update download failed (HTTP ${response.status}).`);
  }
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  let lastReported = 0;
  const stream = fs.createWriteStream(target);
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    const percent = total ? Math.min(99, Math.round((received / total) * 100)) : 0;
    if (percent >= lastReported + 2) {
      lastReported = percent;
      onProgress?.({ stage: 'download', percent, received, total });
    }
  });
  await new Promise((resolve, reject) => {
    body.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', resolve);
    body.pipe(stream);
  });
  onProgress?.({ stage: 'download', percent: 100, received, total });
}

// The bundle that contains the running executable, e.g. /Applications/CAELIX.app.
function currentAppPath(execPath = process.execPath) {
  const macos = path.dirname(execPath);
  if (path.basename(macos) !== 'MacOS') return null;
  const contents = path.dirname(macos);
  if (path.basename(contents) !== 'Contents') return null;
  const bundle = path.dirname(contents);
  return bundle.endsWith('.app') ? bundle : null;
}

async function install({
  app, currentVersion, onProgress, openPath, fetchImpl = global.fetch,
  target: targetOverride = null, relaunch = true,
} = {}) {
  if (!app?.isPackaged) {
    throw new Error('Updates install into the packaged app only. Run `npm run package` first.');
  }
  const info = await check({ currentVersion, fetchImpl });
  if (!info.available) return { upToDate: true, ...info };
  if (!info.assetUrl) throw new Error(`Release ${info.latest} has no DMG to install.`);

  const target = targetOverride || currentAppPath();
  if (!target) throw new Error('Could not locate the installed CAELIX.app bundle.');

  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'caelix-update-'));
  const dmg = path.join(work, info.assetName || `CAELIX-${info.latest}.dmg`);
  const mount = path.join(work, 'mnt');
  const staged = path.join(work, 'CAELIX.app');
  onProgress?.({ stage: 'download', percent: 0 });

  try {
    await download(info.assetUrl, dmg, onProgress);
    onProgress?.({ stage: 'verify', percent: 0 });

    execFileSync('hdiutil', ['verify', dmg], { stdio: 'pipe' });
    fs.mkdirSync(mount, { recursive: true });
    execFileSync('hdiutil', ['attach', dmg, '-mountpoint', mount, '-nobrowse', '-readonly'], { stdio: 'pipe' });
    try {
      const source = path.join(mount, 'CAELIX.app');
      if (!fs.existsSync(path.join(source, 'Contents', 'MacOS', 'CAELIX'))) {
        throw new Error('The downloaded DMG does not contain CAELIX.app.');
      }
      execFileSync('ditto', [source, staged], { stdio: 'pipe' });
    } finally {
      try { execFileSync('hdiutil', ['detach', mount, '-force'], { stdio: 'pipe' }); } catch { /* best effort */ }
    }

    // Never install a bundle macOS would call damaged.
    execFileSync('codesign', ['--verify', '--deep', '--strict', staged], { stdio: 'pipe' });

    // If the applications folder is not user-writable, keep the image and let
    // the user drag the app across instead of failing silently.
    try {
      fs.accessSync(path.dirname(target), fs.constants.W_OK);
    } catch {
      const help = path.join(os.tmpdir(), 'caelix-update');
      fs.mkdirSync(help, { recursive: true });
      openPath?.(help);
      throw new Error(`New version ${info.latest} downloaded, but ${path.dirname(target)} is not writable. Open the downloaded DMG and drag CAELIX to Applications.`);
    }

    const script = path.join(work, 'apply-update.sh');
    const pending = `${target}.caelix-new`;
    fs.writeFileSync(script, [
      '#!/bin/sh',
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
      `rm -rf ${JSON.stringify(pending)}`,
      `/usr/bin/ditto ${JSON.stringify(staged)} ${JSON.stringify(pending)} || exit 1`,
      `rm -rf ${JSON.stringify(target)} || exit 1`,
      `/bin/mv ${JSON.stringify(pending)} ${JSON.stringify(target)} || exit 1`,
      `/usr/bin/xattr -cr ${JSON.stringify(target)}`,
      relaunch ? `/usr/bin/open ${JSON.stringify(target)}` : 'true',
      `rm -rf ${JSON.stringify(work)}`,
    ].join('\n'), { mode: 0o700 });

    onProgress?.({ stage: 'install', percent: 100 });
    const child = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' });
    child.unref();
    return { started: true, latest: info.latest, target };
  } catch (error) {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
    throw error;
  }
}

module.exports = {
  REPO,
  LATEST_API,
  compareVersions,
  parseRelease,
  check,
  install,
  currentAppPath,
};
