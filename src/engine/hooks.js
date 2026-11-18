'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const platform = require('../platform');

const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];

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

function matcherMatches(matcher, value) {
  const raw = String(matcher || '*').trim();
  if (!raw || raw === '*') return true;
  if (!value) return false;
  if (raw === value) return true;
  try {
    return new RegExp(raw, 'i').test(value);
  } catch {
    return raw.toLowerCase() === String(value).toLowerCase();
  }
}

function runShellHook(command, payload, cwd, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const mergedPath = platform.mergedPath();
    const child = platform.spawnHook(command, {
      cwd: cwd || process.cwd(),
      env: {
        ...process.env,
        PATH: mergedPath,
        Path: mergedPath,
        CAELIX_HOOK_EVENT: String(payload.event || ''),
        CAELIX_PROJECT_DIR: String(cwd || ''),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 1 : (code ?? 0),
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      });
    };
    const timer = setTimeout(() => {
      platform.killTree(child);
      finish(1, true);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 16000) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 8000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      stderr = error.message;
      finish(1);
    });
    child.on('close', (code) => finish(code));
    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch { /* ignore */ }
  });
}

const POSIX_HOOKS = [
  {
    id: 'builtin_shell_guard',
    event: 'PreToolUse',
    matcher: '^bash$',
    command: "/usr/bin/python3 -c 'import json,re,sys; d=json.load(sys.stdin); cmd=(d.get(\"input\") or {}).get(\"command\",\"\"); bad=re.search(r\"(^|[;&|]\\s*)(rm\\s+-[rf]*\\s+(/|~|/Users)|mkfs\\b|diskutil\\s+erase|dd\\s+[^\\n]*of=/dev)\",cmd); bad and (sys.stderr.write(\"Blocked destructive shell command by CAELIX shell-guard hook.\\n\"), sys.exit(2))'",
    enabled: true,
    timeoutMs: 5000,
  },
  {
    id: 'builtin_secret_guard',
    event: 'PreToolUse',
    matcher: '^(write_file|edit_file|multi_edit)$',
    command: "/usr/bin/python3 -c 'import json,os,re,sys; d=json.load(sys.stdin); p=os.path.basename((d.get(\"input\") or {}).get(\"path\",\"\")); re.match(r\"^(\\.env(\\..*)?|.*\\.(pem|key|p12)|id_(rsa|ed25519)|keys\\.enc)$\",p,re.I) and (sys.stderr.write(f\"Blocked modifying secret/key file {p} by CAELIX secret-guard hook.\\n\"), sys.exit(2))'",
    enabled: true,
    timeoutMs: 5000,
  },
  {
    id: 'builtin_syntax_check',
    event: 'PostToolUse',
    matcher: '^(write_file|edit_file|multi_edit)$',
    command: "/usr/bin/python3 -c 'import json,os,subprocess,sys; d=json.load(sys.stdin); p=(d.get(\"input\") or {}).get(\"path\",\"\"); full=os.path.join(d.get(\"cwd\",\".\"), p) if p else \"\";\nif full.endswith(\".json\") and os.path.isfile(full):\n try: json.load(open(full))\n except Exception as e: print(f\"JSON syntax warning in {p}: {e}\")\nelif full.endswith((\".js\",\".mjs\",\".cjs\")) and os.path.isfile(full):\n r=subprocess.run([\"node\",\"--check\",full],capture_output=True,text=True)\n if r.returncode!=0: print((r.stderr or r.stdout).strip()[:400])'",
    enabled: true,
    timeoutMs: 5000,
  },
];

// Windows equivalents: hooks run through PowerShell (see platform.spawnHook),
// and receive the same JSON payload on stdin. Only exit code 2 blocks a tool,
// so an environment problem degrades to "no guard" instead of locking the app.
const WINDOWS_HOOKS = [
  {
    id: 'builtin_shell_guard',
    event: 'PreToolUse',
    matcher: '^bash$',
    command: "$d=[Console]::In.ReadToEnd()|ConvertFrom-Json; $c=[string]$d.input.command; if($c -match '(^|[;&|]\\s*)(rm\\s+-[rf]*\\s+(/|~)|Remove-Item\\s+[^;]*-Recurse|format\\s+[a-z]:|diskpart\\s)'){ [Console]::Error.Write('Blocked destructive shell command by CAELIX shell-guard hook.'); exit 2 }",
    enabled: true,
    timeoutMs: 5000,
  },
  {
    id: 'builtin_secret_guard',
    event: 'PreToolUse',
    matcher: '^(write_file|edit_file|multi_edit)$',
    command: "$d=[Console]::In.ReadToEnd()|ConvertFrom-Json; $p=Split-Path ([string]$d.input.path) -Leaf; if($p -match '^(\\.env(\\..*)?|.*\\.(pem|key|p12)|id_(rsa|ed25519)|keys\\.enc)$'){ [Console]::Error.Write(\"Blocked modifying secret/key file $p by CAELIX secret-guard hook.\"); exit 2 }",
    enabled: true,
    timeoutMs: 5000,
  },
  {
    id: 'builtin_syntax_check',
    event: 'PostToolUse',
    matcher: '^(write_file|edit_file|multi_edit)$',
    command: "$d=[Console]::In.ReadToEnd()|ConvertFrom-Json; $p=[string]$d.input.path; $full=Join-Path ([string]$d.cwd) $p; if($p -match '\\.json$' -and (Test-Path -LiteralPath $full)){ try { Get-Content -LiteralPath $full -Raw | ConvertFrom-Json | Out-Null } catch { Write-Output \"JSON syntax warning in ${p}: $($_.Exception.Message)\" } } elseif($p -match '\\.(js|mjs|cjs)$' -and (Test-Path -LiteralPath $full) -and (Get-Command node -ErrorAction SilentlyContinue)){ node --check $full 2>&1 }",
    enabled: true,
    timeoutMs: 5000,
  },
];

