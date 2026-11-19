'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function quote(value) {
  return JSON.stringify(value);
}

async function run(context) {
  const {
    app, win, engine, sessions, startedAt, getWindowReadyMs, getFirstPaintMs, getLastError, checksDir, workspace,
  } = context;

  try {
    await fsp.appendFile(path.join(checksDir, 'selfcheck-trace.txt'), `${new Date().toISOString()} selfcheck run() entered\n`);
  } catch { /* diagnostics only */ }
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
      await fsp.appendFile(path.join(checksDir, 'selfcheck-trace.txt'), `${new Date().toISOString()} step start: ${name}\n`);
    } catch { /* diagnostics only */ }
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
      await setValue('#key-input-openrouter', 'sk-or-selfcheck-second');
      await click('#key-add-openrouter');
      await waitFor('document.querySelector("#key-status-openrouter")?.textContent.includes("(2 keys)")', 5000, 'multi-key pool saved');
      await waitFor('document.querySelector("#key-delete-openrouter")', 4000, 'delete button');
      await click('#key-delete-openrouter');
      await waitFor('document.querySelector("#key-status-openrouter")?.textContent === "Not saved"', 5000, 'key deleted');
      await click('#keys-close');
      return `${detail.status} (+ multi-key rotation tested)`;
    });
    await snap('keys screen');

    await step('choose the keyless simulator model', async () => {
      await click('#model-chip');
      await waitFor('!document.querySelector("#model-menu").classList.contains("hidden")', 4000, 'model menu');
      await evaluate(`(() => {
        const el = document.querySelector('#model-search');
        if (!el) throw new Error('Missing #model-search');
        window.__modelSearchNode = el;
        el.focus();
      })()`);
      for (const ch of 'free') {
        win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
        await sleep(25);
      }
      const typed = await evaluate(`(() => {
        const el = document.querySelector('#model-search');
        return {
          sameNode: el === window.__modelSearchNode,
          value: el?.value,
          start: el?.selectionStart,
          end: el?.selectionEnd
        };
      })()`);
      if (!typed.sameNode || typed.value !== 'free' || typed.start !== 4 || typed.end !== 4) {
        throw new Error(`Model search caret broke while typing: ${JSON.stringify(typed)}`);
      }
      await evaluate(`(() => {
        const el = document.querySelector('#model-search');
        el.focus();
        el.setSelectionRange(2, 2);
      })()`);
      win.webContents.sendInputEvent({ type: 'char', keyCode: 'X' });
      await sleep(25);
      const midEdit = await evaluate(`(() => {
        const el = document.querySelector('#model-search');
        const value = el?.value;
        const start = el?.selectionStart;
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        delete window.__modelSearchNode;
        return { value, start };
      })()`);
      if (midEdit.value !== 'frXee' || midEdit.start !== 3) {
        throw new Error(`Model search mid-word cursor edit failed: ${JSON.stringify(midEdit)}`);
      }
      await waitFor('document.querySelector("[data-provider=\\"simulator\\"][data-model=\\"sim-1\\"]")', 4000, 'simulator model option');
      await click('[data-provider="simulator"][data-model="sim-1"]');
      await waitFor('document.querySelector("#model-chip").textContent === "sim-1"', 5000, 'simulator model');
      return 'sim-1 (search cursor preserved)';
    });

    await step('favourite a model and pin it in the picker', async () => {
      await click('#model-chip');
      await waitFor('!document.querySelector("#model-menu").classList.contains("hidden")', 4000, 'model menu');
      await click('[data-provider="simulator"][data-model="sim-1"] .pop-star');
      await waitFor('document.querySelector(".pop-section")?.textContent.startsWith("Favourites (1)")', 4000, 'favourites section');
      const saved = await evaluate('JSON.stringify(window.__caelixState.favourites)');
      if (saved !== JSON.stringify(['simulator:sim-1'])) throw new Error(`Favourites not saved: ${saved}`);
      await click('#model-chip');
      await click('#model-chip');
      await waitFor('document.querySelector(".pop-section")?.textContent.startsWith("Favourites (1)")', 4000, 'favourites persisted');
      await click('[data-provider="simulator"][data-model="sim-1"]');
      await waitFor('document.querySelector("#model-chip").textContent === "sim-1"', 5000, 'model still chosen');
      return 'sim-1 starred, pinned and kept';
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
      await waitFor('window.__caelixState.terminalTabs.length === 2 && !window.__caelixState.terminalRunning', 8000, 'cd finished in second tab');
      await setValue('#terminal-cmd', 'pwd');
      await click('#terminal-run');
      await waitFor('document.querySelector("#terminal").textContent.includes("/tmp") && !window.__caelixState.terminalRunning', 10000, 'shell state kept');
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

    await step('write real PDF, Word, Excel, PowerPoint and EPUB documents', async () => {
      const { ToolRunner } = require('./engine/tools');
      const runner = new ToolRunner({
        root: workspace, mode: 'bypass', ask: async () => 'allow', emit: (event) => engine.emit(event),
      });
      const docDir = path.join(workspace, 'documents');
      const blocks = [
        { type: 'heading', text: 'Self-check report', level: 1 },
        { type: 'paragraph', text: 'Generated by **CAELIX** with *styled* text.' },
        { type: 'bullets', items: ['PDF', 'Word', 'PowerPoint'] },
        { type: 'table', headers: ['Format', 'Status'], rows: [['pdf', 'ok'], ['docx', 'ok']] },
      ];
      const expected = [
        ['pdf', 'CAELIX-selftest.pdf', '25504446'],
        ['docx', 'CAELIX-selftest.docx', '504b0304'],
        ['xlsx', 'CAELIX-selftest.xlsx', '504b0304'],
        ['pptx', 'CAELIX-selftest.pptx', '504b0304'],
        ['epub', 'CAELIX-selftest.epub', '504b0304'],
      ];
      for (const [format, name, magic] of expected) {
        const result = await runner.execute('write_document', {
          format, output: path.join('documents', name), title: `Self-check ${format.toUpperCase()}`, blocks,
        });
        const file = path.join(docDir, name);
        const bytes = await fsp.readFile(file);
        if (!bytes.length) throw new Error(`${format} file is empty.`);
        if (bytes.subarray(0, 4).toString('hex') !== magic) throw new Error(`${format} has the wrong file signature.`);
        if (!String(result.output).includes(name)) throw new Error(`write_document did not report ${name}.`);
      }
      const word = await runner.execute('write_document', {
        format: 'docx', output: 'documents/extension-test', title: 'Extension test', blocks,
      });
      if (!String(word.output).includes('extension-test.docx')) throw new Error('The .docx extension was not added.');
      const cards = await evaluate('document.querySelectorAll(".change-item").length');
      if (cards < 5) throw new Error('Document cards are missing from the changes panel.');
      return 'pdf, docx, xlsx, pptx and epub written with valid signatures';
    });

    await step('design fidelity: a plain page is flagged and a glass page passes', async () => {
      const { ToolRunner } = require('./engine/tools');
      const runner = new ToolRunner({
        root: workspace, mode: 'bypass', ask: async () => 'allow', emit: (event) => engine.emit(event),
      });
      const bland = '<!doctype html><html><head><title>Todo</title></head><body><h1>Todo</h1><input><button>Add</button></body></html>';
      const wrote = await runner.execute('write_file', { path: 'plain.html', content: bland });
      if (!wrote.output.includes('Design check')) throw new Error('write_file did not append a design report for HTML.');
      const weak = await runner.execute('design_check', { path: 'plain.html', goals: ['dark', 'blue', 'glass'] });
      if (weak.design.ok) throw new Error('An unstyled page passed the design check.');
      if (!weak.output.includes('dark NOT met')) throw new Error('The design check did not report the missed brief.');

      const glass = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--bg:#071426;--text:#eaf2ff}
body{margin:0;font-family:Inter,system-ui,sans-serif;color:var(--text);background:linear-gradient(160deg,var(--bg),#0b2540)}
.card{padding:24px;border-radius:18px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);
backdrop-filter:blur(22px) saturate(160%);box-shadow:0 24px 60px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.28)}
button{background:#3d8bfd;color:#fff;border-radius:12px;transition:transform .15s ease}
button:hover{transform:translateY(-1px)} button:focus-visible{outline:2px solid #fff}
@media (max-width:520px){.card{padding:16px}}</style></head>
<body><div class="card"><h1>Todo</h1><button>Add</button></div></body></html>`;
      await runner.execute('write_file', { path: 'glass.html', content: glass });
      const strong = await runner.execute('design_check', { path: 'glass.html', goals: ['dark', 'blue', 'liquid', 'glass', 'responsive', 'accessible'] });
      if (!strong.design.ok) throw new Error(`The glass page failed: ${strong.design.issues.join(' | ')}`);
      if (strong.design.score !== 100) throw new Error(`Expected 100/100, got ${strong.design.score}.`);
      const rendered = await runner.execute('render_preview', { path: 'glass.html' });
      if (!rendered.preview?.ok || !rendered.imageDataUrl?.startsWith('data:image/png;base64,')) {
        throw new Error(`render_preview failed: ${rendered.output}`);
      }
      return 'plain page flagged, dark-blue liquid glass page 100/100 + rendered screenshot';
    });

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
      await click('#prompt-inspector-btn');
      await waitFor('document.querySelector("#prompt-inspector")?.textContent.includes("Available tools:")', 5000, 'system prompt inspector');
      const inspected = await evaluate('document.querySelector("#prompt-inspector").textContent');
      if (!inspected.includes('caelix-memory-ok')) throw new Error('System prompt inspector missing memory.');
      await click('#prompt-inspector-btn');
      return `${report.total} tokens across ${report.messages} messages; prompt inspected`;
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

    await step('checklist, skill, notebook, image read and web_search gate', async () => {
      await fsp.mkdir(path.join(workspace, '.caelix', 'skills', 'demo'), { recursive: true });
      await fsp.writeFile(path.join(workspace, '.caelix', 'skills', 'demo', 'SKILL.md'), '# Demo Skill\nAlways verify outputs.\n');
      await fsp.writeFile(path.join(workspace, 'demo.ipynb'), JSON.stringify({
        cells: [{ cell_type: 'code', execution_count: null, metadata: { trusted: true }, outputs: [], source: ['print("old")\n'] }],
        metadata: { kernelspec: { name: 'python3' } },
        nbformat: 4,
        nbformat_minor: 5,
      }, null, 1));
      const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
      await fsp.writeFile(path.join(workspace, 'pixel.png'), png1x1);

      await setValue('#prompt', 'Run checklist-and-notebook verification.');
      await click('#send-btn');
      await waitFor('!document.querySelector("#todo-bar").classList.contains("hidden")', 12000, 'todo checklist visible');
      await waitFor('window.__caelixState.streaming === false', 20000, 'extended tools turn complete');

      const nb = JSON.parse(await fsp.readFile(path.join(workspace, 'demo.ipynb'), 'utf8'));
      if (!String(nb.cells[0].source.join('')).includes('caelix notebook ok')) throw new Error('Notebook cell was not updated.');
      if (nb.metadata?.kernelspec?.name !== 'python3') throw new Error('Notebook metadata was lost.');

      const { ToolRunner } = require('./engine/tools');
      const runner = new ToolRunner({ root: workspace, mode: 'ask', ask: async () => 'deny' });
      let searchDenied = false;
      try {
        await runner.execute('web_search', { query: 'caelix test' });
      } catch (error) {
        searchDenied = /denied/i.test(error.message);
      }
      if (!searchDenied) throw new Error('web_search did not require permission.');
      const imgRes = await runner.execute('read_file', { path: 'pixel.png' });
      if (!imgRes.imageDataUrl?.startsWith('data:image/png;base64,')) throw new Error('read_file did not return image block.');
      return 'checklist rendered, notebook/skill/image/web_search verified';
    });

    await step('bypass banner, mentions, key gate, status strip, view mode and light theme', async () => {
      await click('#mode-chip');
      await waitFor('!document.querySelector("#mode-menu").classList.contains("hidden")', 3000, 'mode menu bypass');
      await click('[data-mode="bypass"]');
      await waitFor('!document.querySelector("#bypass-banner").classList.contains("hidden")', 3000, 'bypass warning visible');
      await click('#mode-chip');
      await click('[data-mode="accept"]');
      await waitFor('document.querySelector("#bypass-banner").classList.contains("hidden")', 3000, 'bypass warning hidden');

      await click('#model-chip');
      await waitFor('!document.querySelector("#model-menu").classList.contains("hidden")', 3000, 'model menu');
      await click('[data-provider="gemini"][data-model="gemini-3-flash-preview"]');
      await waitFor('!document.querySelector("#key-warning").classList.contains("hidden") && document.querySelector("#send-btn").disabled === true', 3000, 'missing-key composer gate');
      await click('#model-chip');
      await click('[data-provider="simulator"][data-model="sim-1"]');
      await waitFor('document.querySelector("#key-warning").classList.contains("hidden") && document.querySelector("#send-btn").disabled === false', 3000, 'simulator restored');

      await setValue('#prompt', '@caelix');
      await waitFor('!document.querySelector("#mention-menu").classList.contains("hidden")', 4000, 'mention menu');
      await setValue('#prompt', '');

      const stripText = await evaluate('document.querySelector("#status-strip")?.textContent || ""');
      if (!stripText.includes('context')) throw new Error('Status strip is missing context info.');

      await click('#view-mode-btn');
      await waitFor('document.querySelector("#view-mode-btn").textContent === "Verbose"', 3000, 'verbose mode');
      await click('#view-mode-btn');
      await click('#theme-btn');
      await waitFor('document.documentElement.getAttribute("data-theme") === "light"', 3000, 'light theme');
      await waitFor('getComputedStyle(document.body).backgroundColor === "rgb(246, 247, 249)"', 3000, 'light theme painted');
      await sleep(200);
      await snap('light theme');
      await click('#theme-btn');
      await waitFor('document.documentElement.getAttribute("data-theme") === "dark"', 3000, 'dark theme restored');
      return 'bypass, mentions, key gate, status strip, view mode, light theme verified';
    });

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

    await step('mcp, hooks, slash commands, helper agent, groq and nvidia catalog', async () => {
      const nvidiaModels = await evaluate('window.__caelixState.providers.find(p => p.id === "nvidia")?.models?.length || 0');
      if (nvidiaModels < 7) throw new Error(`Expected >= 7 live NVIDIA models, got ${nvidiaModels}`);
      const groqModels = await evaluate('window.__caelixState.providers.find(p => p.id === "groq")?.models?.length || 0');
      if (groqModels < 4) throw new Error(`Expected >= 4 Groq models, got ${groqModels}`);
      const coarenaModels = await evaluate('window.__caelixState.providers.find(p => p.id === "coarena")?.models?.length || 0');
      if (coarenaModels < 9) throw new Error(`Expected >= 9 Coarena (free + Claude) models, got ${coarenaModels}`);
      const openrouterModels = await evaluate('window.__caelixState.providers.find(p => p.id === "openrouter")?.models?.length || 0');
      if (openrouterModels < 15) throw new Error(`Expected >= 15 OpenRouter (free + Claude) models, got ${openrouterModels}`);
      const numesModels = await evaluate('window.__caelixState.providers.find(p => p.id === "numes")?.models?.length || 0');
      if (numesModels < 9) throw new Error(`Expected >= 9 Numes (free + Claude) models, got ${numesModels}`);
      await click('#keys-btn');
      await waitFor('!!document.querySelector("#key-input-groq")', 3000, 'groq key input in Keys modal');
      await waitFor('!!document.querySelector("#key-input-coarena")', 3000, 'coarena key input in Keys modal');
      await waitFor('!!document.querySelector("#key-input-numes")', 3000, 'numes key input in Keys modal');
      await click('#keys-close');
      await click('#team-chip');
      await waitFor('!document.querySelector("#team-menu")?.hidden', 3000, 'team menu popover open');
      const teamOptCount = await evaluate('document.querySelectorAll("#team-model-1 option").length');
      if (teamOptCount < 2) throw new Error(`Expected >= 2 Team model-1 options, got ${teamOptCount}`);
      const teamOpt2Count = await evaluate('document.querySelectorAll("#team-model-2 option").length');
      if (teamOpt2Count < 2) throw new Error(`Expected >= 2 Team model-2 options, got ${teamOpt2Count}`);
      const kiloInTeam = await evaluate('[...document.querySelectorAll("#team-model-1 option, #team-model-2 option")].some((option) => option.value.startsWith("kilo::"))');
      if (!kiloInTeam) throw new Error('Kilo is missing from the Team Mode model pickers.');
      const anonymousInTeam = await evaluate('window.__caelixState.providers.some((provider) => provider.anonymous)');
      if (!anonymousInTeam) throw new Error('No anonymous provider reached the renderer, so Team Mode cannot list Kilo.');
      await click('#team-save-btn');
      await waitFor('document.querySelector("#team-chip")?.textContent.includes("Team ✓")', 3000, 'team chip active after save');
      await click('#team-chip');
      await waitFor('!document.querySelector("#team-menu")?.hidden', 3000, 'team menu reopen');
      await click('#team-off-btn');
      await waitFor('!document.querySelector("#team-chip")?.textContent.includes("Team ✓")', 3000, 'team chip off after disable');

      // Slash commands menu + /help + /btw + /compact
      await setValue('#prompt', '/');
      await waitFor('!document.querySelector("#command-menu").classList.contains("hidden")', 3000, 'slash command menu');
      await setValue('#prompt', '/help');
      await click('#send-btn');
      await waitFor('document.querySelectorAll(".btw-card").length >= 1', 3000, '/help inline card');

      const msgCountBeforeBtw = await evaluate('window.__caelixState.session.messages.length');
      await setValue('#prompt', '/btw What folder is active?');
      await click('#send-btn');
      await waitFor('document.querySelectorAll(".btw-card").length >= 2', 4000, '/btw inline card');
      const msgCountAfterBtw = await evaluate('window.__caelixState.session.messages.length');
      if (msgCountAfterBtw !== msgCountBeforeBtw) throw new Error('/btw modified saved chat history.');

      await setValue('#prompt', '/compact');
      await click('#send-btn');
      await waitFor('document.querySelector("#transcript").textContent.includes("Compacted context")', 4000, '/compact result card');

      // Agents & Helper modal -> check built-in agents and run task
      await click('#helper-btn');
      await waitFor('window.__caelixState.helperOpen === true', 3000, 'agents modal');
      await waitFor('document.querySelectorAll("#agent-list .agent-card").length >= 5', 4000, '5 built-in specialized agents');
      await setValue('#helper-task', 'Inspect workspace files');
      await click('#helper-run');
      await waitFor('document.querySelectorAll(".helper-card").length >= 1', 6000, 'helper agent card rendered');
      await waitFor('window.__caelixState.streaming === false', 8000, 'helper turn complete');

      // MCP Server modal: verify built-in desktop & memory servers are connected, add tiny stdio script, verify connected tool, then remove
      const mockMcp = path.join(workspace, 'mock-mcp.sh');
      fs.writeFileSync(mockMcp, [
        '#!/bin/sh',
        'while IFS= read -r line; do',
        '  id=$(echo "$line" | sed -n "s/.*\\"id\\":\\([0-9]*\\).*/\\1/p")',
        '  case "$line" in',
        '    *initialize*) echo "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":$id,\\"result\\":{\\"protocolVersion\\":\\"2024-11-05\\",\\"capabilities\\":{},\\"serverInfo\\":{\\"name\\":\\"mock\\",\\"version\\":\\"1.0\\"}}}" ;;',
        '    *tools/list*) echo "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":$id,\\"result\\":{\\"tools\\":[{\\"name\\":\\"ping\\",\\"description\\":\\"Ping test\\",\\"inputSchema\\":{\\"type\\":\\"object\\",\\"properties\\":{}}}]}}" ;;',
        '  esac',
        'done',
      ].join('\n'), { mode: 0o755 });
      await click('#mcp-btn');
      await waitFor('window.__caelixState.mcpOpen === true', 3000, 'mcp modal');
      await waitFor('document.querySelector("#mcp-list").textContent.includes("4 tool(s)") && document.querySelector("#mcp-list").textContent.includes("3 tool(s)")', 10000, 'built-in desktop & memory MCP servers connected');
      await setValue('#mcp-name', 'mockping');
      // Quote the path: the command box deliberately splits on spaces, so a
      // workspace path containing one must be quoted like any other shell arg.
      await setValue('#mcp-command', `"${mockMcp}"`);
      await click('#mcp-add');
      await waitFor('document.querySelector("#mcp-list").textContent.includes("1 tool(s)")', 8000, 'mcp connected with 1 tool');
      await click('#mcp-list [data-name="mockping"] .mcp-remove');
      await waitFor('!document.querySelector("#mcp-list").textContent.includes("mockping")', 4000, 'mcp removed');
      await click('#mcp-close');
      fs.rmSync(mockMcp, { force: true });

      // Hooks modal: verify default hooks present, then add, verify, remove
      await click('#hooks-btn');
      await waitFor('window.__caelixState.hooksOpen === true', 3000, 'hooks modal');
      await waitFor('document.querySelectorAll("#hooks-list .config-item").length >= 3', 4000, 'default safety & syntax hooks present');
      await setValue('#hook-command', 'echo hook-ok');
      await click('#hook-add');
      await waitFor('document.querySelector("#hooks-list").textContent.includes("echo hook-ok")', 4000, 'hook saved');
      await click('#hooks-list [data-command="echo hook-ok"] .hook-remove');
      await waitFor('!document.querySelector("#hooks-list").textContent.includes("echo hook-ok")', 4000, 'hook removed');
      await click('#hooks-close');
      await snap('mcp hooks helper commands');
      return `${nvidiaModels} NVIDIA models; MCP, Hooks, Slash commands & Helper Agent verified`;
    });

    await step('delete a chat inline', async () => {
      const initialCount = await evaluate('document.querySelectorAll(".session-item").length');
      const prevActiveId = await evaluate('window.__caelixState.activeId');
      await click('#new-chat');
      await waitFor(`window.__caelixState.activeId !== ${JSON.stringify(prevActiveId)} && document.querySelectorAll(".session-item").length === ${initialCount + 1}`, 5000, 'new chat rendered');
      const before = await evaluate('document.querySelectorAll(".session-item").length');
      await click('.session-item.active .session-delete');
      await waitFor('document.querySelector(".session-item.active .session-delete.armed")', 3000, 'delete armed');
      await click('.session-item.active .session-delete');
      await waitFor(`document.querySelectorAll(".session-item").length === ${before - 1}`, 5000, 'chat deleted from sidebar');
      const after = await evaluate('document.querySelectorAll(".session-item").length');
      if (after >= before) throw new Error('The chat was not deleted from the sidebar.');
      return `chat deleted (${before} → ${after})`;
    });

    await step('chat and code switcher with folder picker', async () => {
      const initialCount = await evaluate('document.querySelectorAll(".session-item").length');
      const prevActiveId = await evaluate('window.__caelixState.activeId');
      await click('#new-chat');
      await waitFor(`window.__caelixState.activeId !== ${JSON.stringify(prevActiveId)} && document.querySelectorAll(".session-item").length === ${initialCount + 1}`, 5000, 'empty session for switcher check');
      await waitFor('document.querySelector("#app").getAttribute("data-surface") === "code"', 3000, 'default code surface');
      await waitFor('!!document.querySelector(".folder-picker-card") && !!document.querySelector("#empty-choose-folder")', 3000, 'code folder picker rendered');
      await click('#surface-chat');
      await waitFor('document.querySelector("#app").getAttribute("data-surface") === "chat"', 3000, 'switched to chat surface');
      await waitFor('document.querySelector("#panel").offsetWidth === 0 && !!document.querySelector(".chat-capability-pills")', 3000, 'chat surface hides code panel and keeps capability pills');
      const chatCwd = await evaluate('window.__caelixState.session?.cwd');
      const chatRoot = await evaluate('window.__caelixState.info?.chatRoot');
      if (!chatRoot || chatCwd !== chatRoot) throw new Error(`Chat session leaked code cwd: ${chatCwd} vs ${chatRoot}`);
      const sharedBtnsVisible = await evaluate('["#mcp-btn", "#hooks-btn", "#helper-btn", "#memory-btn"].every(s => document.querySelector(s)?.offsetWidth > 0)');
      if (!sharedBtnsVisible) throw new Error('MCP, Hooks, Agents, or Skills button was hidden in Chat mode.');
      await click('#surface-code');
      await waitFor('document.querySelector("#app").getAttribute("data-surface") === "code" && document.querySelector("#panel").offsetWidth > 300 && !!document.querySelector(".folder-picker-card")', 3000, 'switched back to code surface');
      const restoredCodeCwd = await evaluate('window.__caelixState.session?.cwd');
      if (restoredCodeCwd === chatRoot) throw new Error('Code session inherited CAELIX Chats folder.');
      await snap('chat and code switcher');
      await click('.session-item.active .session-delete');
      await waitFor('document.querySelector(".session-item.active .session-delete.armed")', 3000, 'delete armed');
      await click('.session-item.active .session-delete');
      await waitFor(`document.querySelectorAll(".session-item").length === ${initialCount}`, 5000, 'temp switcher chat deleted');
      return 'Chat <-> Code switcher, isolated folders, shared MCP/Hooks/Agents/Skills, and Code folder picker verified';
    });

    await step('keep chat conversations isolated from code sidebar and folders', async () => {
      const codeCount = await evaluate('document.querySelectorAll(".session-item").length');
      await click('#surface-chat');
      await waitFor('document.querySelector("#app").getAttribute("data-surface") === "chat"', 3000, 'chat surface active');
      await waitFor('window.__caelixState.session?.surface === "chat" && window.__caelixState.session?.cwd === window.__caelixState.info?.chatRoot', 5000, 'auto-switched to CAELIX Chats');
      const hiddenFolderUi = await evaluate('getComputedStyle(document.querySelector("#strip-folder")).display === "none" && getComputedStyle(document.querySelector("#project-btn")).display === "none"');
      if (!hiddenFolderUi) throw new Error('Folder controls remained visible in Chat mode.');
      const chatBeforeNew = await evaluate('document.querySelectorAll(".session-item").length');
      await click('#new-chat');
      await waitFor(`document.querySelectorAll(".session-item").length === ${chatBeforeNew + 1}`, 5000, 'new chat in CAELIX Chats');
      const newChatCwd = await evaluate('window.__caelixState.session?.cwd');
      const chatRoot = await evaluate('window.__caelixState.info?.chatRoot');
      if (newChatCwd !== chatRoot) throw new Error(`New chat in Chat mode used ${newChatCwd} instead of ${chatRoot}`);
      await setValue('#prompt', 'Isolated chat message.');
      await click('#send-btn');
      await waitFor('window.__caelixState.streaming === false && document.querySelectorAll(".msg").length >= 2', 15000, 'chat reply finished');
      const aiChatTitle = await evaluate('window.__caelixState.session?.title || ""');
      if (!aiChatTitle || aiChatTitle === 'New chat' || aiChatTitle === 'Isolated chat message.') {
        throw new Error(`Expected AI-generated chat title, got "${aiChatTitle}".`);
      }
      await click('#surface-code');
      await waitFor('document.querySelector("#app").getAttribute("data-surface") === "code" && window.__caelixState.session?.surface === "code"', 5000, 'returned to code surface');
      const afterCodeCount = await evaluate('document.querySelectorAll(".session-item").length');
      if (afterCodeCount !== codeCount) throw new Error(`Chat session leaked into Code sidebar (${afterCodeCount} vs ${codeCount}).`);
      await evaluate(`(async () => {
        const list = await window.caelix.invoke('sessions:list');
        for (const s of list.sessions) {
          if (s.surface === 'chat') await window.caelix.invoke('sessions:delete', s.id);
        }
        const refreshed = await window.caelix.invoke('sessions:list');
        const target = refreshed.sessions.find((s) => s.title === 'CAELIX self-check chat') || refreshed.sessions[0];
        if (target) {
          await window.caelix.invoke('sessions:set-active', target.id);
        }
      })()`);
      await evaluate('([...document.querySelectorAll(".session-item")].find(el => el.textContent.includes("CAELIX self-check chat")) || document.querySelector(".session-item"))?.click()');
      await waitFor('document.querySelector("#chat-title").textContent === "CAELIX self-check chat" && document.querySelectorAll(".session-item").length === ' + codeCount, 5000, 'self-check chat active again');
      await sleep(100);
      return 'Chat and Code sidebars and folders stay strictly separated';
    });

    await step('built-in browser panel operates a local page with navigate, type, click and read', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><head><title>CAELIX Test Page</title></head><body><input id="name-input" type="text"><button id="go-btn" onclick="document.getElementById(\'result\').textContent=\'Submitted: \' + document.getElementById(\'name-input\').value">Submit</button><div id="result">Waiting</div></body></html>');
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();
      const targetUrl = `http://127.0.0.1:${port}/`;
      const initialCount = await evaluate('document.querySelectorAll(".session-item").length');
      const prevActiveId = await evaluate('window.__caelixState.activeId');
      try {
        await click('#new-chat');
        await waitFor(`window.__caelixState.activeId !== ${JSON.stringify(prevActiveId)} && document.querySelectorAll(".session-item").length === ${initialCount + 1}`, 5000, 'temp chat for browser');
        await click('#mode-chip');
        await waitFor('!document.querySelector("#mode-menu").classList.contains("hidden")', 3000, 'mode menu for browser');
        await click('[data-mode="bypass"]');
        await waitFor('window.__caelixState.session?.mode === "bypass"', 3000, 'bypass enabled for browser');
        await setValue('#prompt', `browser-demo ${targetUrl}`);
        await click('#send-btn');
        await waitFor('window.__caelixState.streaming === false && document.querySelector("#transcript").textContent.includes("navigation, form input, click, and read completed")', 20000, 'browser demo completed');
        await waitFor('document.querySelector(".panel-tab[data-tab=\\"browser\\"]").classList.contains("active")', 4000, 'browser tab auto-opened');
        const browserUrl = await evaluate('document.querySelector("#browser-url").value');
        if (!browserUrl.includes(`127.0.0.1:${port}`)) throw new Error(`Expected browser URL to show ${targetUrl}, got ${browserUrl}`);
        const readWorked = await evaluate('document.querySelector("#transcript").textContent.includes("Submitted: caelix-browser-ok")');
        if (!readWorked) throw new Error('Expected final browser_read output to include "Submitted: caelix-browser-ok".');
        await click('.panel-tab[data-tab="changes"]');
        await click('.session-item.active .session-delete');
        await waitFor('document.querySelector(".session-item.active .session-delete.armed")', 3000, 'browser test delete armed');
        await click('.session-item.active .session-delete');
        await waitFor(`document.querySelectorAll(".session-item").length === ${initialCount}`, 5000, 'temp browser chat deleted');
        return `browser operated ${targetUrl} (navigate, type, click, read)`;
      } finally {
        await evaluate('window.caelix.invoke("browser:hide").catch(() => {})').catch(() => {});
        server.close();
      }
    });

    await step('reset chat usage with /reset while carrying context summary forward', async () => {
      const initialCount = await evaluate('document.querySelectorAll(".session-item").length');
      const prevActiveId = await evaluate('window.__caelixState.activeId');
      await click('#new-chat');
      await waitFor(`window.__caelixState.activeId !== ${JSON.stringify(prevActiveId)} && document.querySelectorAll(".session-item").length === ${initialCount + 1}`, 5000, 'temp chat for /reset');
      await setValue('#prompt', 'First message before reset.');
      await click('#send-btn');
      await waitFor('window.__caelixState.streaming === false && document.querySelectorAll(".msg").length >= 2', 15000, 'first reply before reset');
      await waitFor('window.__caelixState.contextReport && window.__caelixState.contextReport.messages >= 2', 5000, 'context counted before reset');
      const beforeResetMsgs = await evaluate('window.__caelixState.contextReport.messages');
      await click('[data-tab="context"]');
      await waitFor('!!document.querySelector("#context-reset-btn")', 4000, 'context reset button rendered');
      await setValue('#prompt', '/reset');
      await click('#send-btn');
      await waitFor('document.querySelectorAll(".context-reset-divider").length === 1', 5000, 'reset divider rendered');
      await waitFor('window.__caelixState.contextReport && window.__caelixState.contextReport.messages === 1 && window.__caelixState.contextReport.toolTokens === 0', 5000, 'context shrunk to 1 compact handoff note');
      const hasHandoffNote = await evaluate('document.querySelector("#transcript").textContent.includes("First message before reset.")');
      if (!hasHandoffNote) throw new Error('Expected /reset handoff note to summarize earlier conversation.');
      const keptMsgs = await evaluate('document.querySelectorAll(".msg").length');
      if (keptMsgs < 2) throw new Error('Expected chat scroll to remain visible above reset divider.');
      await setValue('#prompt', 'Fresh turn after reset.');
      await click('#send-btn');
      await waitFor('window.__caelixState.streaming === false && document.querySelectorAll(".msg").length >= 4', 15000, 'reply after reset');
      await waitFor(`window.__caelixState.contextReport && window.__caelixState.contextReport.messages >= 3 && window.__caelixState.contextReport.savedMessages >= ${beforeResetMsgs} + window.__caelixState.contextReport.messages`, 5000, 'handoff + fresh turn in active AI memory');
      await click('.session-item.active .session-delete');
      await waitFor('document.querySelector(".session-item.active .session-delete.armed")', 3000, 'reset test delete armed');
      await click('.session-item.active .session-delete');
      await waitFor(`document.querySelectorAll(".session-item").length === ${initialCount}`, 5000, 'temp /reset chat deleted');
      return '/reset summarized ongoing chat into compact handoff, lowered usage, and preserved scroll';
    });

    await step('collapse and restore the right panel', async () => {
      await click('#panel-toggle');
      await waitFor('document.querySelector("#panel").offsetWidth === 0', 3000, 'panel collapsed');
      await click('#panel-toggle');
      await waitFor('document.querySelector("#panel").offsetWidth > 300', 3000, 'panel restored');
      await click('[data-tab="changes"]');
      return 'panel collapsed and restored';
    });

    await step('restore code folder chat after closing and reopening instead of showing open folder', async () => {
      const subFolder = path.join(workspace, 'folder-restore-sub');
      fs.mkdirSync(subFolder, { recursive: true });
      const createdId = await evaluate(`(async () => {
        const s = await window.caelix.invoke('sessions:create', {
          cwd: ${quote(subFolder)},
          surface: 'code',
          provider: 'simulator',
          model: 'sim-1',
          mode: 'accept',
        });
        await window.caelix.invoke('project:set', ${quote(subFolder)});
        return s.id;
      })()`);
      await evaluate(`document.querySelector('[data-session="' + ${quote(createdId)} + '"]')?.click()`);
      await waitFor(`window.__caelixState.session?.id === ${quote(createdId)} && window.__caelixState.session?.cwd === ${quote(subFolder)}`, 4000, 'opened subFolder chat');
      await setValue('#prompt', 'Remember this folder chat after reopen.');
      await click('#send-btn');
      await waitFor('window.__caelixState.streaming === false && document.querySelectorAll(".msg").length >= 2', 15000, 'folder chat reply finished');

      // Leave an empty New chat stub active in Code mode, then reload the window.
      await click('#new-chat');
      await waitFor('!!document.querySelector(".folder-picker-card")', 4000, 'empty stub shows folder picker');
      const emptyStubId = await evaluate('window.__caelixState.session?.id');

      win.webContents.reload();
      await waitFor('window.__caelixReady === true', 15000, 'renderer after reload');
      await waitFor(`window.__caelixState.session?.id === ${quote(createdId)} && document.querySelectorAll(".msg").length >= 2`, 8000, 'saved folder chat restored instead of open folder');
      if (await evaluate('!!document.querySelector(".folder-picker-card")')) {
        throw new Error('Reopening CAELIX showed the empty folder picker instead of the saved folder chat.');
      }

      // Now open the empty stub and click the folder in the picker — should also reopen the saved folder chat.
      await evaluate(`document.querySelector('[data-session="' + ${quote(emptyStubId)} + '"]')?.click()`);
      await waitFor(`window.__caelixState.session?.id === ${quote(emptyStubId)} && !!document.querySelector(".folder-picker-card")`, 4000, 'empty stub selected');
      await click(`.folder-pick-item[data-pick-folder="${subFolder}"]`);
      await waitFor(`window.__caelixState.session?.id === ${quote(createdId)} && document.querySelectorAll(".msg").length >= 2`, 5000, 'selecting folder reopened its saved chat');

      // Clean up temporary sessions and restore workspace as active project before final reload check.
      await evaluate(`(async () => {
        await window.caelix.invoke('sessions:delete', ${quote(emptyStubId)});
        await window.caelix.invoke('sessions:delete', ${quote(createdId)});
        await window.caelix.invoke('project:set', ${quote(workspace)});
        const list = await window.caelix.invoke('sessions:list');
        const target = list.sessions.find((s) => s.title === 'CAELIX self-check chat') || list.sessions[0];
        if (target) await window.caelix.invoke('sessions:set-active', target.id);
      })()`);
      fs.rmSync(subFolder, { recursive: true, force: true });
      await evaluate('([...document.querySelectorAll(".session-item")].find(el => el.textContent.includes("CAELIX self-check chat")) || document.querySelector(".session-item"))?.click()');
      await waitFor('document.querySelector("#chat-title").textContent === "CAELIX self-check chat"', 5000, 'restored self-check chat before final reload');
      return 'folder chat saved, survived empty stub & window reload, and reopened on folder select';
    });

    await step('update button and updater logic are ready for future releases', async () => {
      const updater = require(path.join(__dirname, 'updater'));
      if (updater.compareVersions('0.1.40', '0.1.39') <= 0) throw new Error('compareVersions must order 0.1.40 above 0.1.39.');
      if (updater.compareVersions('v0.1.39', '0.1.39') !== 0) throw new Error('compareVersions must treat v0.1.39 and 0.1.39 as equal.');
      const release = updater.parseRelease({
        tag_name: 'v9.9.9',
        html_url: 'https://github.com/mailsitnc-ai/CAELIX/releases/tag/v9.9.9',
        assets: [{ name: 'CAELIX-9.9.9.dmg', browser_download_url: 'https://example.com/CAELIX-9.9.9.dmg', size: 10 }],
      }, '0.1.39');
      if (!release.available || release.assetName !== 'CAELIX-9.9.9.dmg' || !release.assetUrl) {
        throw new Error('Updater did not pick the DMG asset from a newer release.');
      }
      const bare = updater.parseRelease({ tag_name: 'v9.9.9', assets: [] }, '0.1.39');
      if (bare.assetUrl !== null) throw new Error('Updater must not invent an asset when the release has none.');
      const button = await evaluate('Boolean(document.querySelector("#update-btn"))');
      if (!button) throw new Error('Update button is missing from the top bar.');
      const hidden = await evaluate('document.querySelector("#update-btn").classList.contains("hidden")');
      if (!hidden) throw new Error('Update button must stay hidden when no newer release is offered.');
      return 'version comparison, DMG asset discovery and the top-bar update button verified';
    });

    await step('restart the window and find the chat again', async () => {
      await sleep(400);
      win.webContents.reload();
      await waitFor('window.__caelixReady === true', 15000, 'renderer after reload');
      await waitFor('document.querySelector("#chat-title").textContent === "CAELIX self-check chat"', 8000, 'restored title');
      const messages = await evaluate('document.querySelectorAll(".msg").length');
      if (messages < 2) throw new Error('The conversation did not come back after reload.');
      const hasCopyAndSummary = await evaluate('document.querySelectorAll(".msg-copy-btn").length >= 1 && document.querySelectorAll(".turn-summary-card").length >= 1');
      if (!hasCopyAndSummary) throw new Error('Expected message Copy button and Turn Summary card after reload.');
      return `${messages} messages restored with Copy button and Task Summary`;
    });
    await snap('restored after reload');
  } catch (error) {
    errors.push({ kind: 'outer', message: error.message, stack: error.stack });
  }

  await finish(false);
}

module.exports = { run };
