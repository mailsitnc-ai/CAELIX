#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MODES = new Set(['ask', 'accept', 'plan', 'bypass']);
const KEY_ENV = {
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  nvidia: ['NVIDIA_API_KEY'],
};

function check(name, ok, detail) {
  return { name, ok, detail };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function envKey(provider) {
  for (const name of KEY_ENV[provider] || []) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

async function doctor() {
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(check('Node.js', major >= 22, process.versions.node));

  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  checks.push(check('Electron binary', fs.existsSync(electron), electron));

  for (const asset of ['icon.svg', 'icon-1024.png', 'icon.icns']) {
    const file = path.join(ROOT, 'assets', asset);
    checks.push(check(`Asset ${asset}`, fs.existsSync(file), file));
  }

  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  checks.push(check('Git', git.status === 0, (git.stdout || git.stderr).trim()));

  const claude = path.join(os.homedir(), '.local', 'bin', 'claude');
  checks.push(check('Claude Code (optional provider)', fs.existsSync(claude), claude));

  const userData = path.join(os.homedir(), 'Library', 'Application Support', 'CAELIX');
  const keyFile = path.join(userData, 'keys.enc');
  checks.push(check('Encrypted key store', !fs.existsSync(keyFile) || fs.statSync(keyFile).size > 0, keyFile));

  const envFound = [];
  for (const [provider, names] of Object.entries(KEY_ENV)) {
    const found = names.find((name) => process.env[name]);
    if (found) envFound.push(`${provider} (${found})`);
  }
  checks.push(check('CLI provider keys', envFound.length > 0, envFound.join(', ') || 'none set; the CLI can still run the simulator'));

  const app = path.join(ROOT, 'src', 'engine', 'index.js');
  checks.push(check('Harness engine', fs.existsSync(app), app));

  for (const item of checks) {
    console.log(`${item.ok ? '✓' : '✗'} ${item.name}: ${item.detail}`);
  }
  const optional = new Set(['Claude Code (optional provider)', 'CLI provider keys']);
  const failed = checks.filter((item) => !item.ok && !optional.has(item.name));
  console.log('');
  console.log(failed.length ? `Doctor found ${failed.length} problem(s).` : 'Doctor passed.');
  process.exitCode = failed.length ? 1 : 0;
}

function listTools() {
  const { toolDefinitions } = require('./engine/tools');
  const tools = toolDefinitions(process.cwd());
  for (const tool of tools) {
    const first = String(tool.description).split('. The project root')[0];
    console.log(`${tool.name.padEnd(13)} ${first}`);
  }
  console.log('');
  console.log(`${tools.length} tools.`);
}

function chooseProvider(args) {
  if (args.provider) return String(args.provider);
  if (process.env.CAELIX_PROVIDER) return process.env.CAELIX_PROVIDER;
  for (const provider of ['gemini', 'openrouter', 'nvidia']) {
    if (envKey(provider)) return provider;
  }
  return 'simulator';
}

async function run(args) {
  const prompt = args._.join(' ').trim();
  if (!prompt) {
    console.error('Usage: caelix run "<prompt>" [--cwd DIR] [--provider NAME] [--model ID] [--mode ask|accept|plan|bypass] [--json] [--yes]');
    process.exitCode = 2;
    return;
  }

  const cwd = path.resolve(args.cwd || process.cwd());
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Folder not found: ${cwd}`);

  const mode = String(args.mode || 'ask').toLowerCase();
  if (!MODES.has(mode)) throw new Error(`Unknown mode: ${mode}`);
  const providerId = chooseProvider(args);
  const { PROVIDERS } = require('./engine/providers');
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const model = String(args.model || provider.defaultModel);
  const json = Boolean(args.json);

  if (providerId === 'simulator' && !json) {
    process.stderr.write('CAELIX Simulator: no key needed. The same engine, tools and events the window uses.\n');
  }

  const session = {
    id: 'cli',
    title: prompt.slice(0, 52),
    cwd,
    provider: providerId,
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
    saveTurn: (id, messages, extra = {}) => {
      if (id !== session.id) return null;
      session.messages.push(...messages);
      if (extra.changes) session.changes.push(...extra.changes);
      if (extra.terminal) session.terminal.push(...extra.terminal);
      if (extra.todos) session.todos = extra.todos;
      session.updatedAt = Date.now();
      return session;
    },
  };
  const keys = { get: (id) => envKey(id) };
  const { Engine } = require('./engine');
  const { McpManager } = require('./engine/mcp');
  const { HooksManager } = require('./engine/hooks');
  const mcp = new McpManager(path.join(os.homedir(), 'Library', 'Application Support', 'CAELIX'));
  const hooks = new HooksManager(path.join(os.homedir(), 'Library', 'Application Support', 'CAELIX'));

  let wroteText = false;
  const line = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const note = (text) => process.stderr.write(`${text}\n`);

  const engine = new Engine({
    sessions,
    keys,
    mcp,
    hooks,
    ask: async (request) => {
      if (json) line({ type: 'permission', ...request, decision: args.yes ? 'allow' : 'deny' });
      else note(`permission ${args.yes ? 'granted' : 'denied'}: ${request.action} ${request.target}`);
      return args.yes ? 'allow' : 'deny';
    },
    askUser: async (request) => {
      if (json) line({ type: 'question', ...request, answer: 'No answer (headless run).' });
      else note(`question: ${request.question} (no answer in a headless run)`);
      return 'No answer (headless run).';
    },
    emit: (event) => {
      if (event.type === 'text') {
        if (json) line({ type: 'text', delta: event.delta });
        else { process.stdout.write(event.delta); wroteText = true; }
        return;
      }
      if (json) {
        line(event);
        return;
      }
      if (event.type === 'tool-start') {
        if (wroteText) { process.stdout.write('\n'); wroteText = false; }
        const target = event.input?.path || event.input?.command || event.input?.pattern || event.input?.url || '';
        note(`· ${event.name}${target ? ` ${String(target).slice(0, 120)}` : ''}`);
      }
      if (event.type === 'tool-result' && !event.ok) note(`  failed: ${String(event.output).slice(0, 300)}`);
      if (event.type === 'retry') note(`  provider error, retrying (${event.attempt})`);
      if (event.type === 'error') note(`error: ${event.message}`);
      if (event.type === 'done') {
        if (wroteText) process.stdout.write('\n');
        const tokens = event.usage?.total_tokens;
        const changes = event.changes?.length || 0;
        note(`done in ${Math.round((event.elapsedMs || 0) / 100) / 10}s${tokens ? ` · ${tokens} tokens` : ''}${changes ? ` · ${changes} change(s)` : ''}`);
      }
    },
  });

  const result = await engine.send(session.id, prompt);
  engine.dispose();
  if (session.changes.length) {
    for (const change of session.changes) {
      if (!json) note(`changed: ${change.file} (+${change.additions ?? 0} −${change.deletions ?? 0})`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}

function help() {
  console.log('CAELIX');
  console.log('  caelix run "<prompt>"  run the harness once and stream its answer');
  console.log('       --cwd DIR         project folder (default: current folder)');
  console.log('       --provider NAME   gemini | openrouter | nvidia | claude | simulator');
  console.log('       --model ID        any model id, or the provider default');
  console.log('       --mode MODE       ask | accept | plan | bypass');
  console.log('       --json            one JSON event per line');
  console.log('       --yes             allow permission prompts in a headless run');
  console.log('  caelix tools           list the tools the harness can use');
  console.log('  caelix doctor          check the local runtime');
  console.log('  npm start              open the CAELIX window');
  console.log('  npm run selfcheck      drive the real app with the pretend model');
}

async function main() {
  const command = process.argv[2] || 'help';
  const args = parseArgs(process.argv.slice(3));
  if (command === 'doctor') return doctor();
  if (command === 'tools') return listTools();
  if (command === 'run') return run(args);
  if (command === 'help' || command === '--help' || command === '-h') return help();
  console.error(`Unknown command: ${command}`);
  help();
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