const DEFAULT_HOOKS = platform.IS_WIN ? WINDOWS_HOOKS : POSIX_HOOKS;

class HooksManager {
  constructor(userDataDir) {
    this.userFile = path.join(userDataDir, 'hooks.json');
    this.ensureDefaults();
  }

  ensureDefaults() {
    if (fs.existsSync(this.userFile)) return;
    safeWriteJson(this.userFile, { hooks: DEFAULT_HOOKS });
  }

  projectFile(cwd) {
    return path.join(path.resolve(cwd || process.cwd()), '.caelix', 'hooks.json');
  }

  readFile(file, scope) {
    const data = safeReadJson(file);
    const items = Array.isArray(data?.hooks) ? data.hooks : [];
    return items
      .filter((item) => item && typeof item === 'object' && HOOK_EVENTS.includes(item.event) && item.command)
      .map((item) => ({
        id: item.id || `hook_${crypto.randomUUID().slice(0, 8)}`,
        event: item.event,
        matcher: item.matcher || '*',
        command: String(item.command),
        enabled: item.enabled !== false,
        timeoutMs: Math.min(60000, Math.max(500, Number(item.timeoutMs) || 10000)),
        scope,
      }));
  }

  list(cwd) {
    const userHooks = this.readFile(this.userFile, 'user');
    const projectHooks = cwd ? this.readFile(this.projectFile(cwd), 'project') : [];
    return [...projectHooks, ...userHooks];
  }

  saveHook({ id, event, matcher = '*', command, enabled = true, scope = 'project', timeoutMs = 10000, cwd }) {
    if (!HOOK_EVENTS.includes(event)) throw new Error(`Unsupported hook event: ${event}`);
    const cmd = String(command || '').trim();
    if (!cmd) throw new Error('Hook shell command is required.');
    const file = scope === 'project' ? this.projectFile(cwd) : this.userFile;
    const current = this.readFile(file, scope);
    const hookId = id || `hook_${crypto.randomUUID().slice(0, 8)}`;
    const next = current.filter((item) => item.id !== hookId);
    next.push({
      id: hookId,
      event,
      matcher: String(matcher || '*').trim() || '*',
      command: cmd,
      enabled: enabled !== false,
      timeoutMs: Math.min(60000, Math.max(500, Number(timeoutMs) || 10000)),
    });
    safeWriteJson(file, { hooks: next });
    return this.list(cwd);
  }

  toggleHook({ id, scope = 'project', enabled, cwd }) {
    const file = scope === 'project' ? this.projectFile(cwd) : this.userFile;
    const current = this.readFile(file, scope);
    const target = current.find((item) => item.id === id);
    if (!target) throw new Error('Hook not found.');
    target.enabled = Boolean(enabled);
    safeWriteJson(file, { hooks: current.map(({ scope: _s, ...rest }) => rest) });
    return this.list(cwd);
  }

  removeHook({ id, scope = 'project', cwd }) {
    const file = scope === 'project' ? this.projectFile(cwd) : this.userFile;
    const current = this.readFile(file, scope).filter((item) => item.id !== id);
    safeWriteJson(file, { hooks: current.map(({ scope: _s, ...rest }) => rest) });
    return this.list(cwd);
  }

  async run(event, context = {}) {
    const cwd = context.cwd || process.cwd();
    const matchTarget = context.tool || '';
    const hooks = this.list(cwd).filter((item) => item.enabled && item.event === event && matcherMatches(item.matcher, matchTarget));
    const notes = [];
    for (const hook of hooks) {
      const result = await runShellHook(hook.command, { event, ...context }, cwd, hook.timeoutMs);
      if (result.exitCode === 2) {
        return {
          blocked: true,
          hook,
          reason: result.stderr || result.stdout || `Blocked by ${event} hook.`,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: 2,
        };
      }
      if (result.stdout) notes.push({ hookId: hook.id, command: hook.command, output: result.stdout, exitCode: result.exitCode });
    }
    return { blocked: false, notes };
  }
}

module.exports = { HooksManager, HOOK_EVENTS };

