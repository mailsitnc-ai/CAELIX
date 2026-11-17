// Automatic diagnostics after file writes and edits. Runs fast, read-only
// syntax checks on the touched file and returns short, plain problem lines —
// so a model learns immediately when an edit broke something, instead of
// discovering it turns later from a failed build.
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

// Cached per-process: whether python3 exists.
let pythonState;
function hasPython() {
  if (pythonState === undefined) {
    try { pythonState = spawnSync('python3', ['--version'], { timeout: 5000 }).status === 0; }
    catch { pythonState = false; }
  }
  return pythonState;
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
      JSON.parse(require('fs').readFileSync(file, 'utf8'));
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

// Diagnose up to a few files after a write/edit. Returns '' when clean so the
// tool output can stay short, otherwise a compact block the model can act on.
function diagnose(root, files, maxFiles = 4) {
  const targets = (Array.isArray(files) ? files : [files]).slice(0, maxFiles);
  const lines = [];
  for (const file of targets) {
    try {
      for (const problem of checkFile(root, file)) lines.push(`- ${problem}`);
    } catch { /* never let diagnostics break a successful edit */ }
  }
  if (!lines.length) return '';
  return `\nDiagnostics flagged problems after this edit:\n${lines.join('\n')}\nFix them before claiming the task works.`;
}

module.exports = { checkFile, diagnose };
