'use strict';

// Inline markdown parsing shared by every emitter. Kept separate so the
// format modules never require the dispatcher (which would be circular).

const PATTERN = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|~~[^~]+~~)/;

function parseInline(text) {
  const source = String(text ?? '');
  const runs = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const match = PATTERN.exec(rest);
    if (!match) {
      runs.push({ text: rest });
      break;
    }
    if (match.index > 0) runs.push({ text: rest.slice(0, match.index) });
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) runs.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith('~~')) runs.push({ text: token.slice(2, -2), strike: true });
    else if (token.startsWith('`')) runs.push({ text: token.slice(1, -1), code: true });
    else runs.push({ text: token.slice(1, -1), italic: true });
    index += match.index + token.length;
  }
  return runs.length ? runs : [{ text: '' }];
}

function plainText(runs) {
  return runs.map((run) => run.text).join('');
}

// Split styled runs into word/space tokens for line breaking.
function tokenise(runs) {
  const tokens = [];
  for (const run of runs) {
    const parts = String(run.text ?? '').split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      tokens.push({
        text: part,
        whitespace: /^\s+$/.test(part),
        ...(run.bold ? { bold: true } : {}),
        ...(run.italic ? { italic: true } : {}),
        ...(run.code ? { code: true } : {}),
        ...(run.strike ? { strike: true } : {}),
      });
    }
  }
  return tokens;
}

module.exports = { parseInline, plainText, tokenise };
