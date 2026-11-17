// Automatic diagnostics after file writes and edits.
//
// Fast pass: per-file syntax checks (node --check, JSON.parse, py_compile)
// that return in milliseconds, so the model learns immediately when an edit
// broke something.
//
// Deep pass: project-wide checks that catch cross-file breakage the fast
// pass cannot see — `tsc --noEmit` when the project is TypeScript and a
// local compiler exists, ESLint on the touched files when the project has a
// config and a local binary, plus a hint of the project's test command.
// A changed function signature shows up as errors in OTHER files — exactly
// what a small model needs to see right after the edit, not turns later.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let pythonState;
function hasPython() {
  if (pythonState === undefined) {
    try { pythonState = spawnSync('python3', ['--version'], { timeout: 5000 }).status === 0; }
    catch { pythonState = false; }
  }
  return pythonState;
}

// Cached per-process: whether a binary exists under node_modules/.bin (root or parent monorepo).
const binCache = new Map();
function localBin(root, name) {
  const key = `${root}:${name}`;
  if (binCache.has(key)) return binCache.get(key);
  const candidates = [
    path.join(root, 'node_modules', '.bin', name),
    path.join(path.dirname(root), 'node_modules', '.bin', name),
    path.join(root, '.venv', 'bin', name),
    path.join(root, 'venv', 'bin', name),
  ];
  for (const file of candidates) {
    for (const variant of [file, `${file}.cmd`, `${file}.ps1`]) {
      if (fs.existsSync(variant)) {
        binCache.set(key, variant);
        return variant;
      }
    }
  }
  binCache.set(key, null);
  return null;
}

// Check one file. Returns an array of short problem strings (empty = clean).
function checkFile(root, file) {
  const problems = [];
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  const ext = path.extname(file).toLowerCase();

  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    try {
      const result = spawnSync('node', ['--check', file], { timeout: 10_000, encoding: 'utf8' });
      if (result.status !== 0 && result.stderr) {
        const first = result.stderr.split('\n').filter(Boolean).slice(0, 2).join(' | ');
        problems.push(`node --check: ${first.slice(0, 300)}`);
      }
    } catch { /* node missing — skip silently */ }
  } else if (ext === '.json') {
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      problems.push(`JSON: ${String(error.message).split('\n')[0].slice(0, 200)}`);
    }
  } else if (ext === '.py' && hasPython()) {
    try {
      const result = spawnSync('python3', ['-m', 'py_compile', file], { timeout: 10_000, encoding: 'utf8' });
      if (result.status !== 0 && result.stderr) {
        const first = result.stderr.split('\n').filter(Boolean).slice(0, 2).join(' | ');
        problems.push(`python: ${first.slice(0, 300)}`);
      }
    } catch { /* python missing — skip silently */ }
  }
  void relative;
  return problems;
}

// TypeScript / jsconfig project check. Always runs fresh against disk so sequential
// edit + fix steps never see stale cached errors. Returns { inTouched, elsewhere }.
function typeScriptCheck(root, touched) {
  const hasTsconfig = fs.existsSync(path.join(root, 'tsconfig.json'));
  const hasJsconfig = !hasTsconfig && fs.existsSync(path.join(root, 'jsconfig.json'));
  const tsc = localBin(root, 'tsc');
  if ((!hasTsconfig && !hasJsconfig) || !tsc) return null;
  const args = hasJsconfig ? ['--project', 'jsconfig.json', '--noEmit', '--pretty', 'false'] : ['--noEmit', '--pretty', 'false'];
  const result = spawnSync(tsc, args, {
    cwd: root, timeout: 30_000, encoding: 'utf8',
  });
  const out = `${result.stdout || ''}\n${result.stderr || ''}`;
  const errors = out.split('\n')
    .filter((line) => /\(.*\): error TS\d+/.test(line))
    .map((line) => line.replace(/\s+error (TS\d+):\s*/, ' $1: ').trim());
  return scoreErrors(errors, root, touched);
}

// Lightweight project-wide checks for Python (.venv ruff/pyright/mypy), Go (go vet), or Rust (cargo check).
function ecosystemCheck(root, codeFiles) {
  const problems = [];
  const hasPy = codeFiles.some((f) => f.endsWith('.py'));
  if (hasPy) {
    const ruff = localBin(root, 'ruff');
    const pyTargets = codeFiles.filter((f) => f.endsWith('.py')).map((f) => (path.isAbsolute(f) ? path.relative(root, f) : f));
    if (ruff && pyTargets.length) {
      const r = spawnSync(ruff, ['check', '--output-format', 'concise', ...pyTargets], { cwd: root, timeout: 12_000, encoding: 'utf8' });
      if (r.status !== 0 && r.stdout) {
        for (const line of r.stdout.split('\n').filter(Boolean).slice(0, 6)) {
          problems.push(`ruff: ${line.trim()}`);
        }
      }
    }
    const pyright = localBin(root, 'pyright');
    if (pyright) {
      const r = spawnSync(pyright, ['--outputjson'], { cwd: root, timeout: 25_000, encoding: 'utf8' });
      try {
        const parsed = JSON.parse(r.stdout || '{}');
        for (const diag of (parsed.generalDiagnostics || []).filter((d) => d.severity === 'error').slice(0, 6)) {
          const rel = diag.file ? path.relative(root, diag.file) : '';
          problems.push(`pyright ${rel}:${(diag.range?.start?.line ?? 0) + 1}: ${diag.message}`);
        }
      } catch { /* ignore JSON parse issue */ }
    }
  }
  if (codeFiles.some((f) => f.endsWith('.go')) && fs.existsSync(path.join(root, 'go.mod'))) {
    const r = spawnSync('go', ['vet', './...'], { cwd: root, timeout: 20_000, encoding: 'utf8' });
    if (r.status !== 0 && (r.stderr || r.stdout)) {
      for (const line of `${r.stderr || ''}\n${r.stdout || ''}`.split('\n').filter((l) => /\.go:\d+/.test(l)).slice(0, 6)) {
        problems.push(`go vet: ${line.trim()}`);
      }
    }
  }
  if (codeFiles.some((f) => f.endsWith('.rs')) && fs.existsSync(path.join(root, 'Cargo.toml'))) {
    const r = spawnSync('cargo', ['check', '--message-format=short', '--quiet'], { cwd: root, timeout: 25_000, encoding: 'utf8' });
    if (r.status !== 0 && (r.stderr || r.stdout)) {
      for (const line of `${r.stderr || ''}\n${r.stdout || ''}`.split('\n').filter((l) => /error(\[|\]|:)/.test(l)).slice(0, 6)) {
        problems.push(`cargo check: ${line.trim()}`);
      }
    }
  }
  return problems;
}

