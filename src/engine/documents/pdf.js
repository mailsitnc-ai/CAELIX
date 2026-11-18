'use strict';

// A small but complete PDF writer: A4 pages, Helvetica/Courier base-14 fonts,
// wrapped styled text, headings, lists, tables, code blocks, images (JPEG
// passthrough, PNG decoded to RGB) and page-number footers.

const zlib = require('zlib');
const { inspectImage, pngToRgb } = require('./media');
const { parseInline, tokenise } = require('./inline');

const PDF_MIME = 'application/pdf';

const PAGE = { width: 595.28, height: 841.89, margin: 56, bottom: 64 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

// Helvetica AFM advance widths for printable ASCII, per 1000 units.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

const FONT_RESOURCES = [
  { ref: 'F1', base: 'Helvetica', widths: HELVETICA },
  { ref: 'F2', base: 'Helvetica-Bold', widths: HELVETICA_BOLD },
  { ref: 'F3', base: 'Helvetica-Oblique', widths: HELVETICA },
  { ref: 'F4', base: 'Courier', widths: null },
  { ref: 'F5', base: 'Courier-Bold', widths: null },
];

function fontFor(run) {
  if (run.code) return run.bold ? 'F5' : 'F4';
  if (run.bold) return 'F2';
  if (run.italic) return 'F3';
  return 'F1';
}

function glyphWidth(char, fontRef) {
  const code = char.charCodeAt(0);
  const font = FONT_RESOURCES.find((entry) => entry.ref === fontRef);
  if (!font.widths) return 600;
  if (code >= 32 && code <= 126) return font.widths[code - 32];
  if (code === 0x2014 || code === 0x2013) return 556;
  return 556;
}

function measure(text, fontRef, size) {
  let total = 0;
  for (const char of String(text)) total += glyphWidth(char, fontRef);
  return (total / 1000) * size;
}

// PDF literal strings use WinAnsi bytes; anything outside it becomes a safe
// octal escape so the file stays 7-bit clean and never breaks a parser.
const WIN_ANSI = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A],
  [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92],
  [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x2122, 0x99], [0x203A, 0x9B], [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
]);

