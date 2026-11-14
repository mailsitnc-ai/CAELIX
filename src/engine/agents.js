'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const BUILTIN_AGENTS = [
  {
    id: 'explore',
    name: 'Explore',
    description: 'Fast read-only codebase explorer to map files, modules, and symbols.',
    tools: ['read_file', 'list_dir', 'glob', 'grep'],
    readonly: true,
    builtin: true,
    scope: 'builtin',
    prompt: 'You are CAELIX Explore, a fast read-only research agent. Map the project structure, locate relevant files and symbols, and return exact file paths, line numbers, and concrete findings without editing anything.',
  },
  {
    id: 'plan',
    name: 'Plan',
    description: 'Architecture planner that analyzes impact and produces concrete step-by-step plans.',
    tools: ['read_file', 'list_dir', 'glob', 'grep'],
    readonly: true,
    builtin: true,
    scope: 'builtin',
    prompt: 'You are CAELIX Plan, an architecture planning agent. Inspect existing patterns, interfaces, and dependencies, then return a concise step-by-step implementation plan listing files to touch, risks, and verification commands.',
  },
  {
    id: 'review',
    name: 'Code Review',
    description: 'Reviews code and changes for bugs, security risks, edge cases, and regressions.',
    tools: ['read_file', 'list_dir', 'glob', 'grep'],
    readonly: true,
    builtin: true,
    scope: 'builtin',
    prompt: 'You are CAELIX Code Review. Inspect the code and check for correctness bugs, security holes, missing error handling, race conditions, and unhandled edge cases. Cite exact file paths, line numbers, and severity.',
  },
  {
    id: 'verify',
    name: 'Verify',
    description: 'Runs project checks, linters, and tests via read tools and bash, reporting exact results.',
    tools: ['read_file', 'list_dir', 'glob', 'grep', 'bash'],
    readonly: false,
    builtin: true,
    scope: 'builtin',
    prompt: 'You are CAELIX Verify, a verification agent. Locate the project test and check scripts, run them with bash, and report exact pass/fail results, exit codes, and any failure output. Never modify files.',
  },
  {
    id: 'general',
    name: 'General Helper',
    description: 'Open-ended bounded research helper for explanations, docs, and multi-file lookups.',
    tools: ['read_file', 'list_dir', 'glob', 'grep'],
    readonly: true,
    builtin: true,
    scope: 'builtin',
    prompt: 'You are CAELIX General Helper, a bounded research agent. Answer the task concisely using read-only inspection tools and cite observed file paths and facts.',
  },
];

function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom-agent';
}

function parseAgentMarkdown(filePath, scope) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const id = path.basename(filePath, path.extname(filePath));
  let name = id;
  let description = 'Custom agent';
  let tools = ['read_file', 'list_dir', 'glob', 'grep'];
  let body = raw.trim();

  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fm) {
    const header = fm[1];
    body = fm[2].trim();
    for (const line of header.split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
      if (!m) continue;
      const key = m[1].trim().toLowerCase();
      const val = m[2].trim().replace(/^['"]|['"]$/g, '');
      if (key === 'name' && val) name = val;
      else if (key === 'description' && val) description = val;
      else if (key === 'tools' && val) {
        tools = val.split(',').map((t) => t.trim()).filter(Boolean);
      }
    }
  }
  return {
    id,
    name,
    description,
    tools,
    readonly: !tools.includes('bash') && !tools.includes('write_file') && !tools.includes('edit_file'),
    builtin: false,
    scope,
    file: filePath,
    prompt: body || `You are ${name}. Follow user instructions carefully.`,
  };
}

function readAgentDir(dir, scope) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).isFile()) out.push(parseAgentMarkdown(full, scope));
    } catch {
      // skip malformed agent definition
    }
  }
  return out;
}

class AgentRegistry {
  constructor(userDataDir) {
    this.userDir = path.join(userDataDir, 'agents');
  }

  projectDir(cwd) {
    return path.join(path.resolve(cwd || process.cwd()), '.caelix', 'agents');
  }

  list(cwd) {
    const byId = new Map();
    for (const item of BUILTIN_AGENTS) byId.set(item.id, item);

    const claudeUserDir = path.join(os.homedir(), '.claude', 'agents');
    for (const item of readAgentDir(claudeUserDir, 'claude-user')) byId.set(item.id, item);

    const caelixHomeDir = path.join(os.homedir(), '.caelix', 'agents');
    for (const item of readAgentDir(caelixHomeDir, 'user')) byId.set(item.id, item);
    for (const item of readAgentDir(this.userDir, 'user')) byId.set(item.id, item);

    if (cwd) {
      const claudeProjDir = path.join(path.resolve(cwd), '.claude', 'agents');
      for (const item of readAgentDir(claudeProjDir, 'claude-project')) byId.set(item.id, item);
      for (const item of readAgentDir(this.projectDir(cwd), 'project')) byId.set(item.id, item);
    }
    return [...byId.values()];
  }

  get(id, cwd) {
    const clean = String(id || 'explore').trim().toLowerCase();
    const all = this.list(cwd);
    return all.find((a) => a.id.toLowerCase() === clean)
      || all.find((a) => a.name.toLowerCase() === clean)
      || BUILTIN_AGENTS[0];
  }

  saveAgent({ name, description, prompt, tools, scope = 'project', cwd }) {
    const cleanName = String(name || '').trim();
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanName || !cleanPrompt) throw new Error('Agent name and instructions are required.');
    const id = slugify(cleanName);
    const dir = scope === 'project' ? this.projectDir(cwd) : this.userDir;
    fs.mkdirSync(dir, { recursive: true });
    const allowedTools = Array.isArray(tools) && tools.length
      ? tools
      : ['read_file', 'list_dir', 'glob', 'grep'];
    const md = [
      '---',
      `name: ${cleanName}`,
      `description: ${String(description || 'Custom CAELIX agent').replace(/\r?\n/g, ' ')}`,
      `tools: ${allowedTools.join(', ')}`,
      '---',
      '',
      cleanPrompt,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, `${id}.md`), md, 'utf8');
    return this.list(cwd);
  }

  removeAgent({ id, scope = 'project', cwd }) {
    const clean = slugify(id);
    const dir = scope === 'project' ? this.projectDir(cwd) : this.userDir;
    const file = path.join(dir, `${clean}.md`);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    return this.list(cwd);
  }
}

module.exports = { AgentRegistry, BUILTIN_AGENTS };