function scoreErrors(errors, root, touched) {
  const rel = (file) => path.relative(root, file).replace(/\\/g, '/');
  const touchedSet = new Set(touched.map((file) => rel(file)));
  const inTouched = [];
  const elsewhere = [];
  for (const line of errors) {
    const file = line.split('(')[0].trim();
    (touchedSet.has(file) ? inTouched : elsewhere).push(line);
  }
  return { inTouched, elsewhere };
}

// ESLint on the touched files, using the project's own config and binary.
function eslintCheck(root, touched) {
  const eslint = localBin(root, 'eslint');
  if (!eslint) return null;
  const hasConfig = fs.readdirSync(root).some((name) => /^\.eslintrc(\.|$)/.test(name) || /^eslint\.config\./.test(name));
  if (!hasConfig) return null;
  const targets = touched.slice(0, 4).map((file) => (path.isAbsolute(file) ? path.relative(root, file) : file));
  const result = spawnSync(eslint, ['--no-warn-ignored', '--format', 'json', ...targets], {
    cwd: root, timeout: 15_000, encoding: 'utf8',
  });
  let parsed;
  try { parsed = JSON.parse(result.stdout || '[]'); } catch { return { problems: [] }; }
  const problems = [];
  for (const entry of parsed || []) {
    for (const message of entry.messages || []) {
      const severity = message.severity === 2 ? 'error' : 'warn';
      problems.push(`eslint ${entry.filePath ? path.relative(root, entry.filePath) : ''}:${message.line || 0} ${severity}: ${message.message}`);
      if (problems.length >= 6) break;
    }
    if (problems.length >= 6) break;
  }
  return { problems };
}

// Project test command hint, so the model knows how to prove its work.
function testCommandHint(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg?.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
      return 'Project test command: `npm test` — run it before claiming the task works.';
    }
  } catch { /* no package.json */ }
  if (fs.existsSync(path.join(root, 'pytest.ini')) || fs.existsSync(path.join(root, 'setup.cfg'))) {
    return 'Project test command: `python3 -m pytest -q` — run it before claiming the task works.';
  }
  if (fs.existsSync(path.join(root, 'Makefile'))) {
    try {
      const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
      if (/^test:/m.test(makefile)) return 'Project test command: `make test` — run it before claiming the task works.';
    } catch { /* unreadable Makefile */ }
  }
  return '';
}

// Deep, project-wide pass. Returns { problems: string[], hint: string }.
function deepCheck(root, files) {
  const codeFiles = files.filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/i.test(file));
  if (!codeFiles.length) return { problems: [], hint: '' };
  const problems = [];

  const ts = typeScriptCheck(root, files);
  if (ts) {
    for (const line of ts.inTouched.slice(0, 8)) problems.push(`- tsc: ${line.slice(0, 240)}`);
    if (ts.inTouched.length > 8) problems.push(`- tsc: …and ${ts.inTouched.length - 8} more error(s) in the touched files`);
    if (ts.elsewhere.length) {
      // Cross-file breakage lives here: a changed signature shows up in files
      // that were not touched. Label it clearly so the model fixes broken callers too.
      problems.push(`- tsc: ${ts.elsewhere.length} error(s) in other files (likely broken by this edit; may be pre-existing):`);
      for (const line of ts.elsewhere.slice(0, 6)) problems.push(`  ${line.slice(0, 220)}`);
    }
  }

  const eslint = eslintCheck(root, codeFiles);
  if (eslint?.problems?.length) {
    for (const line of eslint.problems) problems.push(`- ${line.slice(0, 240)}`);
  }

  for (const line of ecosystemCheck(root, codeFiles)) {
    problems.push(`- ${line.slice(0, 240)}`);
  }

  return { problems, hint: testCommandHint(root) };
}

// Diagnose up to a few files after a write/edit. Returns '' when clean and no test hint applies,
// or a single deduplicated diagnostic block the model can immediately act on.
function diagnose(root, files, maxFiles = 4) {
  const targets = (Array.isArray(files) ? files : [files]).slice(0, maxFiles);
  const lines = [];
  for (const file of targets) {
    try {
      for (const problem of checkFile(root, file)) lines.push(`- ${problem}`);
    } catch { /* never let diagnostics break a successful edit */ }
  }
  let deep = { problems: [], hint: '' };
  try { deep = deepCheck(root, targets); } catch { /* deep checks are best-effort */ }
  const allProblems = [...lines, ...deep.problems];
  if (allProblems.length) {
    return `\nDiagnostics flagged problems after this edit:\n${allProblems.join('\n')}\nFix them before claiming the task works.${deep.hint ? `\n${deep.hint}` : ''}`;
  }
  return deep.hint ? `\n${deep.hint}` : '';
}

module.exports = { checkFile, diagnose, deepCheck, testCommandHint };
