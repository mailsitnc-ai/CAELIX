'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function quote(value) {
  return JSON.stringify(value);
}

async function run(context) {
  const {
    app, win, startedAt, getWindowReadyMs, getFirstPaintMs, getLastError, checksDir, workspace,
  } = context;

  await fsp.mkdir(checksDir, { recursive: true });
  await fsp.mkdir(workspace, { recursive: true });

  const steps = [];
  const errors = [];
  const consoleErrors = [];
  const runStarted = Date.now();
  const screenshotPath = path.join(checksDir, 'selfcheck.png');
  const reportPath = path.join(checksDir, 'selfcheck.json');

  win.webContents.on('console-message', (event, level, message, line, source) => {
    const modern = typeof event === 'object' && typeof event.level === 'string';
    const name = modern ? event.level : ({ 0: 'debug', 1: 'info', 2: 'warning', 3: 'error' }[level] || 'info');
    const text = modern ? event.message : message;
    if (name === 'error') {
      consoleErrors.push({
        level: name,
        message: text,
        line: modern ? event.lineNumber : line,
        source: modern ? event.sourceId : source,
        at: Date.now(),
      });
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    errors.push({ kind: 'render-process-gone', message: JSON.stringify(details) });
  });

  const evaluate = (code) => win.webContents.executeJavaScript(code, true);

  async function waitFor(expression, timeout = 15000, label = 'condition') {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try {
        const value = await evaluate(expression);
        if (value) return value;
      } catch (error) {
        errors.push({ kind: 'wait-error', label, message: error.message });
      }
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  async function click(selector) {
    const ok = await evaluate(`(() => { const el = document.querySelector(${quote(selector)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`Could not click ${selector}`);
  }

  async function setValue(selector, value) {
    const ok = await evaluate(`(() => {
      const el = document.querySelector(${quote(selector)});
      if (!el) return false;
      el.focus();
      el.value = ${quote(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`Could not fill ${selector}`);
  }

  async function step(name, fn) {
    const started = Date.now();
    try {
      const detail = await fn();
      steps.push({ name, ok: true, ms: Date.now() - started, detail: detail || null });
      console.log(`  ✓ ${name}`);
    } catch (error) {
      steps.push({ name, ok: false, ms: Date.now() - started, detail: error.message });
      errors.push({ kind: 'step', step: name, message: error.message, stack: error.stack });
      console.log(`  ✗ ${name}: ${error.message}`);
    }
  }

  const guard = setTimeout(async () => {
    errors.push({ kind: 'timeout', message: 'Self-check exceeded 120 seconds.' });
    await finish(false, 'Self-check timed out.');
  }, 120000);

  let finished = false;

  async function finish(forceFail, reason) {
    if (finished) return;
    finished = true;
    clearTimeout(guard);

    let screenshot = null;
    try {
      win.show();
      win.focus();
      win.moveTop();
      win.setAlwaysOnTop(true, 'floating');
      app.focus({ steal: true });
      await sleep(700);
      const image = await win.webContents.capturePage();
      const png = image.toPNG();
      await fsp.writeFile(screenshotPath, png);
      win.setAlwaysOnTop(false);
      screenshot = { path: 'checks/selfcheck.png', bytes: png.length };
    } catch (error) {
      errors.push({ kind: 'screenshot', message: error.message });
    }

    let pageErrors = [];
    try {
      pageErrors = await evaluate('window.__caelixErrors || []');
    } catch {
      pageErrors = [];
    }

    const metrics = app.getAppMetrics();
    const memory = metrics.reduce((total, metric) => {
      const mem = metric.memory || {};
      total.workingSetKB += mem.workingSetSize || 0;
      total.privateKB += mem.privateBytes || 0;
      return total;
    }, { workingSetKB: 0, privateKB: 0 });

    const windowReadyMs = getWindowReadyMs();
    const firstPaintMs = getFirstPaintMs();
    const allStepsOk = steps.length > 0 && steps.every((item) => item.ok);
    const allErrors = [...errors, ...pageErrors, ...consoleErrors, ...(getLastError() ? [getLastError()] : [])];
    const filePath = path.join(workspace, 'caelix-note.md');
    const fileExists = fs.existsSync(filePath);
    const performanceOk = windowReadyMs !== null && windowReadyMs < 2000 && firstPaintMs !== null && firstPaintMs < 2000;
    const screenshotOk = Boolean(screenshot && screenshot.bytes > 10000);
    const pass = !forceFail && allStepsOk && allErrors.length === 0 && fileExists && performanceOk && screenshotOk;

    const report = {
      app: 'CAELIX',
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      totalMs: Date.now() - runStarted,
      windowOpenMs: windowReadyMs,
      firstPaintMs,
      performanceBudgetMs: 2000,
      performanceOk,
      steps,
      errors: allErrors,
      screenshot,
      screenshotOk,
      fileCheck: { path: path.relative(path.join(checksDir, '..'), filePath), exists: fileExists },
      memory,
      pass,
      reason: reason || null,
    };

    await fsp.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log('');
    console.log(pass ? 'SELFCHECK PASS' : 'SELFCHECK FAIL');
    console.log(`  window ${windowReadyMs} ms · first paint ${firstPaintMs} ms · memory ${Math.round(memory.workingSetKB / 1024)} MB`);
    if (!pass) {
      for (const item of allErrors) console.log(`  error: ${item.step || item.kind}: ${item.message}`);
      if (!fileExists) console.log('  error: the note file was not written');
      if (!performanceOk) console.log('  error: performance budget missed');
      if (!screenshotOk) console.log('  error: screenshot missing or too small');
    }
    await sleep(120);
    app.exit(pass ? 0 : 1);
  }

  try {
    await step('window and renderer ready', async () => {
      await waitFor('window.__caelixReady === true', 15000, 'renderer ready');
      const info = await evaluate('window.__caelixState.info');
      return `${info.name} ${info.version}`;
    });

    await step('encrypted key save, mask and delete', async () => {
      await click('#keys-btn');
      await waitFor('!document.querySelector("#keys-screen").classList.contains("hidden")', 4000, 'keys screen');
      await setValue('#key-input-openrouter', 'sk-or-selfcheck-not-real');
      await click('#key-save-openrouter');
      await waitFor('document.querySelector("#key-status-openrouter")?.textContent.startsWith("Saved")', 6000, 'saved mask');
      const detail = await evaluate(`(() => {
        const input = document.querySelector('#key-input-openrouter');
        const status = document.querySelector('#key-status-openrouter').textContent;
        return { status, inputType: input.type, inputValue: input.value };
      })()`);
      if (detail.inputType !== 'password') throw new Error('Key input is not masked.');
      if (detail.inputValue !== '') throw new Error('Key input still holds the value after save.');
      if (!detail.status.includes('\u2022')) throw new Error('Saved key is not shown as a mask.');
      await waitFor('document.querySelector("#key-delete-openrouter")', 4000, 'delete button');
      await click('#key-delete-openrouter');
      await waitFor('document.querySelector("#key-status-openrouter")?.textContent === "Not saved"', 5000, 'key deleted');
      await click('#keys-close');
      return detail.status;
    });

    await step('choose the keyless simulator model', async () => {
      await click('#model-chip');
      await waitFor('!document.querySelector("#model-menu").classList.contains("hidden")', 4000, 'model menu');
      await click('[data-provider="simulator"][data-model="sim-1"]');
      await waitFor('document.querySelector("#model-chip").textContent === "sim-1"', 5000, 'simulator model');
      return 'sim-1';
    });

    await step('create a chat in the test folder', async () => {
      await click('#new-chat');
      await waitFor('document.querySelector("#chat-title").textContent === "New chat"', 5000, 'new chat');
      const cwd = await evaluate('window.__caelixState.session.cwd');
      if (cwd !== workspace) throw new Error(`Unexpected folder: ${cwd}`);
      return cwd;
    });

    await step('stream a reply word by word', async () => {
      await setValue('#prompt', 'Create a note and show me the harness working.');
      const sent = Date.now();
      await click('#send-btn');
      await waitFor('document.querySelector(".msg.assistant .md")?.textContent.trim().length > 3', 12000, 'first streamed words');
      const firstWordMs = Date.now() - sent;
      if (firstWordMs > 4000) throw new Error(`First words took ${firstWordMs} ms`);
      return `${firstWordMs} ms to first words`;
    });

    await step('answer a permission card and write a real file', async () => {
      await waitFor('document.querySelector("#permission-allow")', 12000, 'permission card');
      await click('#permission-allow');
      await waitFor('document.querySelectorAll(".change-item").length > 0', 12000, 'change entry');
      for (let i = 0; i < 50; i += 1) {
        if (fs.existsSync(path.join(workspace, 'caelix-note.md'))) break;
        await sleep(100);
      }
      if (!fs.existsSync(path.join(workspace, 'caelix-note.md'))) throw new Error('The note file was not written.');
      const content = await fsp.readFile(path.join(workspace, 'caelix-note.md'), 'utf8');
      if (!content.includes('CAELIX self-check')) throw new Error('The note content is wrong.');
      return 'caelix-note.md written and shown in Changes';
    });

    await step('finish the streamed turn', async () => {
      await waitFor('window.__caelixState.streaming === false', 20000, 'turn complete');
      const count = await evaluate('document.querySelectorAll(".msg.assistant").length');
      if (count < 1) throw new Error('No assistant message rendered.');
      return `${count} assistant message(s)`;
    });

    await step('run a command in the terminal panel', async () => {
      await click('[data-tab="terminal"]');
      await waitFor('!document.querySelector("#terminal-view").classList.contains("hidden")', 3000, 'terminal tab');
      await setValue('#terminal-cmd', 'echo caelix-terminal-ok');
      await click('#terminal-run');
      await waitFor('document.querySelector("#terminal").textContent.includes("caelix-terminal-ok")', 10000, 'terminal output');
      return 'terminal echoed caelix-terminal-ok';
    });

    await step('rename the chat and switch mode', async () => {
      await click('#chat-title-btn');
      await waitFor('!document.querySelector("#title-input").classList.contains("hidden")', 3000, 'title editor');
      await setValue('#title-input', 'CAELIX self-check chat');
      await evaluate('document.querySelector("#title-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))');
      await waitFor('document.querySelector("#chat-title").textContent === "CAELIX self-check chat"', 5000, 'renamed title');
      await click('#mode-chip');
      await waitFor('!document.querySelector("#mode-menu").classList.contains("hidden")', 3000, 'mode menu');
      await click('[data-mode="plan"]');
      await waitFor('document.querySelector("#mode-chip").textContent === "Plan"', 4000, 'plan mode');
      await click('#mode-chip');
      await waitFor('!document.querySelector("#mode-menu").classList.contains("hidden")', 3000, 'mode menu again');
      await click('[data-mode="accept"]');
      await waitFor('document.querySelector("#mode-chip").textContent === "Accept edits"', 4000, 'accept mode');
      return 'renamed and modes switched';
    });

    await step('collapse and restore the right panel', async () => {
      await click('#panel-toggle');
      await waitFor('document.querySelector("#panel").offsetWidth === 0', 3000, 'panel collapsed');
      await click('#panel-toggle');
      await waitFor('document.querySelector("#panel").offsetWidth > 300', 3000, 'panel restored');
      await click('[data-tab="changes"]');
      return 'panel collapsed and restored';
    });

    await step('restart the window and find the chat again', async () => {
      await sleep(400);
      win.webContents.reload();
      await waitFor('window.__caelixReady === true', 15000, 'renderer after reload');
      await waitFor('document.querySelector("#chat-title").textContent === "CAELIX self-check chat"', 8000, 'restored title');
      const messages = await evaluate('document.querySelectorAll(".msg").length');
      if (messages < 2) throw new Error('The conversation did not come back after reload.');
      return `${messages} messages restored`;
    });
  } catch (error) {
    errors.push({ kind: 'outer', message: error.message, stack: error.stack });
  }

  await finish(false);
}

module.exports = { run };
