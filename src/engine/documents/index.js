'use strict';

// Document authoring. One block vocabulary feeds every emitter, so the agent
// describes content once and CAELIX writes a real PDF, Word, Excel, PowerPoint,
// OpenDocument, RTF, HTML, Markdown, CSV or EPUB file — no external binaries.

const path = require('path');
const fs = require('fs');

const { renderPdf, PDF_MIME } = require('./pdf');
const { renderDocx, DOCX_MIME } = require('./docx');
const { renderXlsx, XLSX_MIME } = require('./xlsx');
const { renderPptx, PPTX_MIME } = require('./pptx');
const { renderOdf } = require('./odf');
const { renderSimple } = require('./simple');
const { parseInline, plainText, tokenise } = require('./inline');

const FORMATS = {
  pdf: { ext: '.pdf', mime: PDF_MIME, kind: 'document' },
  docx: { ext: '.docx', mime: DOCX_MIME, kind: 'document', aliases: ['word', 'doc'] },
  xlsx: { ext: '.xlsx', mime: XLSX_MIME, kind: 'sheet', aliases: ['excel', 'spreadsheet'] },
  pptx: { ext: '.pptx', mime: PPTX_MIME, kind: 'slides', aliases: ['powerpoint', 'ppt', 'slides'] },
  odt: { ext: '.odt', mime: 'application/vnd.oasis.opendocument.text', kind: 'document', aliases: ['writer'] },
  ods: { ext: '.ods', mime: 'application/vnd.oasis.opendocument.spreadsheet', kind: 'sheet', aliases: ['calc'] },
  odp: { ext: '.odp', mime: 'application/vnd.oasis.opendocument.presentation', kind: 'slides', aliases: ['impress'] },
  rtf: { ext: '.rtf', mime: 'application/rtf', kind: 'document', aliases: ['richtext'] },
  html: { ext: '.html', mime: 'text/html', kind: 'document' },
  md: { ext: '.md', mime: 'text/markdown', kind: 'text', aliases: ['markdown'] },
  txt: { ext: '.txt', mime: 'text/plain', kind: 'text', aliases: ['text'] },
  csv: { ext: '.csv', mime: 'text/csv', kind: 'data' },
  tsv: { ext: '.tsv', mime: 'text/tab-separated-values', kind: 'data' },
  epub: { ext: '.epub', mime: 'application/epub+zip', kind: 'ebook' },
};

const ALIASES = Object.entries(FORMATS).reduce((map, [name, spec]) => {
  map[name] = name;
  for (const alias of spec.aliases || []) map[alias] = name;
  return map;
}, {});

function normaliseFormat(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^\./, '');
  const name = ALIASES[raw];
  if (!name) {
    throw new Error(`Unknown document format "${value}". Use one of: ${Object.keys(FORMATS).join(', ')}.`);
  }
  return name;
}

// ---- block normalisation --------------------------------------------------

const BLOCK_TYPES = new Set(['heading', 'paragraph', 'bullets', 'numbers', 'table', 'code', 'quote', 'pagebreak', 'image']);

function normaliseBlocks(input) {
  const raw = Array.isArray(input) ? input : [];
  const blocks = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    let type = String(item.type || '').toLowerCase();
    if (!type) type = item.items ? 'bullets' : 'paragraph';
    if (type === 'text') type = 'paragraph';
    if (type === 'list') type = 'bullets';
    if (!BLOCK_TYPES.has(type)) {
      throw new Error(`Unknown block type "${item.type}". Use heading, paragraph, bullets, numbers, table, code, quote, pagebreak or image.`);
    }
    if (type === 'heading') {
      blocks.push({
        type,
        level: Math.min(4, Math.max(1, Number(item.level) || 1)),
        text: String(item.text ?? ''),
      });
    } else if (type === 'paragraph' || type === 'quote') {
      blocks.push({ type, text: String(item.text ?? '') });
    } else if (type === 'bullets' || type === 'numbers') {
      const items = (Array.isArray(item.items) ? item.items : []).map((value) => String(value ?? '')).filter(Boolean);
      if (items.length) blocks.push({ type, items });
    } else if (type === 'table') {
      const headers = (Array.isArray(item.headers) ? item.headers : []).map((value) => String(value ?? ''));
      const rows = (Array.isArray(item.rows) ? item.rows : []).map((row) => (Array.isArray(row) ? row : []).map((value) => String(value ?? '')));
      if (headers.length || rows.length) blocks.push({ type, headers, rows });
    } else if (type === 'code') {
      blocks.push({ type, text: String(item.text ?? ''), language: String(item.language || '') });
    } else if (type === 'image') {
      if (item.path) blocks.push({ type, path: String(item.path), caption: String(item.caption || '') });
    } else if (type === 'pagebreak') {
      blocks.push({ type });
    }
  }
  return blocks;
}

