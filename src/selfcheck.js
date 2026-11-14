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
    app, win, engine, sessions, startedAt, getWindowReadyMs, getFirstPaintMs, getLastError, checksDir, workspace,
  } = context;

  await fsp.mkdir(checksDir, { recursive: true });
  await fsp.mkdir(workspace, { recursive: true });

  const steps = [];
  const errors = [];
  const consoleErrors = [];
  const screenshots = [];
  const runStarted = Date.now();
  const screenshotPath = path.join(checksDir, 'selfcheck.png');
  const stepsDir = path.join(checksDir, 'steps');
  const reportPath = path.join(checksDir, 'selfcheck.json');
  await fsp.mkdir(stepsDir, { recursive: true });

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

  async function snap(label) {
    try {
      const image = await win.webContents.capturePage();
      const png = image.toPNG();
      const safe = label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
      const file = path.join(stepsDir, `${String(screenshots.length + 1).padStart(2, '0')}-${safe}.png`);
      await fsp.writeFile(file, png);
      screenshots.push({ label, path: path.relative(path.join(checksDir, '..'), file), bytes: png.length });
      return true;
    } catch (error) {
      errors.push({ kind: 'step-screenshot', label, message: error.message });
      return false;
    }
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
    const stepScreenshotsOk = screenshots.length >= 6 && screenshots.every((item) => item.bytes > 10000);
    const pass = !forceFail && allStepsOk && allErrors.length === 0 && fileExists && performanceOk && screenshotOk && stepScreenshotsOk;

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
      screenshots,
      stepScreenshotsOk,
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
    await snap('empty state');

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
    await snap('keys screen');

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
    await snap('streaming reply');

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
    await snap('changes after permission');

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

    await step('open a second terminal tab and keep its shell state', async () => {
      await click('#terminal-new');
      await waitFor('document.querySelectorAll(".terminal-tab").length === 2', 5000, 'second terminal');
      const title = await evaluate('document.querySelector(".terminal-tab.active .terminal-tab-name")?.textContent || ""');
      if (title !== 'Terminal 2') throw new Error(`The new tab is not active (${title}).`);
      await setValue('#terminal-cmd', 'cd /tmp');
      await click('#terminal-run');
      await waitFor('window.__caelixState.terminalTabs.length === 2', 5000, 'two tabs loaded');
      await sleep(300);
      await setValue('#terminal-cmd', 'pwd');
      await click('#terminal-run');
      await waitFor('document.querySelector("#terminal").textContent.includes("/tmp")', 10000, 'shell state kept');
      await click('.terminal-tab.active .terminal-tab-close');
      await waitFor('document.querySelectorAll(".terminal-tab").length === 1', 5000, 'one terminal after close');
      return 'second tab kept its cd and was closed';
    });
    await snap('terminal');

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
    await snap('renamed and mode');

    await step('multi-edit, a question and a plan through the real tools', async () => {
      await setValue('#prompt', 'Show a multi-edit, ask me one question, and present a plan.');
      await click('#send-btn');
      await waitFor('document.querySelector("#question-card")', 12000, 'question card');
      await click('#question-card [data-answer="Streaming check"]');
      await waitFor('document.querySelector(".question-answer")', 5000, 'question answer');
      await waitFor('document.querySelector(".plan-card")', 12000, 'plan card');
      await waitFor('window.__caelixState.streaming === false', 20000, 'tools turn complete');
      const note = await fsp.readFile(path.join(workspace, 'caelix-note.md'), 'utf8');
      if (!note.includes('Multi-edit: applied through the real tool')) throw new Error('multi_edit did not change the note.');
      const diffs = await evaluate('document.querySelectorAll(".change-item").length');
      if (diffs < 1) throw new Error('The changes panel is empty.');
      return 'multi-edit applied, question answered, plan shown';
    });
    await snap('question and plan');

    await step('background task starts, lists and stops', async () => {
      const { ToolRunner, TaskRegistry } = require('./engine/tools');
      const registry = new TaskRegistry(path.join(checksDir, 'tasks'));
      const runner = new ToolRunner({
        root: workspace, mode: 'bypass', ask: async () => 'allow', tasks: registry,
      });
      const started = await runner.execute('task_start', { command: 'echo caelix-task-ok; sleep 2', label: 'check' });
      await sleep(500);
      const listed = await runner.execute('task_list', {});
      if (!String(listed.output).includes('caelix-task-ok')) throw new Error('Task output is missing from the list.');
      const stopped = await runner.execute('task_stop', { id: started.meta.taskId });
      if (!String(stopped.output).includes('Stopped')) throw new Error('The task did not stop.');
      return 'task started, listed and stopped';
    });

    await step('memory saves and reaches the system prompt', async () => {
      await click('#memory-btn');
      await waitFor('!document.querySelector("#memory-screen").classList.contains("hidden")', 5000, 'memory screen');
      await setValue('#memory-file', 'CAELIX.md');
      await sleep(500);
      await setValue('#memory-text', '# CAELIX check\n\n- Memory marker: caelix-memory-ok\n- When asked, reply with the marker.\n');
      await click('#memory-save');
      await waitFor('document.querySelector("#memory-status").textContent.includes("bytes loaded")', 6000, 'memory saved');
      const text = await fsp.readFile(path.join(workspace, 'CAELIX.md'), 'utf8');
      if (!text.includes('caelix-memory-ok')) throw new Error('The memory file was not written.');
      const prompt = engine.systemPrompt({ cwd: workspace, mode: 'ask', messages: [] });
      if (!prompt.includes('caelix-memory-ok')) throw new Error('The memory marker is missing from the system prompt.');
      return 'CAELIX.md saved and present in the system prompt';
    });
    await snap('memory editor');
    await click('#memory-close');

    await step('context report counts the whole turn', async () => {
      await click('[data-tab="context"]');
      await waitFor('document.querySelector("#context-view") && !document.querySelector("#context-view").classList.contains("hidden")', 5000, 'context view');
      const active = await evaluate('document.querySelector(".panel-tab.active")?.dataset.tab || null');
      if (active !== 'context') throw new Error(`The Context tab did not activate (${active}).`);
      await waitFor('document.querySelector("#context-report .context-number")', 5000, 'context report');
      const report = await evaluate('window.__caelixState.contextReport');
      if (!report || !(report.total > 0)) throw new Error('The context report is empty.');
      if (!(report.messages > 0)) throw new Error('The context report counted no messages.');
      return `${report.total} tokens across ${report.messages} messages`;
    });
    await sleep(250);
    await snap('context report');

    await step('restore a checkpoint', async () => {
      await click('[data-tab="changes"]');
      const rows = await evaluate('document.querySelectorAll(".checkpoint-item").length');
      if (!rows) throw new Error('No checkpoint rows are shown.');
      const noteFile = path.join(workspace, 'caelix-note.md');
      const before = await fsp.readFile(noteFile, 'utf8');
      if (!before.includes('Multi-edit: applied through the real tool')) throw new Error('The multi-edit was not in the note before restoring.');
      await click('.checkpoint-item .checkpoint-restore');
      await waitFor('document.querySelector(".checkpoint-item .checkpoint-restore.armed")', 3000, 'restore armed');
      await click('.checkpoint-item .checkpoint-restore');
      await sleep(900);
      const after = await fsp.readFile(noteFile, 'utf8');
      if (after.includes('Multi-edit: applied through the real tool')) throw new Error('The checkpoint did not restore the note.');
      if (!after.includes('# CAELIX self-check')) throw new Error('The restored note lost its original content.');
      return `${rows} checkpoint(s); the newest restored the note`;
    });
    await sleep(200);
    await snap('checkpoint restore');

    await step('protected paths refuse a bypass write', async () => {
      const { ToolRunner } = require('./engine/tools');
      const runner = new ToolRunner({ root: workspace, mode: 'bypass', ask: async () => 'deny' });
      let refused = false;
      try {
        await runner.execute('write_file', { path: '.git/config', content: 'refused' });
      } catch (error) {
        refused = /denied|permission/i.test(error.message);
      }
      if (!refused) throw new Error('A bypass write to .git was not refused.');
      return 'bypass write to .git asked first and was refused';
    });

    await step('delete a chat inline', async () => {
      await click('#new-chat');
      await waitFor('window.__caelixState.sessions.length > 1', 5000, 'second chat');
      const before = await evaluate('document.querySelectorAll(".session-item").length');
      await click('.session-item.active .session-delete');
      await waitFor('document.querySelector(".session-item.active .session-delete.armed")', 3000, 'delete armed');
      await click('.session-item.active .session-delete');
      await sleep(800);
      const after = await evaluate('document.querySelectorAll(".session-item").length');
      if (after >= before) throw new Error('The chat was not deleted from the sidebar.');
      return `chat deleted (${before} → ${after})`;
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
    await snap('restored after reload');
  } catch (error) {
    errors.push({ kind: 'outer', message: error.message, stack: error.stack });
  }

  await finish(false);
}

module.exports = { run };
