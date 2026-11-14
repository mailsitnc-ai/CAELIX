'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function safeWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function sanitizePart(name) {
  return String(name || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

class StdioMcpClient {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.tools = [];
    this.error = null;
    this.connected = false;
  }

  async connect(cwd) {
    if (this.connected && this.child && !this.child.killed) return this.tools;
    this.close();
    const command = String(this.config.command || '').trim();
    if (!command) throw new Error(`MCP server "${this.name}" has no command.`);
    const args = Array.isArray(this.config.args) ? this.config.args.map(String) : [];
    const env = { ...process.env, ...(this.config.env || {}) };
    this.child = spawn(command, args, {
      cwd: cwd || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    this.child.stdout.on('data', (chunk) => this.onData(chunk.toString('utf8')));
    this.child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000);
    });
    this.child.on('error', (error) => {
      this.error = error.message;
      this.rejectAll(error);
    });
    this.child.on('close', (code) => {
      this.connected = false;
      this.rejectAll(new Error(stderr.trim() || `MCP server "${this.name}" exited (${code ?? 'closed'}).`));
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'CAELIX', version: '1.0.0' },
    });
    this.notify('notifications/initialized', {});
    const list = await this.request('tools/list', {});
    this.tools = Array.isArray(list?.tools) ? list.tools : [];
    this.connected = true;
    this.error = null;
    return this.tools;
  }

  onData(text) {
    this.buffer += text;
    let idx = this.buffer.indexOf('\n');
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) {
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const entry = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            clearTimeout(entry.timer);
            if (msg.error) entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            else entry.resolve(msg.result);
          }
        } catch {
          // ignore non-JSON diagnostic stdout
        }
      }
      idx = this.buffer.indexOf('\n');
    }
  }

  rejectAll(error) {
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  notify(method, params) {
    if (!this.child?.stdin?.writable) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  request(method, params, timeoutMs = 15000) {
    if (!this.child?.stdin?.writable) return Promise.reject(new Error(`MCP server "${this.name}" is not running.`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request "${method}" timed out.`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async callTool(toolName, args, timeoutMs = 45000) {
    return this.request('tools/call', { name: toolName, arguments: args || {} }, timeoutMs);
  }

  close() {
    this.connected = false;
    this.rejectAll(new Error('MCP server closed.'));
    if (this.child && !this.child.killed) {
      try { this.child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    this.child = null;
  }
}

class HttpMcpClient {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.tools = [];
    this.connected = false;
    this.error = null;
    this.nextId = 1;
  }

  async rpc(method, params, signal) {
    const url = String(this.config.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error(`MCP server "${this.name}" has an invalid URL.`);
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.config.headers || {}),
    };
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
      signal,
    });
    if (!response.ok) throw new Error(`MCP server "${this.name}" returned HTTP ${response.status}.`);
    const text = await response.text();
    let payload = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          try { payload = JSON.parse(trimmed.slice(5).trim()); } catch { /* skip */ }
        }
      }
    } else {
      payload = JSON.parse(text);
    }
    if (!payload) throw new Error(`MCP server "${this.name}" returned an empty response.`);
    if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
    return payload.result;
  }

  async connect() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      await this.rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'CAELIX', version: '1.0.0' },
      }, controller.signal);
      const list = await this.rpc('tools/list', {}, controller.signal);
      this.tools = Array.isArray(list?.tools) ? list.tools : [];
      this.connected = true;
      this.error = null;
      return this.tools;
    } finally {
      clearTimeout(timer);
    }
  }

  async callTool(toolName, args, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.rpc('tools/call', { name: toolName, arguments: args || {} }, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  close() {
    this.connected = false;
  }
}

class McpManager {
  constructor(userDataDir) {
    this.userFile = path.join(userDataDir, 'mcp.json');
    this.clients = new Map();
    this.toolMap = new Map();
  }

  projectFile(cwd) {
    return path.join(path.resolve(cwd || process.cwd()), '.mcp.json');
  }

  listConfigs(cwd) {
    const out = [];
    const globalCfg = safeReadJson(this.userFile)?.mcpServers || {};
    for (const [name, cfg] of Object.entries(globalCfg)) {
      if (cfg && typeof cfg === 'object') {
        out.push({ name, scope: 'user', enabled: cfg.enabled !== false, ...cfg });
      }
    }
    if (cwd) {
      const projCfg = safeReadJson(this.projectFile(cwd))?.mcpServers || {};
      for (const [name, cfg] of Object.entries(projCfg)) {
        if (cfg && typeof cfg === 'object') {
          out.push({ name, scope: 'project', enabled: cfg.enabled !== false, ...cfg });
        }
      }
    }
    return out;
  }

  saveServer({ name, scope = 'user', cwd, command, args, env, url, headers, enabled = true }) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Server name is required.');
    const file = scope === 'project' ? this.projectFile(cwd) : this.userFile;
    const data = safeReadJson(file) || { mcpServers: {} };
    if (!data.mcpServers || typeof data.mcpServers !== 'object') data.mcpServers = {};
    const entry = { enabled: enabled !== false };
    if (url && String(url).trim()) {
      entry.url = String(url).trim();
      if (headers && Object.keys(headers).length) entry.headers = headers;
    } else {
      const cmd = String(command || '').trim();
      if (!cmd) throw new Error('Provide either a command or a URL.');
      entry.command = cmd;
      if (Array.isArray(args) && args.length) entry.args = args.map(String);
      if (env && Object.keys(env).length) entry.env = env;
    }
    data.mcpServers[clean] = entry;
    safeWriteJson(file, data);
    this.resetServer(`${scope}:${clean}`);
    return this.listConfigs(cwd);
  }

  toggleServer({ name, scope = 'user', cwd, enabled }) {
    const file = scope === 'project' ? this.projectFile(cwd) : this.userFile;
    const data = safeReadJson(file);
    if (!data?.mcpServers?.[name]) throw new Error(`MCP server "${name}" not found.`);
    data.mcpServers[name].enabled = Boolean(enabled);
    safeWriteJson(file, data);
    this.resetServer(`${scope}:${name}`);
    return this.listConfigs(cwd);
  }

  removeServer({ name, scope = 'user', cwd }) {
    const file = scope === 'project' ? this.projectFile(cwd) : this.userFile;
    const data = safeReadJson(file);
    if (data?.mcpServers?.[name]) {
      delete data.mcpServers[name];
      safeWriteJson(file, data);
    }
    this.resetServer(`${scope}:${name}`);
    return this.listConfigs(cwd);
  }

  resetServer(key) {
    const existing = this.clients.get(key);
    if (existing) {
      existing.client.close();
      this.clients.delete(key);
    }
  }

  getClient(server) {
    const key = `${server.scope}:${server.name}`;
    const sig = JSON.stringify({ cmd: server.command, args: server.args, env: server.env, url: server.url, headers: server.headers });
    const cached = this.clients.get(key);
    if (cached && cached.sig === sig) return cached.client;
    if (cached) cached.client.close();
    const client = server.url
      ? new HttpMcpClient(server.name, server)
      : new StdioMcpClient(server.name, server);
    this.clients.set(key, { sig, client });
    return client;
  }

  async status(cwd) {
    const configs = this.listConfigs(cwd);
    const activeKeys = new Set(configs.map((s) => `${s.scope}:${s.name}`));
    for (const [key] of this.clients) {
      if (!activeKeys.has(key)) this.resetServer(key);
    }
    this.toolMap.clear();
    const rows = [];
    for (const server of configs) {
      if (!server.enabled) {
        this.resetServer(`${server.scope}:${server.name}`);
        rows.push({ ...server, connected: false, tools: [], error: null });
        continue;
      }
      const client = this.getClient(server);
      try {
        const tools = await client.connect(cwd);
        const mapped = tools.map((tool) => {
          const fullName = `mcp__${sanitizePart(server.name)}__${sanitizePart(tool.name)}`;
          this.toolMap.set(fullName, { server, client, toolName: tool.name, definition: tool });
          return { name: fullName, rawName: tool.name, description: tool.description || '' };
        });
        rows.push({ ...server, connected: true, tools: mapped, error: null });
      } catch (error) {
        rows.push({ ...server, connected: false, tools: [], error: error.message });
      }
    }
    return rows;
  }

  async toolDefinitions(cwd) {
    await this.status(cwd);
    const defs = [];
    for (const [fullName, entry] of this.toolMap) {
      const schema = entry.definition.inputSchema && typeof entry.definition.inputSchema === 'object'
        ? entry.definition.inputSchema
        : { type: 'object', properties: {} };
      defs.push({
        name: fullName,
        description: `[MCP ${entry.server.name}] ${entry.definition.description || entry.toolName}`,
        parameters: schema,
      });
    }
    return defs;
  }

  isMcpTool(name) {
    return this.toolMap.has(name) || String(name).startsWith('mcp__');
  }

  async callTool(fullName, input, cwd) {
    if (!this.toolMap.has(fullName)) await this.status(cwd);
    const entry = this.toolMap.get(fullName);
    if (!entry) throw new Error(`MCP tool "${fullName}" is not available.`);
    const result = await entry.client.callTool(entry.toolName, input);
    const parts = Array.isArray(result?.content)
      ? result.content.map((part) => (part.type === 'text' ? part.text : JSON.stringify(part)))
      : [typeof result === 'string' ? result : JSON.stringify(result, null, 2)];
    const text = parts.join('\n').trim() || '(empty MCP result)';
    if (result?.isError) throw new Error(text);
    return {
      output: text.slice(0, 40000),
      meta: { server: entry.server.name, tool: entry.toolName },
    };
  }

  dispose() {
    for (const key of [...this.clients.keys()]) this.resetServer(key);
  }
}

module.exports = { McpManager };

