'use strict';

// CAELIX's built-in browser. A WebContentsView owned by the main process and
// positioned over the renderer's browser panel, so the agent can operate it
// with tools (navigate, read, click, type) while the user watches and can
// drive it themselves. Only http/https pages are allowed; file:// and other
// schemes are refused so the browser can never become a filesystem door.

const { WebContentsView } = require('electron');

const MAX_TEXT = 12_000;

function assertHttpUrl(raw) {
  let text = String(raw || '').trim();
  if (!text) throw new Error('Enter a URL first.');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    const local = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(text);
    text = `${local ? 'http' : 'https'}://${text}`;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`That is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) pages can be opened in the browser.');
  }
  return url.toString();
}

// Page-context script: outline the page for the agent — readable text,
// links and interactive elements with stable CSS selectors.
const READ_SCRIPT = `(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const sel = (el) => {
    if (el.id) return '#' + el.id;
    const name = el.tagName.toLowerCase();
    if (el.name) return name + '[name="' + el.name + '"]';
    if (el.getAttribute('aria-label')) return name + '[aria-label="' + el.getAttribute('aria-label').slice(0, 40) + '"]';
    const cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\\s+/)[0] : '';
    return cls ? name + '.' + cls : name;
  };
  const text = (document.body && document.body.innerText ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, ${MAX_TEXT});
  const links = [...document.querySelectorAll('a[href]')].filter(vis).slice(0, 40)
    .map((a) => ({ text: (a.innerText || '').trim().slice(0, 80), href: a.href.slice(0, 300) }))
    .filter((l) => l.text || l.href);
  const inputs = [...document.querySelectorAll('input, textarea, select, button')].filter(vis).slice(0, 30)
    .map((el, i) => ({
      n: i,
      tag: el.tagName.toLowerCase(),
      selector: sel(el),
      type: el.type || '',
      placeholder: el.placeholder || '',
      label: (el.labels && el.labels[0] ? el.labels[0].innerText : (el.innerText || '')).trim().slice(0, 60),
      value: (el.value || '').slice(0, 60),
    }));
  return { title: document.title, url: location.href, text, links, inputs };
})()`;

class BrowserPanel {
  constructor(win, emit) {
    this.win = win;
    this.emit = emit || (() => {});
    this.visible = false;
    this.bounds = null;
    this.history = [];
    this.cursor = -1;
    this.pendingUrl = '';
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    this.view.setBackgroundColor('#0b0d10');
    const wc = this.view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      // New-window attempts stay in this panel when possible.
      try { wc.loadURL(assertHttpUrl(url)); } catch { /* blocked */ }
      return { action: 'deny' };
    });
    wc.on('did-navigate', (_e, url) => this.track(url));
    wc.on('did-navigate-in-page', (_e, url) => this.track(url));
    wc.on('did-start-loading', () => this.notify({ loading: true }));
    wc.on('did-stop-loading', () => this.notify({ loading: false }));
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (isMain) this.notify({ error: `${desc || 'Load failed'} (${code})`, url });
    });
  }

  notify(detail) {
    this.emit({ type: 'browser-state', ...this.state(), ...detail });
  }

  state() {
    const wc = this.view.webContents;
    return {
      visible: this.visible,
      url: wc.getURL() || this.pendingUrl || '',
      title: wc.getTitle(),
      canBack: wc.navigationHistory.canGoBack(),
      canForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    };
  }

  track(url) {
    if (this.history[this.cursor] !== url) {
      this.history = this.history.slice(0, this.cursor + 1);
      this.history.push(url);
      this.cursor = this.history.length - 1;
    }
    this.notify({});
  }

  setBounds(rect) {
    if (!rect || !Number.isFinite(rect.x)) return;
    const next = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    const prev = this.bounds;
    if (prev && prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height) {
      return;
    }
    this.bounds = next;
    if (this.visible) this.applyBounds();
  }

  applyBounds() {
    if (this.bounds) this.view.setBounds(this.bounds);
  }

  show() {
    let changed = false;
    if (!this.visible) {
      this.win.contentView.addChildView(this.view);
      this.visible = true;
      this.applyBounds();
      changed = true;
    }
    if (changed) this.notify({});
    return this.state();
  }

  hide() {
    if (!this.visible) return this.state();
    this.win.contentView.removeChildView(this.view);
    this.visible = false;
    this.notify({});
    return this.state();
  }

  async navigate(rawUrl) {
    const url = assertHttpUrl(rawUrl);
    this.pendingUrl = url;
    this.show();
    try {
      await this.view.webContents.loadURL(url);
    } finally {
      this.pendingUrl = '';
    }
    return this.state();
  }

  back() {
    const wc = this.view.webContents;
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    return this.state();
  }

  forward() {
    const wc = this.view.webContents;
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    return this.state();
  }

  reload() {
    if (!this.view.webContents.getURL()) return this.state();
    this.view.webContents.reload();
    return this.state();
  }

  requireOpen() {
    if (!this.visible || !this.view.webContents.getURL()) {
      throw new Error('No page is open. Use browser_navigate first (the browser panel appears when you do).');
    }
  }

  // Read-only: always allowed, in every mode.
  async read() {
    this.requireOpen();
    const data = await this.view.webContents.executeJavaScript(READ_SCRIPT, true);
    return {
      output: [
        `Title: ${data.title}`,
        `URL: ${data.url}`,
        '',
        data.text || '(empty page)',
        '',
        data.links.length ? `Links:\n${data.links.map((l) => `- ${l.text} -> ${l.href}`).join('\n')}` : 'Links: none',
        data.inputs.length ? `Interactive elements:\n${data.inputs.map((i) => `- [${i.n}] <${i.tag}${i.type ? ' type=' + i.type : ''}> selector=${i.selector}${i.placeholder ? ' placeholder=' + JSON.stringify(i.placeholder) : ''}${i.label ? ' label=' + JSON.stringify(i.label) : ''}${i.value ? ' value=' + JSON.stringify(i.value) : ''}`).join('\n')}` : 'Interactive elements: none',
      ].join('\n'),
      meta: { title: data.title, url: data.url, inputs: data.inputs },
    };
  }

  async click(selector) {
    this.requireOpen();
    const target = String(selector || '').trim();
    if (!target) throw new Error('Give a CSS selector to click.');
    const script = `(() => {
      const el = document.querySelector(${JSON.stringify(target)});
      if (!el) return { ok: false, error: 'no element matches ' + ${JSON.stringify(target)} };
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { ok: true, tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || '').slice(0, 80) };
    })()`;
    const result = await this.view.webContents.executeJavaScript(script, true);
    if (!result?.ok) throw new Error(result?.error || 'Click failed.');
    await new Promise((r) => setTimeout(r, 400)); // let the page react
    return {
      output: `Clicked <${result.tag}> "${result.text}". The page may have changed; use browser_read to see the new state.`,
      meta: { clicked: target },
    };
  }

  async type(input) {
    this.requireOpen();
    const target = String(input.selector || '').trim();
    const text = String(input.text ?? '');
    if (!target) throw new Error('Give a CSS selector to type into.');
    const script = `(() => {
      const el = document.querySelector(${JSON.stringify(target)});
      if (!el) return { ok: false, error: 'no element matches ' + ${JSON.stringify(target)} };
      el.focus();
      const value = ${JSON.stringify(text)};
      if (el.isContentEditable) {
        el.textContent = value;
      } else {
        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
        const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: String(el.value || el.textContent || '').slice(0, 80) };
    })()`;
    const result = await this.view.webContents.executeJavaScript(script, true);
    if (!result?.ok) throw new Error(result?.error || 'Type failed.');
    return {
      output: `Typed into <${target}> — value now "${result.value}".`,
      meta: { typed: target },
    };
  }

  dispose() {
    try { this.hide(); } catch { /* window closing */ }
    try { this.view.webContents.close(); } catch { /* already closed */ }
  }
}

module.exports = { BrowserPanel };
