#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const out = { server: 'desktop', file: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--server' && argv[i + 1]) {
      out.server = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--file' && argv[i + 1]) {
      out.file = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const MEMORY_FILE = opts.file || path.join(os.homedir(), '.caelix', 'mcp-memory.json');

function safeExec(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 512 * 1024,
    }).trim();
  } catch (error) {
    return (error.stdout || error.stderr || error.message || '').toString().trim();
  }
}

function readMemories() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMemories(items) {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  const tmp = `${MEMORY_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
  fs.renameSync(tmp, MEMORY_FILE);
}

const DESKTOP_TOOLS = [
  {
    name: 'mac_system_info',
    description: 'Inspect macOS system details, CPU/RAM, free disk space, and available developer tools (node, python3, git, brew).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'git_overview',
    description: 'Read current Git branch, short status, recent 10 commits, and working diff stat for the active project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'listening_ports',
    description: 'List local listening TCP ports and server process names on this Mac.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'clipboard_read',
    description: 'Read the current plain-text content from the macOS clipboard.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const MEMORY_TOOLS = [
  {
    name: 'memory_save',
    description: 'Save or update a persistent note or preference remembered across CAELIX chats.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short identifier for this fact or preference.' },
        value: { type: 'string', description: 'Details to remember.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search saved persistent memories by keyword (or omit query to list all).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search text.' },
      },
    },
  },
  {
    name: 'memory_delete',
    description: 'Remove an outdated saved memory by key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to delete.' },
      },
      required: ['key'],
    },
  },
];

function callDesktopTool(name) {
  const cwd = process.cwd();
  switch (name) {
    case 'mac_system_info': {
      const lines = [
        `OS: ${os.platform()} ${os.release()} (${os.arch()})`,
        `Host: ${os.hostname()}`,
        `CPUs: ${os.cpus().length}`,
        `RAM: ${(os.totalmem() / (1024 ** 3)).toFixed(1)} GB`,
        `Workspace: ${cwd}`,
        `Node: ${safeExec('/usr/bin/env', ['node', '-v']) || 'not found'}`,
        `Python3: ${safeExec('/usr/bin/env', ['python3', '--version']) || 'not found'}`,
        `Git: ${safeExec('/usr/bin/env', ['git', '--version']) || 'not found'}`,
        `Disk (${cwd}):\n${safeExec('/bin/df', ['-h', cwd])}`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    case 'git_overview': {
      const branch = safeExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
      const status = safeExec('git', ['status', '--short'], cwd);
      const log = safeExec('git', ['log', '-n', '10', '--oneline'], cwd);
      const stat = safeExec('git', ['diff', '--stat'], cwd);
      const out = [
        `Branch: ${branch || 'not a git repository'}`,
        '',
        'Status:',
        status || '(clean)',
        '',
        'Recent commits:',
        log || '(none)',
        stat ? `\nDiff stat:\n${stat}` : '',
      ].join('\n');
      return { content: [{ type: 'text', text: out }] };
    }
    case 'listening_ports': {
      const out = safeExec('/usr/sbin/lsof', ['-iTCP', '-sTCP:LISTEN', '-n', '-P']);
      return { content: [{ type: 'text', text: out || 'No listening TCP ports reported.' }] };
    }
    case 'clipboard_read': {
      const text = safeExec('/usr/bin/pbpaste', []);
      return { content: [{ type: 'text', text: text || '(clipboard is empty or non-text)' }] };
    }
    default:
      return { isError: true, content: [{ type: 'text', text: `Unknown desktop MCP tool: ${name}` }] };
  }
}

function callMemoryTool(name, args = {}) {
  const items = readMemories();
  switch (name) {
    case 'memory_save': {
      const key = String(args.key || '').trim();
      const value = String(args.value || '').trim();
      if (!key || !value) {
        return { isError: true, content: [{ type: 'text', text: 'Both key and value are required.' }] };
      }
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
      const next = items.filter((item) => item.key !== key);
      next.unshift({ key, value, tags, updatedAt: new Date().toISOString() });
      writeMemories(next.slice(0, 200));
      return { content: [{ type: 'text', text: `Saved memory "${key}". (${next.length} total)` }] };
    }
    case 'memory_search': {
      const q = String(args.query || '').trim().toLowerCase();
      const matched = q
        ? items.filter((item) => item.key.toLowerCase().includes(q)
            || item.value.toLowerCase().includes(q)
            || (item.tags || []).some((t) => String(t).toLowerCase().includes(q)))
        : items;
      if (!matched.length) return { content: [{ type: 'text', text: 'No matching memories stored.' }] };
      const lines = matched.slice(0, 30).map((item) => {
        const tagText = item.tags?.length ? ` [${item.tags.join(', ')}]` : '';
        return `- ${item.key}${tagText}: ${item.value}`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    case 'memory_delete': {
      const key = String(args.key || '').trim();
      const next = items.filter((item) => item.key !== key);
      if (next.length === items.length) {
        return { content: [{ type: 'text', text: `Memory "${key}" was not found.` }] };
      }
      writeMemories(next);
      return { content: [{ type: 'text', text: `Deleted memory "${key}".` }] };
    }
    default:
      return { isError: true, content: [{ type: 'text', text: `Unknown memory MCP tool: ${name}` }] };
  }
}

const TOOLS = opts.server === 'memory' ? MEMORY_TOOLS : DESKTOP_TOOLS;

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (req.id === undefined) return;
  if (req.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: `caelix-${opts.server}`, version: '1.0.0' },
      },
    });
  } else if (req.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } });
  } else if (req.method === 'tools/call') {
    const name = req.params?.name;
    const args = req.params?.arguments || {};
    const result = opts.server === 'memory' ? callMemoryTool(name, args) : callDesktopTool(name, args);
    send({ jsonrpc: '2.0', id: req.id, result });
  } else {
    send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } });
  }
});

