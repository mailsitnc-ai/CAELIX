'use strict';

// Guard for the "stalled for 35s without sending output" failure.
//
// Two independent faults used to kill a turn:
//   1. one watchdog budget covered both "no first byte yet" and "stream went
//      quiet mid-answer", so a big model composing a long tool call in one go
//      was aborted while perfectly healthy;
//   2. a stall was flagged noRetry, so no provider except NVIDIA/Coarena/Numes
//      was ever failed over — the turn simply ended.
//
// This script pins both behaviours so neither can regress. It uses a local
// fake gateway, so it needs no key, no network and no paid model.
//
// Run: node scripts/verify-stall-failover.js

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { Engine } = require(path.join(ROOT, 'src/engine'));
const { PROVIDERS, resolveTimeouts, streamOpenAICompatible } = require(path.join(ROOT, 'src/engine/providers'));

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push([true, name]); console.log(`ok   ${name}`); })
    .catch((error) => { results.push([false, name, error]); console.log(`FAIL ${name}\n     ${error.message}`); });
}

function makeMemSession(cwd, mode, provider, model) {
  const session = {
    id: `stall_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    title: 'Stall failover',
    cwd,
    provider,
    model,
    mode,
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
  };
  return { session, sessions };
}

// A gateway whose primary model never speaks, and whose siblings answer.
function fakeGateway(silentModels) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let model = '';
      try { model = JSON.parse(raw).model || ''; } catch { /* ignore */ }
      calls.push(model);
      if (silentModels.includes(model)) {
        // Hold the connection open without a single byte, exactly like a model
        // that is queued or composing a long tool call.
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(': keepalive\n\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `answered by ${model}` } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return { server, calls };
}

(async () => {
  const prevTimeout = process.env.CAELIX_REQUEST_TIMEOUT_MS;
  const prevFirstByte = process.env.CAELIX_FIRST_BYTE_TIMEOUT_MS;
  delete process.env.CAELIX_REQUEST_TIMEOUT_MS;
  delete process.env.CAELIX_FIRST_BYTE_TIMEOUT_MS;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caelix-stall-'));

  try {
    await check('pre-output budget is far larger than the mid-answer budget', () => {
      const kilo = resolveTimeouts('kilo', {});
      assert.ok(kilo.firstByteMs >= 120_000,
        `a big model needs room to compose a tool call; got ${kilo.firstByteMs}ms`);
      assert.ok(kilo.idleMs < kilo.firstByteMs,
        'a stream that dies after tokens started should still fail faster than a cold start');
      assert.ok(kilo.hardSilenceMs >= kilo.firstByteMs,
        'the keepalive ceiling must never be below the first-byte budget');
      // A keepalive-only connection cannot extend the wait forever.
      assert.ok(kilo.hardSilenceMs <= kilo.firstByteMs * 3, 'hard ceiling must stay bounded');
    });

    await check('a pinned timeout applies to both phases', () => {
      assert.strictEqual(resolveTimeouts('kilo', { timeoutMs: 250 }).firstByteMs, 250);
      process.env.CAELIX_REQUEST_TIMEOUT_MS = '250';
      const pinned = resolveTimeouts('kilo', {});
      assert.strictEqual(pinned.idleMs, 250);
      assert.strictEqual(pinned.firstByteMs, 250);
      delete process.env.CAELIX_REQUEST_TIMEOUT_MS;
    });

    await check('a stall is routed around, never a noRetry dead end', async () => {
      const { session, sessions } = makeMemSession(tmp, 'code', 'groq', 'openai/gpt-oss-20b');
      const { server, calls } = fakeGateway(['openai/gpt-oss-20b']);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const origBase = PROVIDERS.groq.baseUrl;
      process.env.CAELIX_REQUEST_TIMEOUT_MS = '250';
      try {
        PROVIDERS.groq.baseUrl = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
        const statuses = [];
        let streamed = '';
        const engine = new Engine({
          sessions,
          keys: { get: () => 'placeholder-not-a-key', list: () => ['placeholder-not-a-key'] },
          emit: (e) => {
            if (e.type === 'status') statuses.push(e);
            if (e.type === 'text') streamed += e.delta;
          },
          ask: async () => 'deny',
          askUser: async () => 'ok',
          userDataDir: tmp,
        });
        const out = await engine.send(session.id, 'hello');

        assert.strictEqual(out.ok, true, `turn should finish on another model: ${out.error || out.summary}`);
        assert(/answered by/.test(streamed), `no answer reached the user; streamed=${JSON.stringify(streamed)}`);
        assert(calls.includes('openai/gpt-oss-20b'),
          `expected the silent model to be tried first, gateway saw ${JSON.stringify(calls)}`);
        const servant = calls.find((m) => m && m !== 'openai/gpt-oss-20b');
        assert(servant, `no sibling model was tried: ${JSON.stringify(calls)}`);
        assert(streamed.includes(servant), `the answer came from the wrong model: ${streamed}`);

        const switchEvent = statuses.find((s) => s.stage === 'fallback');
        assert(switchEvent, 'the user must be told the model was switched');
        assert(/went silent/i.test(switchEvent.message), `switch message not honest: ${switchEvent.message}`);
        assert(/so work continues/.test(switchEvent.message), switchEvent.message);

        // A stall is a model/host problem: it must never cool the user's key.
        assert.strictEqual(engine.keyCooldowns.size, 0,
          `a stall must not cool the key, saw ${JSON.stringify([...engine.keyCooldowns])}`);
      } finally {
        delete process.env.CAELIX_REQUEST_TIMEOUT_MS;
        PROVIDERS.groq.baseUrl = origBase;
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      }
    });

    await check('reasoning then silence fails on the reasoning budget, not later', async () => {
      const server = http.createServer((req, res) => {
        req.resume();
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'composing the call…' } }] })}\n\n`);
        // Then never another byte: the model is "still composing" forever.
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const origBase = PROVIDERS.groq.baseUrl;
      process.env.CAELIX_REASONING_TIMEOUT_MS = '1500';
      try {
        PROVIDERS.groq.baseUrl = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
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
            assert.ok(error.stall, 'must be a stall');
            assert(/reasoning/i.test(error.message), `message should explain it stopped after reasoning: ${error.message}`);
            return true;
          },
        );
        const elapsed = Date.now() - started;
        assert(elapsed >= 1200, `fired too early at ${elapsed}ms — reasoning output was still live`);
        assert(elapsed <= 6000, `fired far too late at ${elapsed}ms — the reasoning budget was not applied`);
      } finally {
        delete process.env.CAELIX_REASONING_TIMEOUT_MS;
        PROVIDERS.groq.baseUrl = origBase;
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      }
    });

    await check('a keepalive-only connection still fails, and does not run forever', async () => {
      let beat = null;
      const server = http.createServer((req, res) => {
        req.resume();
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        beat = setInterval(() => res.write(': keepalive\n\n'), 200);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const origBase = PROVIDERS.groq.baseUrl;
      process.env.CAELIX_FIRST_BYTE_TIMEOUT_MS = '1200';
      try {
        PROVIDERS.groq.baseUrl = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
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
            assert.ok(error.stall, 'a keepalive-only connection must still be reported as a stall');
            return true;
          },
        );
        const elapsed = Date.now() - started;
        // hardSilenceMs = max(firstByte, reasoning) * 1.5. With the first-byte
        // budget pinned to 1200ms the ceiling must stay well under 10s.
        assert(elapsed <= 10_000, `keepalives extended the wait to ${elapsed}ms — the hard ceiling did not hold`);
      } finally {
        if (beat) clearInterval(beat);
        delete process.env.CAELIX_FIRST_BYTE_TIMEOUT_MS;
        PROVIDERS.groq.baseUrl = origBase;
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      }
    });

    await check('a dribbling model cannot reset the watchdog forever', async () => {
      let beat = null;
      const server = http.createServer((req, res) => {
        req.resume();
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        // One reasoning token every 150ms: each one would reset a gap timer.
        beat = setInterval(() => {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '·' } }] })}\n\n`);
        }, 150);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const origBase = PROVIDERS.groq.baseUrl;
      process.env.CAELIX_MAX_REQUEST_MS = '1500';
      try {
        PROVIDERS.groq.baseUrl = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
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
            assert.ok(error.stall, 'endless reasoning must end as a stall');
            assert(/gave up after/i.test(error.message), `ceiling should be explicit: ${error.message}`);
            return true;
          },
        );
        const elapsed = Date.now() - started;
        assert(elapsed >= 1200 && elapsed <= 5000,
          `absolute ceiling not enforced: stopped at ${elapsed}ms for a 1500ms cap`);
      } finally {
        if (beat) clearInterval(beat);
        delete process.env.CAELIX_MAX_REQUEST_MS;
        PROVIDERS.groq.baseUrl = origBase;
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      }
    });

    await check('a stall error is marked retryable and never says noRetry', async () => {
      const { server } = fakeGateway(['openai/gpt-oss-20b']);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const origBase = PROVIDERS.groq.baseUrl;
      try {
        PROVIDERS.groq.baseUrl = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
        await assert.rejects(
          () => streamOpenAICompatible({
            provider: 'groq',
            model: 'openai/gpt-oss-20b',
            apiKey: 'placeholder-not-a-key',
            messages: [{ role: 'user', content: 'hi' }],
            timeoutMs: 300,
            onDelta: () => {},
          }),
          (error) => {
            assert.strictEqual(error.stall, true, 'error.stall must be set so the engine can fail over');
            assert.ok(!error.noRetry, 'a stall must not be marked noRetry');
            assert(/stalled/.test(error.message), error.message);
            assert.strictEqual(error.status, 408);
            return true;
          },
        );
      } finally {
        PROVIDERS.groq.baseUrl = origBase;
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      }
    });
  } finally {
    if (prevTimeout === undefined) delete process.env.CAELIX_REQUEST_TIMEOUT_MS;
    else process.env.CAELIX_REQUEST_TIMEOUT_MS = prevTimeout;
    if (prevFirstByte === undefined) delete process.env.CAELIX_FIRST_BYTE_TIMEOUT_MS;
    else process.env.CAELIX_FIRST_BYTE_TIMEOUT_MS = prevFirstByte;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const failed = results.filter(([ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} stall-failover checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
