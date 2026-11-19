'use strict';

// Visual preview & geometry auditor using Chromium (Electron BrowserWindow).
// Renders any in-project HTML or SVG file at desktop and mobile viewports,
// measures computed styles/overflow/canvas pixels/SVG bounds/runtime errors,
// and captures a PNG screenshot so vision models (and checks) can actually see
// what the user will see.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

function findElectronBinary() {
  if (process.platform === 'win32') {
    const p = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    if (fs.existsSync(p)) return p;
  } else if (process.platform === 'darwin') {
    const p = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
    if (fs.existsSync(p)) return p;
  } else {
    const p = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const AUDIT_SCRIPT = `(() => {
  const root = document.documentElement;
  const body = document.body || root;
  const bodyStyle = getComputedStyle(body);
  const rootStyle = getComputedStyle(root);
  const parseRgba = (str) => {
    const m = /rgba?\\(\\s*(\\d+(?:\\.\\d+)?)[\\s,]+(\\d+(?:\\.\\d+)?)[\\s,]+(\\d+(?:\\.\\d+)?)(?:[\\s,/]+(\\d+(?:\\.\\d+)?))?/.exec(String(str || ''));
    if (!m) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
  };
  const bodyFontSize = parseFloat(bodyStyle.fontSize) || 16;
  const h1 = document.querySelector('h1, .title, [role="heading"]');
  const h1Size = h1 ? (parseFloat(getComputedStyle(h1).fontSize) || bodyFontSize) : null;
  const headingScale = h1Size ? Number((h1Size / bodyFontSize).toFixed(2)) : null;

  // Inspect actual post-cascade glass panels.
  const glassPanels = [];
  const opaqueGlassPanels = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || '';
    if (!bf || bf === 'none' || !/blur\\(/i.test(bf)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) continue;
    const bg = parseRgba(cs.backgroundColor);
    const alpha = bg ? bg.a : 0;
    const info = {
      tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : ''),
      alpha: Number(alpha.toFixed(2)),
      backdropFilter: bf,
      hasShadow: cs.boxShadow && cs.boxShadow !== 'none',
    };
    if (alpha > 0.72) opaqueGlassPanels.push(info);
    else glassPanels.push(info);
  }

  // Inspect SVG graphics (bounds & child shapes).
  const svgs = [...document.querySelectorAll('svg')].map((svg) => {
    const r = svg.getBoundingClientRect();
    const shapes = svg.querySelectorAll('path,circle,rect,polygon,polyline,ellipse,line,text').length;
    return { width: Math.round(r.width), height: Math.round(r.height), shapes, hasViewBox: svg.hasAttribute('viewBox') };
  });
  const emptySvgs = svgs.filter((s) => s.width === 0 || s.height === 0 || s.shapes === 0).length;

  // Inspect HTML5 <canvas> elements and sample pixels to catch blank canvases.
  const canvases = [...document.querySelectorAll('canvas')].map((cv) => {
    const r = cv.getBoundingClientRect();
    let drawn = null;
    try {
      const ctx = cv.getContext('2d');
      if (ctx && cv.width > 0 && cv.height > 0) {
        const w = Math.min(cv.width, 64);
        const h = Math.min(cv.height, 64);
        const stepX = Math.max(1, Math.floor(cv.width / w));
        const stepY = Math.max(1, Math.floor(cv.height / h));
        const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let first = null;
        let varies = false;
        let nonZeroAlpha = false;
        for (let y = 0; y < cv.height; y += stepY) {
          for (let x = 0; x < cv.width; x += stepX) {
            const idx = (y * cv.width + x) * 4;
            if (data[idx + 3] > 0) nonZeroAlpha = true;
            const sig = (data[idx] << 24) | (data[idx + 1] << 16) | (data[idx + 2] << 8) | data[idx + 3];
            if (first === null) first = sig;
            else if (sig !== first) { varies = true; break; }
          }
          if (varies) break;
        }
        drawn = nonZeroAlpha || varies;
      }
    } catch { drawn = null; }
    return { width: Math.round(r.width), height: Math.round(r.height), attrW: cv.width, attrH: cv.height, drawn };
  });
  const blankCanvases = canvases.filter((c) => c.width === 0 || c.height === 0 || c.drawn === false).length;

  const brokenImages = [...document.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth === 0).length;
  const interactiveCount = [...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"]')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }).length;

  const rootSvgOnly = document.documentElement?.tagName?.toLowerCase() === 'svg';
  const bodyRect = body.getBoundingClientRect();

  return {
    title: document.title || '',
    isStandaloneSvg: rootSvgOnly,
    viewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
    desktopWidth: window.innerWidth,
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    overflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
    docHeight: Math.round(Math.max(bodyRect.height || 0, root.scrollHeight || 0)),
    bodyBg: bodyStyle.backgroundColor,
    bodyBgImage: bodyStyle.backgroundImage !== 'none' ? bodyStyle.backgroundImage.slice(0, 120) : 'none',
    rootBg: rootStyle.backgroundColor,
    bodyColor: bodyStyle.color,
    fontFamily: bodyStyle.fontFamily,
    bodyFontSize,
    h1Size,
    headingScale,
    glassPanels,
    opaqueGlassPanels,
    svgCount: svgs.length,
    emptySvgs,
    canvasCount: canvases.length,
    blankCanvases,
    brokenImages,
    interactiveCount,
  };
})()`;

async function renderInElectron({ file, root, width = 1280, height = 800, capture = true }) {
  const { app, BrowserWindow } = require('electron');
  await app.whenReady();
  const realRoot = root ? path.resolve(root) : path.dirname(file);

  const win = new BrowserWindow({
    show: false,
    focusable: false,
    width,
    height,
    useContentSize: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      partition: `caelix-preview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    },
  });

  const consoleErrors = [];
  try {
    // Keep previews local and fast: prevent external network calls from hanging offline.
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const u = String(details.url || '');
      const allowed = u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')
        || (u.startsWith('file://') && decodeURIComponent(u.slice(7)).startsWith(realRoot));
      callback({ cancel: !allowed });
    });
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('console-message', (event, level, message) => {
      const lvl = typeof event === 'object' ? event.level : (level === 3 ? 'error' : 'info');
      const text = typeof event === 'object' ? event.message : message;
      if (lvl === 'error') consoleErrors.push(String(text || '').slice(0, 240));
    });
    win.webContents.on('render-process-gone', () => {
      consoleErrors.push('Renderer process crashed while previewing.');
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview load timed out after 8s.')), 8000);
      win.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
      win.webContents.once('did-fail-load', (_e, code, desc) => {
        clearTimeout(timer);
        if (code !== -3) reject(new Error(`Failed to load preview (${code}): ${desc}`));
        else resolve();
      });
      win.loadFile(file).catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // Allow initial layout/canvas scripts to settle cleanly (avoid rAF on hidden windows, which Chromium throttles).
    await win.webContents.executeJavaScript('new Promise(r => setTimeout(r, 140))', true);

    const desktop = await win.webContents.executeJavaScript(AUDIT_SCRIPT, true);

    // Check mobile viewport responsiveness cleanly without stealing focus.
    let mobileOverflowPx = 0;
    if (!desktop.isStandaloneSvg) {
      win.setContentSize(390, 844);
      await win.webContents.executeJavaScript('new Promise(r => setTimeout(r, 60))', true);
      mobileOverflowPx = await win.webContents.executeJavaScript(
        'Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)',
        true,
      );
      win.setContentSize(width, height);
      await win.webContents.executeJavaScript('new Promise(r => setTimeout(r, 60))', true);
    }

    let imageDataUrl = null;
    let pngBytes = 0;
    if (capture) {
      let image = await win.webContents.capturePage();
      const size = image.getSize();
      if (size.width > 1280) image = image.resize({ width: 1280 });
      const buf = image.toPNG();
      pngBytes = buf.length;
      imageDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    }

    const issues = [];
    if (consoleErrors.length) issues.push(`Runtime console error(s): ${consoleErrors.slice(0, 3).join(' | ')}`);
    if (desktop.overflowPx > 4) issues.push(`Desktop (${width}px) overflows horizontally by ${desktop.overflowPx}px.`);
    if (!desktop.isStandaloneSvg && mobileOverflowPx > 4) issues.push(`Mobile (390px) overflows horizontally by ${mobileOverflowPx}px.`);
    if (desktop.brokenImages > 0) issues.push(`${desktop.brokenImages} broken <img> element(s) failed to load.`);
    if (desktop.emptySvgs > 0) issues.push(`${desktop.emptySvgs} SVG graphic(s) rendered empty or at 0px size.`);
    if (desktop.blankCanvases > 0) issues.push(`${desktop.blankCanvases} <canvas> element(s) rendered completely blank (no painted pixels or 0px size).`);
    if (desktop.opaqueGlassPanels.length && !desktop.glassPanels.length) {
      const p = desktop.opaqueGlassPanels[0];
      issues.push(`Computed glass panel ${p.tag} has ${Math.round(p.alpha * 100)}% opaque fill with ${p.backdropFilter} — reduce opacity to 0.06–0.32.`);
    }
    if (!desktop.isStandaloneSvg && desktop.headingScale !== null && desktop.headingScale < 1.35) {
      issues.push(`Weak visual hierarchy: heading is only ${desktop.headingScale}x body font size (aim for >= 1.5x).`);
    }
    if (!desktop.isStandaloneSvg && desktop.bodyBg === 'rgba(0, 0, 0, 0)' && desktop.bodyBgImage === 'none'
      && (desktop.rootBg === 'rgba(0, 0, 0, 0)' || desktop.rootBg === 'rgb(255, 255, 255)')
      && /times/i.test(desktop.fontFamily || '')) {
      issues.push('Page rendered with unstyled browser defaults (white backdrop + Times font).');
    }

    return {
      ok: issues.length === 0,
      width,
      height,
      mobileOverflowPx,
      consoleErrors,
      issues,
      metrics: desktop,
      imageDataUrl,
      pngBytes,
    };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function renderViaChildElectron(options) {
  const electronBin = findElectronBinary();
  if (!electronBin) {
    throw new Error('Chromium preview requires Electron (run inside CAELIX desktop or install electron).');
  }
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  const outFile = path.join(os.tmpdir(), `caelix-preview-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
  const payload = Buffer.from(JSON.stringify({ ...options, outFile }), 'utf8').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn(electronBin, [__filename, '--caelix-preview-worker', payload], {
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    const cleanup = () => { try { fs.rmSync(outFile, { force: true }); } catch { /* ignore */ } };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      cleanup();
      reject(new Error('Visual preview worker timed out after 15s.'));
    }, 15000);
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (fs.existsSync(outFile)) {
          const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
          cleanup();
          if (parsed.error) reject(new Error(parsed.error));
          else resolve(parsed);
          return;
        }
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }
      cleanup();
      reject(new Error(`Visual preview failed (exit ${code}): ${stderr.trim().slice(0, 300)}`));
    });
  });
}

async function renderPreview(options = {}) {
  if (!options.file || !fs.existsSync(options.file)) {
    throw new Error(`Preview file does not exist: ${options.file || '(empty)'}`);
  }
  if (process.versions.electron) {
    return renderInElectron(options);
  }
  return renderViaChildElectron(options);
}

if (process.versions.electron && process.argv.includes('--caelix-preview-worker')) {
  const { app } = require('electron');
  app.dock?.hide?.();
  const idx = process.argv.indexOf('--caelix-preview-worker');
  const raw = process.argv[idx + 1] || '';
  let opts = {};
  Promise.resolve()
    .then(async () => {
      opts = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      const res = await renderInElectron(opts);
      if (opts.outFile) fs.writeFileSync(opts.outFile, JSON.stringify(res), 'utf8');
      try { app.exit(0); } catch { process.exit(0); }
    })
    .catch((err) => {
      try {
        if (opts.outFile) fs.writeFileSync(opts.outFile, JSON.stringify({ error: err.message }), 'utf8');
      } catch { /* ignore */ }
      try { app.exit(1); } catch { process.exit(1); }
    });
}

module.exports = { renderPreview, findElectronBinary };

