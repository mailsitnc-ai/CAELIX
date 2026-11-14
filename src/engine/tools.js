'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { diffLines } = require('./diff');

const MAX_OUTPUT = 60_000;

function truncate(text, limit = MAX_OUTPUT) {
  const value = String(text ?? '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n… truncated ${value.length - limit} characters`;
}

function globToRegExp(pattern) {
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        i += 1;
        if (pattern[i + 1] === '/') i += 1;
        out += '(?:.*/)?';
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  out += '$';
  return new RegExp(out);
}

async function walk(root, options = {}) {
  const { skip = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build']), maxFiles = 4000 } = options;
  const found = [];
  const queue = [root];
  while (queue.length && found.length < maxFiles) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) queue.push(full);
      } else if (entry.isFile()) {
        found.push(full);
        if (found.length >= maxFiles) break;
      }
    }
  }
  return found;
}

function toolDefinitions(root) {
  return [
    {
      name: 'read_file',
      description: 'Read a text file from the project. Returns numbered lines. Use offset and limit for large files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, relative to the project.' },
          offset: { type: 'integer', description: 'First line, 1-based.' },
          limit: { type: 'integer', description: 'Maximum number of lines.' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Create a file or replace its entire contents. A diff is recorded and the user approves it according to the current mode.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'edit_file',
      description: 'Replace an exact string in a file. The old text must occur exactly once unless replace_all is true.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
          replace_all: { type: 'boolean' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    {
      name: 'list_dir',
      description: 'List a directory in the project with entry types and sizes.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
      },
    },
    {
      name: 'glob',
      description: 'Find files in the project by glob pattern, most recently modified first.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'For example **/*.js' },
          path: { type: 'string', description: 'Directory to start from.' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'grep',
      description: 'Search file contents in the project with a regular expression or literal string.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
          include: { type: 'string', description: 'Glob filter such as *.js' },
          literal: { type: 'boolean' },
          max_results: { type: 'integer' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'bash',
      description: 'Run a shell command in the project folder. Captures stdout, stderr and the exit code. Commands requiring an interactive terminal should be avoided.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout_ms: { type: 'integer', description: 'Default 60000, maximum 600000.' },
        },
        required: ['command'],
      },
    },
    {
      name: 'todo_write',
      description: 'Record the visible task list for multi-step work. Replaces the previous list.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                content: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'web_fetch',
      description: 'Fetch a public HTTP or HTTPS page and return its readable text. Requires approval.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
    {
      name: 'multi_edit',
      description: 'Apply several exact-string replacements in one call. Each edit names a file, the unique old text and the replacement. Use this for a coordinated change across files.',
      parameters: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path, relative to the project.' },
                old_string: { type: 'string' },
                new_string: { type: 'string' },
                replace_all: { type: 'boolean' },
              },
              required: ['path', 'old_string', 'new_string'],
            },
          },
        },
        required: ['edits'],
      },
    },
    {
      name: 'task_start',
      description: 'Start a shell command in the background and return its task id and output file. Use task_list to read progress and task_stop to end it.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          label: { type: 'string', description: 'Short name for the task list.' },
          timeout_ms: { type: 'integer', description: 'Optional automatic stop after this many milliseconds.' },
        },
        required: ['command'],
      },
    },
    {
      name: 'task_list',
      description: 'List background tasks started in this project with their status, exit code and recent output.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'task_stop',
      description: 'Stop a running background task by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    {
      name: 'ask_user',
      description: 'Ask the user a question with optional choices and wait for the answer. Use it only when a decision blocks the work.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, description: 'Optional quick choices.' },
          allow_other: { type: 'boolean', description: 'Allow a typed answer as well as the choices.' },
        },
        required: ['question'],
      },
    },
    {
      name: 'present_plan',
      description: 'Show a written plan to the user as a reviewable card without changing any file.',
      parameters: {
        type: 'object',
        properties: {
          plan: { type: 'string', description: 'The plan in Markdown.' },
          title: { type: 'string' },
        },
        required: ['plan'],
      },
    },
    {
      name: 'subagent',
      description: 'Send one focused research task to a read-only child agent. It reads the project with the read-only tools and returns a short summary; it cannot write or run commands.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'What the child agent should find out.' },
          max_rounds: { type: 'integer', description: 'Maximum investigation rounds, default 4.' },
        },
        required: ['task'],
      },
    },
  ].map((tool) => ({ ...tool, description: `${tool.description} The project root is ${root}.` }));
}

class ToolRunner {
  constructor({ root, mode, signal, ask, emit, tasks, questioner }) {
    this.root = path.resolve(root);
    this.mode = mode || 'ask';
    this.signal = signal;
    this.ask = ask;
    this.emit = emit;
    this.tasks = tasks || null;
    this.questioner = questioner || null;
  }

  resolvePath(input, { mustExist = false } = {}) {
    const raw = String(input || '.').trim();
    const target = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(this.root, raw);
    const inside = target === this.root || target.startsWith(`${this.root}${path.sep}`);
    if (!inside) throw new Error(`Refusing to touch a path outside the project: ${raw}`);
    if (mustExist) {
      const real = fs.realpathSync(target);
      const realRoot = fs.realpathSync(this.root);
      if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
        throw new Error('Refusing to follow a link outside the project.');
      }
    }
    return target;
  }

  async permission(tool, action, target, detail, risk = 'normal') {
    if (this.mode === 'plan' && risk !== 'read') return 'deny';
    if (this.mode === 'bypass') return 'allow';
    if (this.mode === 'accept' && (tool === 'write_file' || tool === 'edit_file' || tool === 'multi_edit')) return 'allow';
    const key = `${tool}:${target}`;
    if (this.sessionAllowed?.has(key)) return 'allow';
    const decision = await this.ask({ tool, action, target, detail, risk });
    if (decision === 'session') {
      if (!this.sessionAllowed) this.sessionAllowed = new Set();
      this.sessionAllowed.add(key);
      return 'allow';
    }
    return decision;
  }

  async execute(name, input) {
    if (this.signal?.aborted) throw new Error('Cancelled.');
    switch (name) {
      case 'read_file': return this.readFile(input);
      case 'write_file': return this.writeFile(input);
      case 'edit_file': return this.editFile(input);
      case 'list_dir': return this.listDir(input);
      case 'glob': return this.glob(input);
      case 'grep': return this.grep(input);
      case 'bash': return this.bash(input);
      case 'todo_write': return this.todoWrite(input);
      case 'web_fetch': return this.webFetch(input);
      case 'multi_edit': return this.multiEdit(input);
      case 'task_start': return this.taskStart(input);
      case 'task_list': return this.taskList(input);
      case 'task_stop': return this.taskStop(input);
      case 'ask_user': return this.askUser(input);
      case 'present_plan': return this.presentPlan(input);
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }

  async readFile(input) {
    const file = this.resolvePath(input.path, { mustExist: true });
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) throw new Error('That path is a directory. Use list_dir.');
    if (stat.size > 4_000_000) throw new Error('File is larger than 4 MB.');
    const buffer = await fsp.readFile(file);
    if (buffer.includes(0)) throw new Error('That file looks binary.');
    const lines = buffer.toString('utf8').split('\n');
    const offset = Math.max(1, Number(input.offset) || 1);
    const limit = Math.min(2000, Math.max(1, Number(input.limit) || 2000));
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    return {
      output: slice.map((line, index) => `${String(offset + index).padStart(5)}  ${line}`).join('\n'),
      meta: { lines: lines.length, shown: slice.length },
    };
  }

  async writeFile(input) {
    const file = this.resolvePath(input.path);
    const relative = path.relative(this.root, file);
    let before = '';
    try {
      before = await fsp.readFile(file, 'utf8');
    } catch {
      before = '';
    }
    const after = String(input.content ?? '');
    const decision = await this.permission('write_file', 'Write file', relative, `${after.split('\n').length} lines`, 'write');
    if (decision !== 'allow') throw new Error('The user denied this write.');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, after, 'utf8');
    const diff = diffLines(before, after);
    this.emit?.({
      type: 'change',
      file: relative,
      before,
      after,
      additions: diff.additions,
      deletions: diff.deletions,
    });
    return { output: `Wrote ${relative} (${diff.additions} added, ${diff.deletions} removed).`, change: { file: relative, before, after, ...diff } };
  }

  async editFile(input) {
    const file = this.resolvePath(input.path, { mustExist: true });
    const relative = path.relative(this.root, file);
    const before = await fsp.readFile(file, 'utf8');
    const oldString = String(input.old_string ?? '');
    const newString = String(input.new_string ?? '');
    if (!oldString) throw new Error('old_string must not be empty.');
    const count = before.split(oldString).length - 1;
    if (count === 0) throw new Error('The old text was not found.');
    if (count > 1 && !input.replace_all) throw new Error(`The old text occurs ${count} times. Provide more context or set replace_all.`);
    const after = input.replace_all ? before.split(oldString).join(newString) : before.replace(oldString, newString);
    const decision = await this.permission('edit_file', 'Edit file', relative, `${count} replacement(s)`, 'write');
    if (decision !== 'allow') throw new Error('The user denied this edit.');
    await fsp.writeFile(file, after, 'utf8');
    const diff = diffLines(before, after);
    this.emit?.({
      type: 'change',
      file: relative,
      before,
      after,
      additions: diff.additions,
      deletions: diff.deletions,
    });
    return { output: `Edited ${relative} (${diff.additions} added, ${diff.deletions} removed).`, change: { file: relative, before, after, ...diff } };
  }

  async multiEdit(input) {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    if (!edits.length) throw new Error('Provide at least one edit.');
    const byFile = new Map();
    for (const edit of edits) {
      const file = this.resolvePath(edit.path, { mustExist: true });
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(edit);
    }
    const planned = [];
    for (const [file, fileEdits] of byFile) {
      const before = await fsp.readFile(file, 'utf8');
      let after = before;
      for (const edit of fileEdits) {
        const oldString = String(edit.old_string ?? '');
        const newString = String(edit.new_string ?? '');
        if (!oldString) throw new Error(`An empty old_string was given for ${path.relative(this.root, file)}.`);
        const count = after.split(oldString).length - 1;
        if (count === 0) throw new Error(`The old text was not found in ${path.relative(this.root, file)}.`);
        if (count > 1 && !edit.replace_all) throw new Error(`The old text occurs ${count} times in ${path.relative(this.root, file)}. Provide more context or set replace_all.`);
        after = edit.replace_all ? after.split(oldString).join(newString) : after.replace(oldString, newString);
      }
      planned.push({ file, before, after });
    }
    const changed = planned.filter((item) => item.before !== item.after);
    if (!changed.length) return { output: 'No file changed.', meta: { files: 0 } };
    const decision = await this.permission(
      'multi_edit',
      'Edit files',
      changed.map((item) => path.relative(this.root, item.file)).join(', '),
      `${edits.length} replacement(s) in ${changed.length} file(s)`,
      'write',
    );
    if (decision !== 'allow') throw new Error('The user denied this multi-file edit.');
    const summary = [];
    for (const item of changed) {
      await fsp.writeFile(item.file, item.after, 'utf8');
      const relative = path.relative(this.root, item.file);
      const diff = diffLines(item.before, item.after);
      this.emit?.({
        type: 'change',
        file: relative,
        before: item.before,
        after: item.after,
        additions: diff.additions,
        deletions: diff.deletions,
      });
      summary.push(`${relative} (+${diff.additions} −${diff.deletions})`);
    }
    return { output: `Edited ${summary.join(', ')}.`, meta: { files: changed.length } };
  }

  async listDir(input) {
    const dir = this.resolvePath(input.path || '.', { mustExist: true });
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const lines = [];
    for (const entry of entries.slice(0, 400)) {
      const full = path.join(dir, entry.name);
      let size = '';
      try {
        const stat = await fsp.stat(full);
        size = entry.isDirectory() ? '' : `${stat.size} B`;
      } catch {
        size = '';
      }
      lines.push(`${entry.isDirectory() ? 'dir ' : 'file'}  ${entry.name}${size ? `  ${size}` : ''}`);
    }
    return { output: lines.join('\n') || '(empty folder)', meta: { count: entries.length } };
  }

  async glob(input) {
    const start = this.resolvePath(input.path || '.', { mustExist: true });
    const regex = globToRegExp(String(input.pattern || '*'));
    const files = await walk(start);
    const matched = [];
    for (const file of files) {
      const relative = path.relative(this.root, file);
      if (regex.test(relative) || regex.test(path.basename(file))) {
        const stat = await fsp.stat(file);
        matched.push({ relative, mtime: stat.mtimeMs });
      }
    }
    matched.sort((a, b) => b.mtime - a.mtime);
    const capped = matched.slice(0, 300);
    return { output: capped.map((item) => item.relative).join('\n') || 'No files matched.', meta: { count: matched.length } };
  }

  async grep(input) {
    const start = this.resolvePath(input.path || '.', { mustExist: true });
    const literal = Boolean(input.literal);
    const pattern = literal
      ? String(input.pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      : String(input.pattern);
    let regex;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (error) {
      throw new Error(`Invalid pattern: ${error.message}`);
    }
    const include = input.include ? globToRegExp(String(input.include)) : null;
    const max = Math.min(500, Number(input.max_results) || 200);
    const files = await walk(start);
    const results = [];
    for (const file of files) {
      const relative = path.relative(this.root, file);
      if (include && !include.test(path.basename(file)) && !include.test(relative)) continue;
      let stat;
      try {
        stat = await fsp.stat(file);
      } catch {
        continue;
      }
      if (stat.size > 1_000_000) continue;
      let text;
      try {
        const buffer = await fsp.readFile(file);
        if (buffer.includes(0)) continue;
        text = buffer.toString('utf8');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (regex.test(lines[i])) {
          results.push(`${relative}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
          if (results.length >= max) break;
        }
      }
      if (results.length >= max) break;
    }
    return { output: results.join('\n') || 'No matches.', meta: { count: results.length } };
  }

  async bash(input) {
    const command = String(input.command || '').trim();
    if (!command) throw new Error('Command is empty.');
    const decision = await this.permission('bash', 'Run command', this.root, command.slice(0, 300), 'shell');
    if (decision !== 'allow') throw new Error('The user denied this command.');
    const timeout = Math.min(600000, Math.max(1000, Number(input.timeout_ms) || 60000));
    return new Promise((resolve, reject) => {
      const child = spawn('/bin/zsh', ['-lc', command], {
        cwd: this.root,
        env: { ...process.env, CAELIX: '1', TERM: 'dumb' },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (result, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.signal) this.signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
        this.emit?.({ type: 'terminal-output', text: `\n[timed out after ${timeout} ms]\n` });
        finish({ output: truncate(`${stdout}${stderr}`), meta: { exitCode: null, timedOut: true } });
      }, timeout);
      const abort = () => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
        this.emit?.({ type: 'terminal-output', text: '\n[cancelled]\n' });
        finish({ output: truncate(`${stdout}${stderr}`), meta: { exitCode: null, cancelled: true } });
      };
      if (this.signal) {
        if (this.signal.aborted) return abort();
        this.signal.addEventListener('abort', abort, { once: true });
      }
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (stdout.length < 400_000) this.emit?.({ type: 'terminal-output', text });
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (stderr.length < 400_000) this.emit?.({ type: 'terminal-output', text });
      });
      child.on('error', (error) => finish(null, error));
      child.on('close', (code) => {
        finish({
          output: truncate(`${stdout}${stderr}`),
          meta: { exitCode: code, command },
        });
      });
    });
  }

  async todoWrite(input) {
    const items = Array.isArray(input.items) ? input.items : [];
    this.emit?.({ type: 'todos', items });
    return { output: `Updated ${items.length} task(s).`, todos: items };
  }

  async taskStart(input) {
    if (!this.tasks) throw new Error('Background tasks are not available on this surface.');
    const command = String(input.command || '').trim();
    if (!command) throw new Error('Command is empty.');
    const decision = await this.permission('task_start', 'Start background task', command.slice(0, 160), command.slice(0, 300), 'shell');
    if (decision !== 'allow') throw new Error('The user denied this background task.');
    const task = this.tasks.start({
      command,
      cwd: this.root,
      label: input.label,
      timeoutMs: Math.min(3_600_000, Math.max(0, Number(input.timeout_ms) || 0)),
    });
    this.emit?.({ type: 'task-started', task });
    return {
      output: `Started ${task.id}: ${command}\nStatus: ${task.status}\nOutput file: ${task.outputFile}`,
      meta: { taskId: task.id, outputFile: task.outputFile },
    };
  }

  async taskList() {
    if (!this.tasks) return { output: 'No background tasks.', meta: { count: 0 } };
    const tasks = this.tasks.list();
    if (!tasks.length) return { output: 'No background tasks.', meta: { count: 0 } };
    const lines = tasks.map((task) => [
      `${task.id}  ${task.status}${task.exitCode === null ? '' : ` (exit ${task.exitCode})`}`,
      `  ${task.command}`,
      task.recent ? `  ${task.recent.trim().split('\n').slice(-4).join('\n  ')}` : '',
    ].filter(Boolean).join('\n'));
    return { output: lines.join('\n\n'), meta: { count: tasks.length } };
  }

  async taskStop(input) {
    if (!this.tasks) throw new Error('Background tasks are not available on this surface.');
    const id = String(input.id || '').trim();
    if (!id) throw new Error('A task id is required.');
    const task = this.tasks.stop(id);
    if (!task) throw new Error(`No task with id ${id}.`);
    this.emit?.({ type: 'task-stopped', task });
    return { output: `Stopped ${id}.`, meta: { taskId: id } };
  }

  async askUser(input) {
    const question = String(input.question || '').trim();
    if (!question) throw new Error('A question is required.');
    if (!this.questioner) throw new Error('This surface cannot ask the user a question.');
    const options = Array.isArray(input.options) ? input.options.map((option) => String(option)).slice(0, 8) : [];
    const answer = await this.questioner({
      question,
      options,
      allowOther: input.allow_other !== false,
    });
    if (this.signal?.aborted) throw new Error('Cancelled.');
    return { output: `The user answered: ${answer}`, meta: { answer } };
  }

  async presentPlan(input) {
    const plan = String(input.plan || '').trim();
    if (!plan) throw new Error('The plan is empty.');
    const title = String(input.title || 'Plan');
    this.emit?.({ type: 'plan', title, plan });
    return { output: `The plan "${title}" was shown to the user.`, meta: { chars: plan.length } };
  }

  async webFetch(input) {
    const url = String(input.url || '');
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http and https URLs are allowed.');
    const decision = await this.permission('web_fetch', 'Fetch page', url, url, 'network');
    if (decision !== 'allow') throw new Error('The user denied this fetch.');
    const response = await fetch(url, { signal: this.signal, redirect: 'follow' });
    const type = response.headers.get('content-type') || '';
    const body = await response.text();
    let text = body;
    if (type.includes('html')) {
      text = body
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return {
      output: truncate(`HTTP ${response.status} ${response.url}\n\n${text}`, 30_000),
      meta: { status: response.status, type },
    };
  }
}

class TaskRegistry {
  constructor(directory) {
    this.directory = directory || path.join(os.tmpdir(), 'caelix-tasks');
    this.tasks = new Map();
  }

  start({ command, cwd, label, timeoutMs = 0 } = {}) {
    fs.mkdirSync(this.directory, { recursive: true });
    const id = `task_${crypto.randomBytes(4).toString('hex')}`;
    const outputFile = path.join(this.directory, `${id}.log`);
    const stream = fs.createWriteStream(outputFile, { flags: 'a' });
    const child = spawn('/bin/zsh', ['-lc', String(command)], {
      cwd,
      env: { ...process.env, CAELIX: '1', TERM: 'dumb' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const task = {
      id,
      command: String(command),
      label: label ? String(label) : '',
      cwd,
      outputFile,
      child,
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
      recent: '',
    };
    const capture = (chunk) => {
      const text = chunk.toString();
      stream.write(text);
      task.recent = `${task.recent}${text}`.slice(-4000);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (error) => {
      task.status = 'failed';
      task.error = error.message;
      task.endedAt = Date.now();
      stream.end(`\n[error] ${error.message}\n`);
    });
    child.on('close', (code, signal) => {
      task.status = code === 0 ? 'done' : 'failed';
      task.exitCode = code;
      task.signal = signal || null;
      task.endedAt = Date.now();
      stream.end();
    });
    if (timeoutMs > 0) {
      const timer = setTimeout(() => this.stop(id), timeoutMs);
      if (timer.unref) timer.unref();
    }
    this.tasks.set(id, task);
    return this.summary(task);
  }

  summary(task) {
    return {
      id: task.id,
      label: task.label,
      command: task.command,
      status: task.status,
      exitCode: task.exitCode,
      outputFile: task.outputFile,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      recent: task.recent.slice(-1500),
      error: task.error || null,
    };
  }

  list() {
    return [...this.tasks.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((task) => this.summary(task));
  }

  stop(id) {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (task.status === 'running') {
      try { process.kill(-task.child.pid, 'SIGTERM'); } catch { /* already gone */ }
      const force = setTimeout(() => {
        try { process.kill(-task.child.pid, 'SIGKILL'); } catch { /* already gone */ }
      }, 1200);
      if (force.unref) force.unref();
      task.status = 'stopped';
      task.endedAt = Date.now();
    }
    return this.summary(task);
  }
}

module.exports = { ToolRunner, TaskRegistry, toolDefinitions };
