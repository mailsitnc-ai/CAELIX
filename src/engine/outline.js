// Repo symbol map: a compact "which file exports what" outline of the
// project, built once and cached, then injected into the system prompt.
//
// Why: free models get no prompt caching and lose the thread on 20+ step
// refactors across many files. A 2-4k char map of exported symbols lets the
// model see the shape of the repo without reading every file, so it plans
// cross-file edits correctly the first time. This is the cheap stand-in for
// the project awareness a flagship model gets from its own long memory.
'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next',
  'vendor', '__pycache__', '.venv', 'venv', 'checks', '.caelix',
]);
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs']);
const MAX_FILES = 300;
const MAX_DEPTH = 7;
const MAX_FILE_BYTES = 24_000;
const MAX_CHARS = 4500;

// Extract exported/top-level symbols from one file's head.
function symbolsIn(file, source) {
  const symbols = new Set();
  const add = (name) => {
    if (name && name !== 'default' && name.length <= 44) symbols.add(name);
  };
  for (const m of source.matchAll(/(?:^|\n)\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/g)) add(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*class\s+([A-Za-z_][\w]*)/g)) add(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*func\s+(?:\([^)]*\)\s+)?([A-Z][\w]*)/g)) add(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*type\s+([A-Z][\w]*)\s+(?:struct|interface)\b/g)) add(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*pub\s+(?:async\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_][\w]*)/g)) add(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*exports\.([A-Za-z_$][\w$]*)\s*=/g)) add(m[1]);
  const moduleExports = source.match(/module\.exports\s*=\s*\{([^}]*)\}/);
  if (moduleExports) {
    for (const part of moduleExports[1].split(',')) {
      const name = part.split(':')[0].trim().replace(/^\.\.\./, '');
      add(name);
    }
  }
  const namedExports = source.match(/(?:^|\n)\s*export\s*\{([^}]+)\}/);
  if (namedExports) {
    for (const part of namedExports[1].split(',')) {
      const alias = part.split(/\s+as\s+/).pop().trim();
      add(alias);
    }
  }
  if (/\bexport\s+default\s+/.test(source)) add('default');
  return [...symbols].slice(0, 10);
}

function walk(root, dir, depth, files) {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (files.length >= MAX_FILES) return;
    if (entry.name.startsWith('.') && entry.name !== '.caelix') continue;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, path.join(dir, entry.name), depth + 1, files);
    } else if (CODE_EXT.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
}

// Build the outline text. Empty string when the project has no code or is
// too small to need a map (a handful of files is trivially visible anyway).
function build(root, minFiles = 4) {
  const files = [];
  walk(root, root, 0, files);
  if (files.length < minFiles) return '';
  files.sort();
  const lines = [];
  let chars = 0;
  for (const file of files) {
    if (chars >= MAX_CHARS) break;
    let source = '';
    try {
      const fd = fs.openSync(file, 'r');
      const buffer = Buffer.alloc(MAX_FILE_BYTES);
      const bytes = fs.readSync(fd, buffer, 0, MAX_FILE_BYTES, 0);
      fs.closeSync(fd);
      source = buffer.toString('utf8', 0, bytes);
    } catch { continue; }
    const symbols = symbolsIn(file, source);
    if (!symbols.length) continue;
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const line = `${rel}: ${symbols.join(', ')}`;
    if (chars + line.length > MAX_CHARS) {
      lines.push('…(symbol map truncated to fit)');
      break;
    }
    lines.push(line);
    chars += line.length;
  }
  return lines.join('\n');
}

module.exports = { build, symbolsIn };
