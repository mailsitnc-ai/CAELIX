'use strict';

// Small line diff with a bounded LCS table.
function diffLines(beforeText, afterText) {
  const before = String(beforeText ?? '').split('\n');
  const after = String(afterText ?? '').split('\n');
  if (before.length * after.length > 4_000_000) {
    return { lines: [], additions: after.length, deletions: before.length, truncated: true };
  }

  const n = before.length;
  const m = after.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = before[i] === after[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const lines = [];
  let additions = 0;
  let deletions = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      lines.push({ kind: 'same', text: before[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ kind: 'del', text: before[i] });
      deletions += 1;
      i += 1;
    } else {
      lines.push({ kind: 'add', text: after[j] });
      additions += 1;
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ kind: 'del', text: before[i] });
    deletions += 1;
    i += 1;
  }
  while (j < m) {
    lines.push({ kind: 'add', text: after[j] });
    additions += 1;
    j += 1;
  }
  return { lines, additions, deletions, truncated: false };
}

module.exports = { diffLines };
