'use strict';

// Guard for "make every model reliable".
//
// Three faults used to cost a user real work:
//   1. once a model had streamed any text, the engine refused to fail over, so
//      a model that died mid-reply ended the turn with an error even though
//      seven other models were available;
//   2. nothing remembered which free models had just stalled, so the next turn
//      walked into the same minute-long silence;
//   3. a mid-answer silence was tolerated for the full 45s budget even after a
//      model had proved it could stream a token every few milliseconds.
//
// This script pins the fixes end to end through the real Engine and a local
// fake gateway. No key, no network, no paid model.
//
// Run: node scripts/verify-reliability.js

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { Engine } = require(path.join(ROOT, 'src/engine'));
const { ModelHealth } = require(path.join(ROOT, 'src/engine/model-health'));
const { PROVIDERS } = require(path.join(ROOT, 'src/engine/providers'));

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push([true, name]); console.log(`ok   ${name}`); })
    .catch((error) => { results.push([false, name, error]); console.log(`FAIL ${name}\n     ${error.message}`); });
}

function makeMemSession(cwd, provider, model) {
  const session = {
    id: `rel_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    title: 'Reliability',
    cwd,
    provider,
    model,
    mode: 'bypass',
    messages: [],
    changes: [],
    terminal: [],
    todos: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const sessions = {
    get: (id) => (id === session.id ? session : null),
    update: (id, patch) => {
      if (id !== session.id) return null;
      Object.assign(session, patch, { updatedAt: Date.now() });
      return session;
    },
    saveTurn: (id, msgs, extra = {}) => {
      if (id !== session.id) return null;
      session.messages.push(...msgs);
      if (extra.changes) session.changes.push(...extra.changes);
      if (extra.terminal) session.terminal.push(...extra.terminal);
      if (extra.todos) session.todos = extra.todos;
      session.updatedAt = Date.now();
      return session;
    },
    appendMessage: (id, message) => {
      if (id !== session.id) return null;
      session.messages.push(message);
      return message;
    },
  };
  return { session, sessions };
}

/**
 * handler(model, body) -> 'silent' | { text } | { prefixThenSilent } | { toolCalls }
 */
function fakeGateway(handler) {
  const calls = [];
  const bodies = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* ignore */ }
      const model = body.model || '';
      calls.push(model);
      bodies.push(body);
      const action = handler(model, body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (action === 'silent') {
        res.write(': keepalive\n\n');
        return;
      }
      if (action && action.prefix) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: action.prefix } }] })}\n\n`);
        return; // then silence, forever
      }
      if (action && action.toolCalls) {
        action.toolCalls.forEach((call, index) => {
          res.write(`data: ${JSON.stringify({
            choices: [{
              delta: {
                tool_calls: [{
                  index,
                  id: call.id || `call_${index}`,
                  function: { name: call.name, arguments: JSON.stringify(call.input || {}) },
                }],
              },
            }],
          })}\n\n`);
        });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const text = (action && action.text) || `answered by ${model}`;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return { server, calls, bodies };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

const ENV_KEYS = [
  'CAELIX_REQUEST_TIMEOUT_MS',
  'CAELIX_FIRST_BYTE_TIMEOUT_MS',
  'CAELIX_REASONING_TIMEOUT_MS',
  'CAELIX_MAX_REQUEST_MS',
  'CAELIX_FAST_IDLE_MS',
];
function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

(async () => {
  clearEnv();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caelix-reliability-'));

  try {
    await check('health memory demotes a model that stalls twice and clears on a finish', () => {
      const health = new ModelHealth(tmp);
      health.reset();
      health.record('groq', 'flaky-model', { stall: true, error: 'stalled' });
      assert.strictEqual(health.isDemoted('groq', 'flaky-model'), false,
        'one stall is not enough to demote a model');
      health.record('groq', 'flaky-model', { stall: true, error: 'stalled' });
      assert.strictEqual(health.isDemoted('groq', 'flaky-model'), true,
        'two consecutive stalls in half an hour must demote the model');
      assert.ok(health.score('groq', 'flaky-model') < 70,
        `a stalling model must score below neutral, got ${health.score('groq', 'flaky-model')}`);
      health.record('groq', 'flaky-model', { ok: true, elapsedMs: 900, ttfbMs: 300 });
      assert.strictEqual(health.isDemoted('groq', 'flaky-model'), false,
        'a finished turn must clear the demotion');
      // History survives a restart, so the next app launch benefits too.
      const reloaded = new ModelHealth(tmp);
      assert.ok(reloaded.stats('groq', 'flaky-model').ok >= 1, 'health must persist across instances');
      const raw = fs.readFileSync(path.join(tmp, 'model-health.json'), 'utf8');
      assert(!/sk-|gsk_|Bearer/i.test(raw), 'health file must never contain key material');
    });

    await check('a stalling model is ranked below a healthy sibling', () => {
      const health = new ModelHealth(tmp);
      health.reset();
      for (let i = 0; i < 3; i += 1) health.record('groq', 'bad-sibling', { stall: true });
      health.record('groq', 'good-sibling', { ok: true, elapsedMs: 800 });
      const ranked = health.rank('groq', ['bad-sibling', 'good-sibling']);
      assert.strictEqual(ranked[0], 'good-sibling', `expected the healthy model first, got ${ranked}`);
    });

    await check('failover targets are ordered by observed reliability', () => {
      const { session } = makeMemSession(tmp, 'groq', 'openai/gpt-oss-20b');
      const health = new ModelHealth(tmp);
      health.reset();
      for (let i = 0; i < 3; i += 1) health.record('groq', 'openai/gpt-oss-120b', { stall: true });
      health.record('groq', 'qwen/qwen3.8-27b', { ok: true, elapsedMs: 700 });
      const engine = new Engine({
        sessions: { get: () => session },
        keys: { get: () => 'placeholder-not-a-key', list: () => ['placeholder-not-a-key'] },
        emit: () => {},
        ask: async () => 'allow',
        askUser: async () => 'ok',
        userDataDir: tmp,
        health,
      });
      const targets = engine.listFailoverTargets('groq', 'openai/gpt-oss-20b');
      assert.strictEqual(targets[0].tier, 'primary', 'the primary model must stay first');
      const siblings = targets.filter((t) => t.tier === 'sibling-model').map((t) => t.model);
      const healthy = siblings.indexOf('qwen/qwen3.8-27b');
      const stalled = siblings.indexOf('openai/gpt-oss-120b');
      assert(healthy >= 0 && stalled >= 0, `expected both siblings, got ${JSON.stringify(siblings)}`);
      assert(healthy < stalled,
        `a recently stalled sibling must not be tried first: ${JSON.stringify(siblings)}`);
    });

    await check('a model that dies mid-answer is continued, not thrown away', async () => {
      const head = 'Here is the plan. First read the scanner. Second replace the AST walk with REA bridge calls. Third verify with render_preview. ';
      const { session, sessions } = makeMemSession(tmp, 'groq', 'openai/gpt-oss-20b');
      const { server, calls } = fakeGateway((model) => {
        if (model === 'openai/gpt-oss-20b') return { prefix: head };
        // The sibling repeats the visible head, then finishes it. The user
        // must not see that head twice.
        return { text: `${head}Done: all four tasks completed.` };
      });
      const baseUrl = await listen(server);
      const origBase = PROVIDERS.groq.baseUrl;
      // A 400ms pinned budget makes the dead stream fail in under a second.
      process.env.CAELIX_REQUEST_TIMEOUT_MS = '400';
      try {
        PROVIDERS.groq.baseUrl = baseUrl;
        const statuses = [];
        let streamed = '';
        const engine = new Engine({
          sessions,
          keys: { get: () => 'placeholder-not-a-key', list: () => ['placeholder-not-a-key'] },
          emit: (e) => {
            if (e.type === 'status') statuses.push(e);
            if (e.type === 'text') streamed += e.delta;
          },
          ask: async () => 'allow',
          askUser: async () => 'ok',
          userDataDir: tmp,
        });
        const out = await engine.send(session.id, 'build the REA bug scanner');

        assert.strictEqual(out.ok, true, `the turn must finish on another model: ${out.error}`);
        assert(calls.length >= 2, `expected a second model attempt, saw ${JSON.stringify(calls)}`);
        assert.strictEqual(streamed, `${head}Done: all four tasks completed.`,
          `the continuation must be seamless with no repeated head: ${JSON.stringify(streamed)}`);
        const continued = statuses.find((s) => /continuing the same answer/i.test(s.message || ''));
        assert(continued, `the user must be told the answer continues: ${JSON.stringify(statuses.map((s) => s.message))}`);
        const saved = session.messages.filter((m) => m.role === 'assistant').map((m) => m.content).join('\n');
        assert(saved.includes('all four tasks completed'), `the finished answer must be saved: ${saved}`);
        assert.strictEqual((saved.match(/Here is the plan\./g) || []).length, 1,
          `the saved answer must contain the head once, got ${JSON.stringify(saved)}`);
        assert.ok(engine.health.stats('groq', 'openai/gpt-oss-20b').stalls >= 1,
          'the stall must be remembered for the next turn');
        assert.strictEqual(engine.keyCooldowns.size, 0, 'a stall must never cool the key');
      } finally {
        clearEnv();
        PROVIDERS.groq.baseUrl = origBase;
        await close(server);
      }
    });

    await check('a demoted model starts on a healthy sibling and says so', async () => {
      const { session, sessions } = makeMemSession(tmp, 'groq', 'openai/gpt-oss-20b');
      const health = new ModelHealth(tmp);
      health.reset();
      for (let i = 0; i < 2; i += 1) health.record('groq', 'openai/gpt-oss-20b', { stall: true });
      health.record('groq', 'qwen/qwen3.8-27b', { ok: true, elapsedMs: 600 });
      const { server, calls } = fakeGateway((model) => ({ text: `answered by ${model}` }));
      const baseUrl = await listen(server);
      const origBase = PROVIDERS.groq.baseUrl;
      try {
        PROVIDERS.groq.baseUrl = baseUrl;
        const statuses = [];
        const engine = new Engine({
          sessions,
          keys: { get: () => 'placeholder-not-a-key', list: () => ['placeholder-not-a-key'] },
          emit: (e) => { if (e.type === 'status') statuses.push(e); },
          ask: async () => 'allow',
          askUser: async () => 'ok',
          userDataDir: tmp,
          health,
        });
        const out = await engine.send(session.id, 'hello');
        assert.strictEqual(out.ok, true, out.error);
        assert.notStrictEqual(calls[0], 'openai/gpt-oss-20b',
          `a twice-stalled model must not be tried again first: ${JSON.stringify(calls)}`);
        assert(/stalled repeatedly/i.test(statuses.map((s) => s.message).join(' ')),
          `the demotion must be reported: ${JSON.stringify(statuses.map((s) => s.message))}`);
      } finally {
        clearEnv();
        PROVIDERS.groq.baseUrl = origBase;
        await close(server);
      }
    });

    await check('independent reads in one round run together', async () => {
      const work = path.join(tmp, 'reads');
      fs.mkdirSync(work, { recursive: true });
      for (const name of ['a.js', 'b.js', 'c.js', 'd.js']) fs.writeFileSync(path.join(work, name), `// ${name}\n`);
      const { session, sessions } = makeMemSession(work, 'groq', 'openai/gpt-oss-20b');
      let round = 0;
      const { server } = fakeGateway(() => {
        round += 1;
        if (round === 1) {
          return {
            toolCalls: [
              { name: 'read_file', input: { path: 'a.js' } },
              { name: 'read_file', input: { path: 'b.js' } },
              { name: 'read_file', input: { path: 'c.js' } },
              { name: 'read_file', input: { path: 'd.js' } },
            ],
          };
        }
        return { text: 'all four files read' };
      });
      const baseUrl = await listen(server);
      const origBase = PROVIDERS.groq.baseUrl;
      try {
        PROVIDERS.groq.baseUrl = baseUrl;
        const events = [];
        const engine = new Engine({
          sessions,
          keys: { get: () => 'placeholder-not-a-key', list: () => ['placeholder-not-a-key'] },
          emit: (e) => { if (e.type === 'tool-start' || e.type === 'tool-result') events.push(e); },
          ask: async () => 'allow',
          askUser: async () => 'ok',
          userDataDir: tmp,
          modelHealth: false,
        });
        const out = await engine.send(session.id, 'read the four files');
        assert.strictEqual(out.ok, true, out.error);
        assert.strictEqual(events.filter((e) => e.type === 'tool-result').length, 4,
          `expected four tool results, got ${events.length} events`);
        const firstResult = events.findIndex((e) => e.type === 'tool-result');
        const lastStart = events.map((e) => e.type).lastIndexOf('tool-start');
        assert(lastStart < firstResult,
          `reads ran one after another — all starts must precede the first result: ${events.map((e) => e.type).join(',')}`);
      } finally {
        clearEnv();
        PROVIDERS.groq.baseUrl = origBase;
        await close(server);
      }
    });

    await check('a fast stream is judged against its own pace', async () => {
      // 25 quick chunks, then silence: a healthy model that died. With the
      // adaptive budget it must be caught in about a second, not after 45s.
      const chunk = 'The quick brown fox jumps over the lazy dog. ';
      let beat = null;
      const slow = http.createServer((req, res) => {
        req.resume();
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        let sent = 0;
        beat = setInterval(() => {
          if (sent < 25) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
            sent += 1;
          } else {
            clearInterval(beat);
            beat = null;
          }
        }, 10);
      });
      const slowUrl = await listen(slow);
      const { streamOpenAICompatible } = require(path.join(ROOT, 'src/engine/providers'));
      const origBase = PROVIDERS.groq.baseUrl;
      process.env.CAELIX_FAST_IDLE_MS = '700';
      try {
        PROVIDERS.groq.baseUrl = slowUrl;
        const started = Date.now();
        await assert.rejects(
          () => streamOpenAICompatible({
            provider: 'groq',
            model: 'openai/gpt-oss-20b',
            apiKey: 'placeholder-not-a-key',
            messages: [{ role: 'user', content: 'hi' }],
            onDelta: () => {},
          }),
          (error) => {
            assert.ok(error.stall, `expected a stall, got: ${error.message}`);
            return true;
          },
        );
        const elapsed = Date.now() - started;
        assert(elapsed >= 600, `fired before the adaptive budget: ${elapsed}ms`);
        assert(elapsed <= 5000, `a fast 25-chunk stream should be caught in ~1s, took ${elapsed}ms`);
      } finally {
        clearEnv();
        PROVIDERS.groq.baseUrl = origBase;
        if (beat) clearInterval(beat);
        await close(slow);
      }
    });

    await check('a stream too short to judge keeps the full idle budget', async () => {
      const { streamOpenAICompatible } = require(path.join(ROOT, 'src/engine/providers'));
      let beat = null;
      const server = http.createServer((req, res) => {
        req.resume();
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`);
        beat = setInterval(() => res.write(': keepalive\n\n'), 200);
      });
      const url = await listen(server);
      const origBase = PROVIDERS.groq.baseUrl;
      process.env.CAELIX_FAST_IDLE_MS = '400';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        PROVIDERS.groq.baseUrl = url;
        await assert.rejects(
          () => streamOpenAICompatible({
            provider: 'groq',
            model: 'openai/gpt-oss-20b',
            apiKey: 'placeholder-not-a-key',
            messages: [{ role: 'user', content: 'hi' }],
            signal: controller.signal,
            onDelta: () => {},
          }),
          (error) => {
            assert(/Cancelled/i.test(error.message),
              `two deltas must not trigger the fast budget: ${error.message}`);
            return true;
          },
        );
      } finally {
        clearTimeout(timer);
        clearEnv();
        PROVIDERS.groq.baseUrl = origBase;
        if (beat) clearInterval(beat);
        await close(server);
      }
    });

    await check('words already shown are saved even when no model can finish', async () => {
      const head = 'Partial answer that the user already read on screen. ';
      const { session, sessions } = makeMemSession(tmp, 'groq', 'openai/gpt-oss-20b');
      const { server } = fakeGateway(() => ({ prefix: head }));
      const baseUrl = await listen(server);
      const origBase = PROVIDERS.groq.baseUrl;
      process.env.CAELIX_REQUEST_TIMEOUT_MS = '300';
      try {
        PROVIDERS.groq.baseUrl = baseUrl;
        const engine = new Engine({
          sessions,
          keys: { get: () => 'placeholder-not-a-key', list: () => ['placeholder-not-a-key'] },
          emit: () => {},
          ask: async () => 'allow',
          askUser: async () => 'ok',
          userDataDir: tmp,
          health: new ModelHealth(path.join(tmp, 'empty-health')),
        });
        const out = await engine.send(session.id, 'anything');
        assert.strictEqual(out.ok, false, 'every model stalls, so the turn cannot succeed');
        const saved = session.messages.filter((m) => m.role === 'assistant').map((m) => m.content).join('\n');
        assert(saved.includes(head.trim()),
          `the partial answer must survive the failure: ${JSON.stringify(saved)}`);
      } finally {
        clearEnv();
        PROVIDERS.groq.baseUrl = origBase;
        await close(server);
      }
    });

    await check('short intro (<40 chars) before tool-call stall still fails over and writes the file', async () => {
      const work = path.join(tmp, 'short-prefix-tool');
      fs.mkdirSync(work, { recursive: true });
      const { session, sessions } = makeMemSession(work, 'nvidia', 'poolside/laguna-xs-2.1');
      let round = 0;
      const { server, calls } = fakeGateway((model) => {
        if (model === 'poolside/laguna-xs-2.1') return { prefix: 'Now building:' }; // 13 chars (< 40)
        round += 1;
        if (round === 1) {
          return { toolCalls: [{ name: 'write_file', input: { path: 'app.html', content: '<h1>Built</h1>' } }] };
        }
        return { text: 'Built app.html cleanly.' };
      });
      const baseUrl = await listen(server);
      const origNv = PROVIDERS.nvidia.baseUrl;
      process.env.CAELIX_REQUEST_TIMEOUT_MS = '300';
      try {
        PROVIDERS.nvidia.baseUrl = baseUrl;
        const engine = new Engine({
          sessions,
          keys: { get: () => 'nvapi-test', list: () => ['nvapi-test'] },
          emit: () => {},
          ask: async () => 'allow',
          askUser: async () => 'ok',
          userDataDir: tmp,
          health: new ModelHealth(path.join(tmp, 'h-short')),
        });
        const out = await engine.send(session.id, 'build app.html');
        assert.strictEqual(out.ok, true, `expected failover to complete write_file: ${out.error}`);
        assert(calls.length >= 2 && calls[1] !== 'poolside/laguna-xs-2.1', `expected failover off laguna: ${calls}`);
        assert.strictEqual(fs.readFileSync(path.join(work, 'app.html'), 'utf8'), '<h1>Built</h1>');
      } finally {
        clearEnv();
        PROVIDERS.nvidia.baseUrl = origNv;
        await close(server);
      }
    });
  } finally {
    clearEnv();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const failed = results.filter(([ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} reliability checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
