'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_CHECKPOINTS = 40;

function safeId(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
}

class CheckpointStore {
  constructor(directory) {
    this.directory = directory;
  }

  folder(sessionId) {
    return path.join(this.directory, safeId(sessionId));
  }

  capture(sessionId, changes, label = '') {
    if (!this.directory || !Array.isArray(changes) || !changes.length) return null;
    const id = `cp_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const folder = path.join(this.folder(sessionId), id);
    const filesDir = path.join(folder, 'files');
    fs.mkdirSync(filesDir, { recursive: true });

    const entries = [];
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index];
      if (!change || !change.file) continue;
      const stored = `f${index}.txt`;
      fs.writeFileSync(path.join(filesDir, stored), String(change.before ?? ''), 'utf8');
      entries.push({
        path: change.file,
        before: stored,
        existed: change.existed !== false,
        additions: Number(change.additions) || 0,
        deletions: Number(change.deletions) || 0,
      });
    }
    if (!entries.length) return null;

    const manifest = {
      id,
      sessionId,
      label: String(label || '').slice(0, 120),
      createdAt: Date.now(),
      files: entries.map((entry) => entry.path),
      entries,
    };
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
    this.prune(sessionId);
    return { id, createdAt: manifest.createdAt, label: manifest.label, files: manifest.files, filesChanged: entries.length };
  }

  list(sessionId) {
    if (!this.directory) return [];
    const base = this.folder(sessionId);
    let names = [];
    try {
      names = fs.readdirSync(base).filter((name) => name.startsWith('cp_'));
    } catch {
      return [];
    }
    const items = [];
    for (const name of names) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(base, name, 'manifest.json'), 'utf8'));
        items.push({
          id: manifest.id,
          createdAt: manifest.createdAt,
          label: manifest.label,
          files: manifest.files,
          filesChanged: (manifest.entries || []).length,
        });
      } catch {
        // an incomplete checkpoint is skipped
      }
    }
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  rewind(sessionId, checkpointId, root) {
    if (!this.directory) throw new Error('Checkpoints are not available on this surface.');
    if (!/^cp_[a-z0-9_]+$/i.test(String(checkpointId || ''))) throw new Error('Unknown checkpoint.');
    const folder = path.join(this.folder(sessionId), checkpointId);
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
    const project = path.resolve(root);
    const restored = [];

    for (const entry of manifest.entries || []) {
      const target = path.resolve(project, entry.path);
      if (target !== project && !target.startsWith(`${project}${path.sep}`)) continue;
      const stored = path.join(folder, 'files', entry.before);
      const before = fs.readFileSync(stored, 'utf8');
      if (!entry.existed) {
        try { fs.rmSync(target, { force: true }); } catch { /* already gone */ }
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, before, 'utf8');
      }
      restored.push(entry.path);
    }

    return { id: manifest.id, restored, at: Date.now() };
  }

  prune(sessionId) {
    const items = this.list(sessionId);
    for (const item of items.slice(MAX_CHECKPOINTS)) {
      try { fs.rmSync(path.join(this.folder(sessionId), item.id), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

module.exports = { CheckpointStore };