// ---- slide and sheet derivation ------------------------------------------

// A presentation without explicit slides: the title becomes the cover, and
// every heading after it begins a new slide.
function deriveSlides(blocks, title, subtitle) {
  const slides = [{ title: title || 'Untitled', subtitle: subtitle || '', bullets: [] }];
  let current = slides[0];
  for (const block of blocks) {
    if (block.type === 'heading') {
      current = { title: block.text, bullets: [], blocks: [] };
      slides.push(current);
    } else if (block.type === 'bullets' || block.type === 'numbers') {
      current.bullets.push(...block.items);
    } else if (block.type === 'paragraph') {
      current.bullets.push(block.text);
    } else if (block.type === 'table') {
      current.blocks = current.blocks || [];
      current.blocks.push(block);
    } else if (block.type === 'image') {
      current.blocks = current.blocks || [];
      current.blocks.push(block);
    } else if (block.type === 'quote') {
      current.bullets.push(block.text);
    }
  }
  return slides.filter((slide, index) => index === 0 || slide.bullets.length || (slide.blocks || []).length || slide.title);
}

function tableBlocksToSheets(blocks, fallbackName = 'Sheet1') {
  const tables = blocks.filter((block) => block.type === 'table');
  if (!tables.length) {
    const rows = [];
    for (const block of blocks) {
      if (block.type === 'paragraph' || block.type === 'heading') rows.push([block.text]);
      else if (block.type === 'bullets' || block.type === 'numbers') for (const item of block.items) rows.push([item]);
    }
    return [{ name: fallbackName, headers: [], rows }];
  }
  return tables.map((table, index) => ({
    name: tables.length === 1 ? fallbackName : `${fallbackName} ${index + 1}`,
    headers: table.headers,
    rows: table.rows,
  }));
}

// ---- entry point ----------------------------------------------------------

function build(spec = {}, { baseDir = process.cwd() } = {}) {
  const format = normaliseFormat(spec.format);
  const meta = FORMATS[format];
  const title = String(spec.title || spec.name || 'Untitled document');
  const blocks = normaliseBlocks(spec.blocks);
  const doc = {
    format,
    title,
    subtitle: String(spec.subtitle || ''),
    author: String(spec.author || 'CAELIX'),
    subject: String(spec.subject || ''),
    blocks,
    baseDir,
    created: spec.created instanceof Date ? spec.created : new Date(),
  };

  if (meta.kind === 'sheet' || meta.kind === 'data') {
    doc.sheets = Array.isArray(spec.sheets) && spec.sheets.length
      ? spec.sheets.map((sheet, index) => ({
        name: String(sheet.name || `Sheet${index + 1}`).slice(0, 31),
        headers: Array.isArray(sheet.headers) ? sheet.headers.map(String) : [],
        rows: Array.isArray(sheet.rows) ? sheet.rows.map((row) => (Array.isArray(row) ? row.map((cell) => cell ?? '') : [row ?? ''])) : [],
      }))
      : tableBlocksToSheets(blocks, 'Sheet1');
    doc.rows = doc.sheets[0]?.rows || [];
  }
  if (meta.kind === 'slides') {
    doc.slides = Array.isArray(spec.slides) && spec.slides.length
      ? spec.slides.map((slide) => ({
        title: String(slide.title || ''),
        subtitle: String(slide.subtitle || ''),
        bullets: (Array.isArray(slide.bullets) ? slide.bullets : []).map(String),
        blocks: normaliseBlocks(slide.blocks),
        notes: String(slide.notes || ''),
      }))
      : deriveSlides(blocks, title, doc.subtitle);
    if (!doc.slides.length) doc.slides.push({ title, bullets: [] });
  }

  let buffer;
  if (format === 'pdf') buffer = renderPdf(doc);
  else if (format === 'docx') buffer = renderDocx(doc);
  else if (format === 'xlsx') buffer = renderXlsx(doc);
  else if (format === 'pptx') buffer = renderPptx(doc);
  else if (format === 'odt' || format === 'ods' || format === 'odp') buffer = renderOdf(doc);
  else buffer = renderSimple(doc);

  return { buffer, format, ext: meta.ext, mime: meta.mime, title };
}

// Keep `output` honest: if the caller passes a name without the extension the
// format needs, add it rather than producing a file no application opens.
function resolveOutput(output, format) {
  const meta = FORMATS[format];
  const raw = String(output || '').trim();
  if (!raw) throw new Error('An output path is required.');
  const ext = path.extname(raw).toLowerCase();
  return ext === meta.ext ? raw : `${raw}${meta.ext}`;
}

function ensureWritableDirectory(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

module.exports = {
  build,
  resolveOutput,
  ensureWritableDirectory,
  normaliseFormat,
  normaliseBlocks,
  parseInline,
  plainText,
  tokenise,
  FORMATS,
};