function pdfString(text) {
  let out = '';
  for (const char of String(text)) {
    let code = char.codePointAt(0);
    if (code > 0x7E) code = WIN_ANSI.get(code) ?? (code < 256 ? code : 0x3F);
    if (code === 0x28 || code === 0x29 || code === 0x5C) out += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return out;
}

// ---- line breaking --------------------------------------------------------

// Greedy wrap over styled tokens, preserving bold/italic/code runs.
function wrapTokens(tokens, size, maxWidth) {
  const lines = [];
  let line = [];
  let width = 0;
  let space = null;

  const pushLine = () => {
    lines.push(line);
    line = [];
    width = 0;
    space = null;
  };

  for (const token of tokens) {
    if (!token.text) continue;
    if (token.whitespace) { space = token; continue; }

    const font = fontFor(token);
    const tokenWidth = measure(token.text, font, size);
    const spaceWidth = space ? measure(space.text, fontFor(space), size) : 0;

    if (tokenWidth <= maxWidth) {
      if (line.length && width + spaceWidth + tokenWidth > maxWidth) pushLine();
      if (line.length && spaceWidth) {
        line.push({ ...space, text: ' ' });
        width += spaceWidth;
      }
      line.push({ ...token, text: token.text });
      width += tokenWidth;
      space = null;
      continue;
    }

    // A word longer than the line: hard-split it at characters.
    if (line.length) pushLine();
    let chunk = '';
    let chunkWidth = 0;
    const chars = [...token.text];
    for (let i = 0; i < chars.length; i += 1) {
      const charWidth = measure(chars[i], font, size);
      if (chunk && chunkWidth + charWidth > maxWidth) {
        lines.push([{ ...token, text: chunk, hardBreak: true }]);
        chunk = '';
        chunkWidth = 0;
      }
      chunk += chars[i];
      chunkWidth += charWidth;
      if (i === chars.length - 1) {
        line = [{ ...token, text: chunk }];
        width = chunkWidth;
      }
    }
    space = null;
  }
  if (line.length) lines.push(line);
  if (!lines.length) lines.push([]);
  return lines;
}

// ---- renderer -------------------------------------------------------------

class PdfCanvas {
  constructor(meta) {
    this.meta = meta;
    this.pages = [];
    this.images = [];
    this.imageKeys = new Map();
    this.newPage();
  }

  newPage() {
    this.page = { ops: [], images: new Set() };
    this.pages.push(this.page);
    this.x = PAGE.margin;
    this.y = PAGE.height - PAGE.margin;
  }

  remaining() {
    return this.y - PAGE.bottom;
  }

  ensure(height) {
    if (this.remaining() < height) this.newPage();
  }

  raw(op) {
    this.page.ops.push(op);
  }

  color(r, g, b) {
    this.raw(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
  }

  strokeColor(r, g, b, width = 0.6) {
    this.raw(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${width} w`);
  }

  fillRect(x, y, width, height, shade) {
    const [r, g, b] = shade;
    this.raw(`q ${r} ${g} ${b} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f Q`);
  }

  line(x1, y1, x2, y2) {
    this.raw(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  textRuns(runs, x, y, size) {
    let cursor = x;
    for (const run of runs) {
      if (!run.text) continue;
      const font = fontFor(run);
      this.page.ops.push(`BT /${font} ${size} Tf 1 0 0 1 ${cursor.toFixed(2)} ${y.toFixed(2)} Tm (${pdfString(run.text)}) Tj ET`);
      cursor += measure(run.text, font, size);
    }
    return cursor;
  }

  drawLine(line, x, y, size, color = [0.12, 0.13, 0.16]) {
    this.color(...color);
    this.textRuns(line, x, y, size);
  }

  registerImage(file) {
    const resolved = require('path').isAbsolute(file)
      ? file
      : require('path').resolve(this.meta.baseDir || process.cwd(), file);
    if (this.imageKeys.has(resolved)) return this.imageKeys.get(resolved);
    const image = inspectImage(resolved);
    const name = `Im${this.images.length + 1}`;
    let payload;
    let filter;
    if (image.kind === 'jpeg') {
      payload = image.buffer;
      filter = 'DCTDecode';
    } else if (image.kind === 'png') {
      const rgb = pngToRgb(image.buffer);
      payload = zlib.deflateSync(rgb.rgb, { level: 9 });
      filter = 'FlateDecode';
    } else {
      throw new Error('PDF images must be PNG or JPEG.');
    }
    const record = { name, width: image.width, height: image.height, payload, filter };
    this.images.push(record);
    this.imageKeys.set(resolved, record);
    return record;
  }

  drawImage(file, caption) {
    const image = this.registerImage(file);
    let width = Math.min(CONTENT_WIDTH, image.width * 72 / 96);
    let height = width * (image.height / image.width);
    const maxHeight = PAGE.height - PAGE.margin - PAGE.bottom - 40;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * (image.width / image.height);
    }
    if (this.remaining() < height + 26) this.newPage();
    const x = PAGE.margin + (CONTENT_WIDTH - width) / 2;
    const y = this.y - height;
    this.raw(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${image.name} Do Q`);
    this.y = y - 14;
    if (caption) {
      this.color(0.45, 0.47, 0.52);
      const lines = wrapTokens(tokenise([{ text: caption }]), 9, CONTENT_WIDTH);
      for (const line of lines) {
        const lineWidth = line.reduce((sum, run) => sum + measure(run.text, fontFor(run), 9), 0);
        this.textRuns(line, PAGE.margin + (CONTENT_WIDTH - lineWidth) / 2, this.y, 9);
        this.y -= 12;
      }
    }
    this.y -= 6;
    this.page.images.add(image.name);
  }

  table(block) {
    const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
    const header = block.headers.length ? block.headers : block.rows[0] || [];
    const body = block.headers.length ? block.rows : block.rows.slice(1);
    if (!header.length && !body.length) return;

    const weights = [];
    for (let column = 0; column < columns; column += 1) {
      const cells = [header[column] || '', ...body.map((row) => row[column] || '')];
      weights.push(Math.min(52, Math.max(8, ...cells.map((cell) => String(cell).length))));
    }
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    const widths = weights.map((value) => (value / total) * CONTENT_WIDTH);
    const size = 9;
    const padding = 5;
    const lineHeight = 11.5;

    const layoutRow = (cells, bold) => {
      const wrapped = cells.map((cell, column) => wrapTokens(
        tokenise([{ text: String(cell ?? ''), bold }]),
        size,
        widths[column] - padding * 2,
      ));
      const lines = Math.max(1, ...wrapped.map((entry) => entry.length));
      return { wrapped, height: lines * lineHeight + padding * 2 };
    };

    const drawRow = (row, { bold = false, shade = null } = {}) => {
      this.ensure(row.height + 4);
      if (shade) this.fillRect(PAGE.margin, this.y - row.height, CONTENT_WIDTH, row.height, shade);
      this.strokeColor(0.82, 0.84, 0.87, 0.5);
      let x = PAGE.margin;
      for (let column = 0; column < columns; column += 1) {
        this.line(x, this.y, x, this.y - row.height);
        const lines = row.wrapped[column] || [];
        let baseline = this.y - padding - size + 1.5;
        for (const line of lines) {
          this.drawLine(line, x + padding, baseline, size, bold ? [0.09, 0.1, 0.13] : [0.16, 0.17, 0.2]);
          baseline -= lineHeight;
        }
        x += widths[column];
      }
      this.line(PAGE.margin + CONTENT_WIDTH, this.y, PAGE.margin + CONTENT_WIDTH, this.y - row.height);
      this.line(PAGE.margin, this.y - row.height, PAGE.margin + CONTENT_WIDTH, this.y - row.height);
      this.y -= row.height;
    };

    this.ensure(60);
    this.line(PAGE.margin, this.y, PAGE.margin + CONTENT_WIDTH, this.y);
    if (header.length) drawRow(layoutRow(header, true), { bold: true, shade: [0.94, 0.95, 0.97] });
    for (const cells of body) drawRow(layoutRow(cells, false));
    this.y -= 12;
  }

  codeBlock(block) {
    const size = 8.5;
    const lineHeight = 11.5;
    const padding = 7;
    const lines = [];
    for (const sourceLine of String(block.text || '').split('\n')) {
      const wrapped = wrapTokens(tokenise([{ text: sourceLine || ' ', code: true }]), size, CONTENT_WIDTH - padding * 2);
      lines.push(...wrapped);
    }
    let index = 0;
    while (index < lines.length) {
      this.ensure(40);
      const available = Math.max(1, Math.floor((this.remaining() - padding * 2 - 8) / lineHeight));
      const slice = lines.slice(index, index + available);
      const height = slice.length * lineHeight + padding * 2;
      this.fillRect(PAGE.margin, this.y - height, CONTENT_WIDTH, height, [0.95, 0.955, 0.965]);
      let baseline = this.y - padding - size + 2;
      for (const line of slice) {
        this.drawLine(line, PAGE.margin + padding, baseline, size, [0.16, 0.2, 0.26]);
        baseline -= lineHeight;
      }
      this.y -= height;
      index += slice.length;
      if (index < lines.length) {
        this.newPage();
      }
    }
    this.y -= 10;
  }

  quote(block) {
    const lines = wrapTokens(tokenise([{ text: block.text, italic: true }]), 10.5, CONTENT_WIDTH - 18);
    this.ensure(lines.length * 14 + 8);
    const top = this.y;
    for (const line of lines) {
      this.drawLine(line, PAGE.margin + 14, this.y - 9, 10.5, [0.35, 0.38, 0.44]);
      this.y -= 14;
    }
    this.strokeColor(0.72, 0.75, 0.8, 2);
    this.line(PAGE.margin + 2, top, PAGE.margin + 2, this.y + 4);
    this.y -= 8;
  }
}

function renderPdf(doc) {
  const canvas = new PdfCanvas(doc);

  // Cover block
  canvas.ensure(120);
  const titleRuns = tokenise([{ text: doc.title, bold: true }]);
  for (const line of wrapTokens(titleRuns, 24, CONTENT_WIDTH)) {
    canvas.drawLine(line, PAGE.margin, canvas.y - 22, 24, [0.07, 0.08, 0.11]);
    canvas.y -= 29;
  }
  if (doc.subtitle) {
    for (const line of wrapTokens(tokenise([{ text: doc.subtitle }]), 13, CONTENT_WIDTH)) {
      canvas.drawLine(line, PAGE.margin, canvas.y - 15, 13, [0.35, 0.38, 0.44]);
      canvas.y -= 18;
    }
  }
  const metaLine = [doc.author, doc.created.toISOString().slice(0, 10)].filter(Boolean).join('  ·  ');
  canvas.y -= 4;
  canvas.drawLine(tokenise([{ text: metaLine }]), PAGE.margin, canvas.y - 9, 9, [0.48, 0.5, 0.55]);
  canvas.y -= 22;
  canvas.strokeColor(0.85, 0.87, 0.9, 0.8);
  canvas.line(PAGE.margin, canvas.y, PAGE.margin + CONTENT_WIDTH, canvas.y);
  canvas.y -= 20;

  for (const block of doc.blocks) {
    if (block.type === 'heading') {
      const size = [22, 16, 13, 11.5][block.level - 1] || 12;
      const lines = wrapTokens(tokenise([{ text: block.text, bold: true }]), size, CONTENT_WIDTH);
      canvas.y -= block.level === 1 ? 10 : 8;
      canvas.ensure(size * 2.4);
      for (const line of lines) {
        canvas.ensure(size * 1.6);
        canvas.drawLine(line, PAGE.margin, canvas.y - size, size, [0.08, 0.09, 0.12]);
        canvas.y -= size * 1.32;
      }
      canvas.y -= 6;
    } else if (block.type === 'paragraph') {
      const lines = wrapTokens(tokenise(parseInline(block.text)), 11, CONTENT_WIDTH);
      canvas.ensure(20);
      for (const line of lines) {
        canvas.ensure(16);
        canvas.drawLine(line, PAGE.margin, canvas.y - 11, 11);
        canvas.y -= 15.5;
      }
      canvas.y -= 8;
    } else if (block.type === 'bullets' || block.type === 'numbers') {
      let counter = 1;
      for (const item of block.items) {
        const marker = block.type === 'bullets' ? '•' : `${counter}.`;
        const indent = 18;
        const lines = wrapTokens(tokenise(parseInline(item)), 11, CONTENT_WIDTH - indent);
        canvas.ensure(18);
        const markerWidth = measure(marker, 'F1', 11);
        canvas.drawLine(tokenise([{ text: marker }]), PAGE.margin + (block.type === 'bullets' ? 2 : 0), canvas.y - 11, 11, [0.35, 0.38, 0.44]);
        for (const line of lines) {
          canvas.ensure(16);
          canvas.drawLine(line, PAGE.margin + indent, canvas.y - 11, 11);
          canvas.y -= 15.5;
        }
        void markerWidth;
        counter += 1;
      }
      canvas.y -= 8;
    } else if (block.type === 'table') {
      canvas.table(block);
    } else if (block.type === 'code') {
      canvas.codeBlock(block);
    } else if (block.type === 'quote') {
      canvas.quote(block);
    } else if (block.type === 'image') {
      canvas.drawImage(block.path, block.caption);
    } else if (block.type === 'pagebreak') {
      canvas.newPage();
    }
  }

  // Footers: page numbers are only known after layout, so add them last.
  const total = canvas.pages.length;
  canvas.pages.forEach((page, index) => {
    const label = `${index + 1} / ${total}`;
    const width = measure(label, 'F1', 8.5);
    page.ops.push('0.520 0.540 0.580 rg');
    page.ops.push(`BT /F1 8.5 Tf 1 0 0 1 ${(PAGE.width - PAGE.margin - width).toFixed(2)} 32 Tm (${pdfString(label)}) Tj ET`);
    if (doc.title) {
      page.ops.push(`BT /F1 8.5 Tf 1 0 0 1 ${PAGE.margin.toFixed(2)} 32 Tm (${pdfString(doc.title)}) Tj ET`);
    }
  });

  return assemble(doc, canvas);
}

function assemble(doc, canvas) {
  const pageCount = canvas.pages.length;
  const pageObj = (index) => 3 + index * 2;
  const contentObj = (index) => 4 + index * 2;
  const fontBase = 3 + pageCount * 2;
  const imageBase = fontBase + FONT_RESOURCES.length;

  const objects = [];
  const setObject = (number, value) => { objects[number - 1] = value; };

  setObject(1, '<< /Type /Catalog /Pages 2 0 R >>');

  const kids = canvas.pages.map((_page, index) => `${pageObj(index)} 0 R`).join(' ');
  setObject(2, `<< /Type /Pages /Count ${pageCount} /Kids [${kids}] >>`);

  const fontEntries = FONT_RESOURCES.map((font, index) => `/${font.ref} ${fontBase + index} 0 R`).join(' ');
  FONT_RESOURCES.forEach((font, index) => {
    setObject(fontBase + index, `<< /Type /Font /Subtype /Type1 /BaseFont /${font.base} /Encoding /WinAnsiEncoding >>`);
  });

  canvas.images.forEach((image, index) => {
    const header = `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.payload.length} >>`;
    setObject(imageBase + index, Buffer.concat([
      Buffer.from(`${header}\nstream\n`, 'latin1'),
      image.payload,
      Buffer.from('\nendstream', 'latin1'),
    ]));
  });

  canvas.pages.forEach((page, index) => {
    const usedImages = [...page.images];
    const xobjects = usedImages.length
      ? ` /XObject << ${usedImages.map((name) => {
        const found = canvas.images.find((image) => image.name === name);
        return `/${name} ${imageBase + canvas.images.indexOf(found)} 0 R`;
      }).join(' ')} >>`
      : '';
    setObject(pageObj(index), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] `
      + `/Resources << /Font << ${fontEntries} >>${xobjects} >> /Contents ${contentObj(index)} 0 R >>`);

    const stream = zlib.deflateSync(Buffer.from(page.ops.join('\n'), 'latin1'), { level: 9 });
    setObject(contentObj(index), Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      stream,
      Buffer.from('\nendstream', 'latin1'),
    ]));
  });

  const stamp = doc.created;
  const date = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}`
    + `${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}`;
  const infoNum = objects.length + 1;
  setObject(infoNum, `<< /Title (${pdfString(doc.title)}) /Author (${pdfString(doc.author)}) `
    + `/Creator (CAELIX) /Producer (CAELIX) /CreationDate (D:${date}) >>`);

  const chunks = [];
  let length = 0;
  const push = (value) => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'latin1');
    chunks.push(buffer);
    length += buffer.length;
  };

  push('%PDF-1.7\n');
  push(Buffer.from([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

  const offsets = [];
  objects.forEach((value, index) => {
    offsets[index] = length;
    push(`${index + 1} 0 obj\n`);
    push(value);
    push('\nendobj\n');
  });

  const xrefStart = length;
  push(`xref\n0 ${objects.length + 1}\n`);
  push('0000000000 65535 f \n');
  for (const offset of offsets) push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

module.exports = { renderPdf, PDF_MIME };
