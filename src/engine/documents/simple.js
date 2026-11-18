'use strict';

// RTF, HTML, Markdown, plain text, CSV/TSV and EPUB. These cover WordPad and
// TextEdit (RTF), browsers and Google Docs (HTML), documentation (Markdown),
// data exchange (CSV/TSV) and Apple Books / Kindle (EPUB).

const path = require('path');
const { zip } = require('./zip');
const { inspectImage } = require('./media');
const { parseInline, plainText } = require('./inline');

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- RTF ------------------------------------------------------------------

function rtfEscape(text) {
  let out = '';
  for (const char of String(text ?? '')) {
    if (char === '\\' || char === '{' || char === '}') out += `\\${char}`;
    else if (char === '\n') out += '\\line ';
    else if (char === '\t') out += '\\tab ';
    else if (char.charCodeAt(0) < 128) out += char;
    else out += `\\u${char.charCodeAt(0) > 32767 ? char.charCodeAt(0) - 65536 : char.charCodeAt(0)}?`;
  }
  return out;
}

function rtfRuns(runs, baseFontSize = 22) {
  return runs.map((run) => {
    let prefix = '';
    let suffix = '';
    if (run.bold) { prefix += '\\b '; suffix = '\\b0 ' + suffix; }
    if (run.italic) { prefix += '\\i '; suffix = '\\i0 ' + suffix; }
    if (run.code) { prefix += '\\f1 '; suffix = '\\f0 ' + suffix; }
    void baseFontSize;
    return `${prefix}${rtfEscape(run.text)}${suffix}`;
  }).join('');
}

function renderRtf(doc) {
  const chunks = ['{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman\\fcharset0 Georgia;}{\\f1\\fmodern\\fcharset0 Courier New;}}',
    '{\\colortbl;\\red27\\green32\\blue39;\\red90\\green98\\blue112;\\red238\\green241\\blue245;}',
    '\\viewkind4\\uc1\\pard\\sl276\\slmult1'];

  chunks.push(`\\pard\\sb0\\sa120{\\fs56\\b\\cf1 ${rtfEscape(doc.title)}}\\par`);
  if (doc.subtitle) chunks.push(`{\\fs28\\cf2 ${rtfEscape(doc.subtitle)}}\\par`);
  chunks.push(`{\\fs20\\i\\cf2 ${rtfEscape([doc.author, doc.created.toISOString().slice(0, 10)].join('  ·  '))}}\\par\\par`);

  for (const block of doc.blocks) {
    if (block.type === 'heading') {
      const sizes = [40, 32, 26, 24];
      chunks.push(`\\pard\\sb240\\sa100{\\fs${sizes[Math.min(3, block.level) - 1]}\\b\\cf1 ${rtfRuns(parseInline(block.text))}}\\par`);
    } else if (block.type === 'paragraph') {
      chunks.push(`\\pard\\sa140 ${rtfRuns(parseInline(block.text))}\\par`);
    } else if (block.type === 'bullets' || block.type === 'numbers') {
      block.items.forEach((item, index) => {
        const marker = block.type === 'bullets' ? '•' : `${index + 1}.`;
        chunks.push(`\\pard\\fi-280\\li560\\sa80 ${rtfEscape(marker)}\\tab ${rtfRuns(parseInline(item))}\\par`);
      });
    } else if (block.type === 'table') {
      const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
      const width = Math.floor(9360 / columns);
      const rows = block.headers.length ? [block.headers, ...block.rows] : block.rows;
      rows.forEach((row, rowIndex) => {
        const header = block.headers.length > 0 && rowIndex === 0;
        let rowDef = '\\trowd\\trgaph108\\trleft0';
        for (let column = 0; column < columns; column += 1) {
          rowDef += '\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10';
          if (header) rowDef += '\\clcbpat3';
          rowDef += `\\cellx${width * (column + 1)}`;
        }
        const cells = Array.from({ length: columns }, (_unused, column) => {
          const text = String(row[column] ?? '');
          const content = header ? `{\\b ${rtfEscape(text)}}` : rtfEscape(text);
          return `\\pard\\intbl\\sa40 ${content}\\cell`;
        }).join('');
        chunks.push(`${rowDef}${cells}\\row`);
      });
      chunks.push('\\pard\\sa120\\par');
    } else if (block.type === 'code') {
      for (const line of String(block.text || '').split('\n')) {
        chunks.push(`\\pard\\f1\\fs18\\sa0\\sb0 ${rtfEscape(line || ' ')}\\par`);
      }
      chunks.push('\\pard\\f0\\fs22\\sa120\\par');
    } else if (block.type === 'quote') {
      chunks.push(`\\pard\\li560\\sa140\\i\\cf2 ${rtfRuns(parseInline(block.text))}\\par`);
    } else if (block.type === 'pagebreak') {
      chunks.push('\\page ');
    } else if (block.type === 'image' && block.caption) {
      chunks.push(`\\pard\\sa120\\i\\cf2 ${rtfEscape(block.caption)}\\par`);
    }
  }
  chunks.push('}');
  return Buffer.from(chunks.join('\n'), 'latin1');
}

// ---- HTML -----------------------------------------------------------------

function htmlBody(doc) {
  const parts = [];
  parts.push(`<header><h1>${escHtml(doc.title)}</h1>`);
  if (doc.subtitle) parts.push(`<p class="subtitle">${escHtml(doc.subtitle)}</p>`);
  parts.push(`<p class="meta">${escHtml([doc.author, doc.created.toISOString().slice(0, 10)].filter(Boolean).join(' · '))}</p></header>`);

  const inline = (text) => parseInline(text).map((run) => {
    let out = escHtml(run.text);
    if (run.code) out = `<code>${out}</code>`;
    if (run.italic) out = `<em>${out}</em>`;
    if (run.bold) out = `<strong>${out}</strong>`;
    if (run.strike) out = `<s>${out}</s>`;
    return out;
  }).join('');

  for (const block of doc.blocks) {
    if (block.type === 'heading') {
      const level = Math.min(6, block.level + 1);
      parts.push(`<h${level}>${inline(block.text)}</h${level}>`);
    } else if (block.type === 'paragraph') {
      parts.push(`<p>${inline(block.text)}</p>`);
    } else if (block.type === 'bullets' || block.type === 'numbers') {
      const tag = block.type === 'bullets' ? 'ul' : 'ol';
      parts.push(`<${tag}>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
    } else if (block.type === 'table') {
      const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
      const head = block.headers.length
        ? `<thead><tr>${block.headers.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`
        : '';
      const body = block.rows.map((row) => `<tr>${Array.from({ length: columns }, (_unused, column) => `<td>${inline(row[column] ?? '')}</td>`).join('')}</tr>`).join('');
      parts.push(`<table>${head}<tbody>${body}</tbody></table>`);
    } else if (block.type === 'code') {
      parts.push(`<pre><code>${escHtml(block.text)}</code></pre>`);
    } else if (block.type === 'quote') {
      parts.push(`<blockquote>${inline(block.text)}</blockquote>`);
    } else if (block.type === 'image') {
      const resolved = path.isAbsolute(block.path) ? block.path : path.resolve(doc.baseDir, block.path);
      const record = inspectImage(resolved);
      const data = `data:${record.mime};base64,${record.buffer.toString('base64')}`;
      parts.push(`<figure><img src="${data}" width="${record.width}" height="${record.height}" alt="${escHtml(block.caption || '')}"/>`
        + (block.caption ? `<figcaption>${escHtml(block.caption)}</figcaption>` : '') + '</figure>');
    } else if (block.type === 'pagebreak') {
      parts.push('<div class="page-break"></div>');
    }
  }
  return parts.join('\n');
}

function renderHtml(doc) {
  const css = `
:root { color-scheme: light; }
body { margin: 0 auto; max-width: 46rem; padding: 3rem 1.5rem 4rem; font: 16px/1.65 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1b2027; background: #fff; }
header { border-bottom: 1px solid #e3e6ea; padding-bottom: 1.2rem; margin-bottom: 2rem; }
h1 { font-size: 2.1rem; line-height: 1.2; margin: 0 0 .5rem; letter-spacing: -.02em; }
h2 { font-size: 1.45rem; margin: 2.2rem 0 .6rem; } h3 { font-size: 1.18rem; margin: 1.8rem 0 .5rem; }
.subtitle { font-size: 1.05rem; color: #5a6270; margin: 0 0 .4rem; }
.meta { font-size: .85rem; color: #7b8492; margin: 0; }
p { margin: 0 0 1rem; } ul, ol { margin: 0 0 1rem; padding-left: 1.4rem; } li { margin: .25rem 0; }
code { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: .9em; background: #f3f4f6; padding: .1em .35em; border-radius: 4px; }
pre { background: #f4f5f7; border: 1px solid #e3e6ea; border-radius: 8px; padding: .9rem 1rem; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: .85rem; line-height: 1.5; }
table { width: 100%; border-collapse: collapse; margin: 0 0 1.4rem; font-size: .93rem; }
th, td { border: 1px solid #d7dbe1; padding: .5rem .6rem; text-align: left; vertical-align: top; }
th { background: #eef1f5; font-weight: 600; }
blockquote { margin: 0 0 1.2rem; padding: .2rem 0 .2rem 1rem; border-left: 3px solid #c3c8d0; color: #4a5160; font-style: italic; }
figure { margin: 0 0 1.4rem; text-align: center; } img { max-width: 100%; height: auto; } figcaption { font-size: .85rem; color: #7b8492; margin-top: .4rem; }
.page-break { page-break-after: always; break-after: page; height: 0; }
@media print { body { max-width: none; padding: 0; } }
`;
  return Buffer.from(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="generator" content="CAELIX"/>
<title>${escHtml(doc.title)}</title>
<style>${css}</style>
</head>
<body>
${htmlBody(doc)}
</body>
</html>
`, 'utf8');
}

// ---- Markdown / text / CSV ------------------------------------------------

function renderMarkdown(doc) {
  const lines = [`# ${doc.title}`, ''];
  if (doc.subtitle) lines.push(`_${doc.subtitle}_`, '');
  lines.push(`_${[doc.author, doc.created.toISOString().slice(0, 10)].filter(Boolean).join(' · ')}_`, '');

  for (const block of doc.blocks) {
    if (block.type === 'heading') {
      lines.push(`${'#'.repeat(Math.min(6, block.level + 1))} ${block.text}`, '');
    } else if (block.type === 'paragraph') {
      lines.push(block.text, '');
    } else if (block.type === 'bullets') {
      lines.push(...block.items.map((item) => `- ${item}`), '');
    } else if (block.type === 'numbers') {
      lines.push(...block.items.map((item, index) => `${index + 1}. ${item}`), '');
    } else if (block.type === 'table') {
      const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
      const header = block.headers.length ? block.headers : Array.from({ length: columns }, (_unused, index) => `Column ${index + 1}`);
      const clean = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${header.map(clean).join(' | ')} |`);
      lines.push(`| ${header.map(() => '---').join(' | ')} |`);
      for (const row of block.rows) {
        lines.push(`| ${Array.from({ length: columns }, (_unused, index) => clean(row[index])).join(' | ')} |`);
      }
      lines.push('');
    } else if (block.type === 'code') {
      lines.push('```' + (block.language || ''), String(block.text || ''), '```', '');
    } else if (block.type === 'quote') {
      lines.push(...String(block.text).split('\n').map((line) => `> ${line}`), '');
    } else if (block.type === 'image') {
      const relative = path.relative(doc.baseDir, path.resolve(doc.baseDir, block.path)).split(path.sep).join('/');
      lines.push(`![${block.caption || ''}](${relative})`, '');
    } else if (block.type === 'pagebreak') {
      lines.push('---', '');
    }
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

function renderText(doc) {
  const lines = [doc.title, '='.repeat(Math.min(78, doc.title.length))];
  if (doc.subtitle) lines.push(doc.subtitle);
  lines.push([doc.author, doc.created.toISOString().slice(0, 10)].filter(Boolean).join('  ·  '), '');

  for (const block of doc.blocks) {
    if (block.type === 'heading') {
      lines.push('', plainText(parseInline(block.text)).toUpperCase(), '-'.repeat(Math.min(78, block.text.length)), '');
    } else if (block.type === 'paragraph') {
      lines.push(plainText(parseInline(block.text)), '');
    } else if (block.type === 'bullets' || block.type === 'numbers') {
      block.items.forEach((item, index) => lines.push(`  ${block.type === 'bullets' ? '•' : `${index + 1}.`} ${plainText(parseInline(item))}`));
      lines.push('');
    } else if (block.type === 'table') {
      const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
      const rows = block.headers.length ? [block.headers, ...block.rows] : block.rows;
      const widths = [];
      for (let column = 0; column < columns; column += 1) {
        widths.push(Math.min(32, Math.max(4, ...rows.map((row) => String(row[column] ?? '').length))));
      }
      const pad = (value, width) => String(value ?? '').slice(0, width).padEnd(width);
      for (const row of rows) lines.push(Array.from({ length: columns }, (_unused, column) => pad(row[column], widths[column])).join('  '));
      lines.push('');
    } else if (block.type === 'code') {
      lines.push(...String(block.text || '').split('\n').map((line) => `    ${line}`), '');
    } else if (block.type === 'quote') {
      lines.push(...String(block.text).split('\n').map((line) => `  | ${line}`), '');
    } else if (block.type === 'image') {
      lines.push(`[image: ${block.path}${block.caption ? ` — ${block.caption}` : ''}]`, '');
    } else if (block.type === 'pagebreak') {
      lines.push('', '\f', '');
    }
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

function csvCell(value, delimiter) {
  const text = String(value ?? '');
  return /["\n\r]|,|\t/.test(text) || text.includes(delimiter)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function renderDelimited(doc, delimiter) {
  const sheet = (doc.sheets && doc.sheets[0]) || { headers: [], rows: doc.rows || [] };
  const rows = sheet.headers && sheet.headers.length ? [sheet.headers, ...sheet.rows] : sheet.rows;
  const columns = Math.max(sheet.headers?.length || 0, ...sheet.rows.map((row) => row.length), 1);
  const lines = rows.map((row) => Array.from({ length: columns }, (_unused, index) => csvCell(row[index], delimiter)).join(delimiter));
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

// ---- EPUB -----------------------------------------------------------------

function epubXhtml(title, bodyParts) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"/><title>${escHtml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${bodyParts.join('\n')}
</body>
</html>
`;
}

function renderEpub(doc) {
  // Split into chapters at level-1 headings so readers get a usable table of
  // contents instead of one huge scroll.
  const chapters = [];
  let current = { title: doc.title, blocks: [] };
  for (const block of doc.blocks) {
    if (block.type === 'heading' && block.level === 1) {
      if (current.blocks.length) chapters.push(current);
      current = { title: block.text, blocks: [block] };
    } else {
      current.blocks.push(block);
    }
  }
  if (current.blocks.length) chapters.push(current);
  if (!chapters.length) chapters = [{ title: doc.title, blocks: [] }];

  const images = [];
  let imageIndex = 0;

  const chapterHtml = chapters.map((chapter) => {
    const parts = [];
    for (const block of chapter.blocks) {
      if (block.type === 'heading') {
        const tag = `h${Math.min(6, Math.max(1, block.level))}`;
        parts.push(`<${tag}>${escHtml(plainText(parseInline(block.text)))}</${tag}>`);
      } else if (block.type === 'paragraph') {
        const runs = parseInline(block.text).map((run) => {
          let out = escHtml(run.text);
          if (run.code) out = `<code>${out}</code>`;
          if (run.italic) out = `<em>${out}</em>`;
          if (run.bold) out = `<strong>${out}</strong>`;
          return out;
        }).join('');
        parts.push(`<p>${runs}</p>`);
      } else if (block.type === 'bullets' || block.type === 'numbers') {
        const tag = block.type === 'bullets' ? 'ul' : 'ol';
        parts.push(`<${tag}>${block.items.map((item) => `<li>${escHtml(plainText(parseInline(item)))}</li>`).join('')}</${tag}>`);
      } else if (block.type === 'table') {
        const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
        const head = block.headers.length ? `<thead><tr>${block.headers.map((cell) => `<th>${escHtml(cell)}</th>`).join('')}</tr></thead>` : '';
        const body = block.rows.map((row) => `<tr>${Array.from({ length: columns }, (_unused, index) => `<td>${escHtml(row[index] ?? '')}</td>`).join('')}</tr>`).join('');
        parts.push(`<table>${head}<tbody>${body}</tbody></table>`);
      } else if (block.type === 'code') {
        parts.push(`<pre><code>${escHtml(block.text)}</code></pre>`);
      } else if (block.type === 'quote') {
        parts.push(`<blockquote><p>${escHtml(plainText(parseInline(block.text)))}</p></blockquote>`);
      } else if (block.type === 'image') {
        const resolved = path.isAbsolute(block.path) ? block.path : path.resolve(doc.baseDir, block.path);
        const record = inspectImage(resolved);
        imageIndex += 1;
        const ext = record.kind === 'png' ? 'png' : 'jpeg';
        images.push({ name: `images/image${imageIndex}.${ext}`, data: record.buffer, mime: record.mime });
        parts.push(`<figure><img src="images/image${imageIndex}.${ext}" alt="${escHtml(block.caption || '')}"/>`
          + (block.caption ? `<figcaption>${escHtml(block.caption)}</figcaption>` : '') + '</figure>');
      }
    }
    return parts.join('\n');
  });

  const chapterFiles = chapterHtml.map((body, index) => ({
    name: `chapter${index + 1}.xhtml`,
    data: epubXhtml(chapters[index].title, body ? [body] : ['<p></p>']),
  }));

  const css = `
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.6; margin: 0 5%; color: #1b2027; }
h1 { font-size: 1.7em; margin: 1.4em 0 .5em; } h2 { font-size: 1.35em; margin: 1.3em 0 .4em; } h3 { font-size: 1.15em; margin: 1.1em 0 .3em; }
p { margin: 0 0 .9em; } code { font-family: Menlo, Consolas, monospace; font-size: .9em; background: #f2f3f5; padding: 0 .2em; }
pre { background: #f4f5f7; padding: .8em; overflow-x: auto; font-size: .85em; }
table { width: 100%; border-collapse: collapse; margin: 0 0 1em; font-size: .92em; }
th, td { border: 1px solid #d7dbe1; padding: .4em .5em; text-align: left; } th { background: #eef1f5; }
blockquote { margin: 0 0 1em; padding-left: 1em; border-left: 3px solid #c3c8d0; color: #4a5160; font-style: italic; }
figure { margin: 0 0 1.2em; text-align: center; } img { max-width: 100%; } figcaption { font-size: .85em; color: #7b8492; }
`;

  const uuid = `urn:uuid:${doc.created.getTime().toString(16).padStart(12, '0')}-caelix`;
  const stamp = doc.created.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const manifestItems = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...chapterFiles.map((_file, index) => `<item id="chapter${index + 1}" href="chapter${index + 1}.xhtml" media-type="application/xhtml+xml"/>`),
    ...images.map((image, index) => `<item id="img${index + 1}" href="${image.name}" media-type="${image.mime}"/>`),
  ].join('\n    ');

  const spine = chapterFiles.map((_file, index) => `<itemref idref="chapter${index + 1}"/>`).join('\n    ');

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uuid}</dc:identifier>
    <dc:title>${escHtml(doc.title)}</dc:title>
    <dc:creator>${escHtml(doc.author)}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${stamp}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc"><h1>Contents</h1>
    <ol>
${chapters.map((chapter, index) => `      <li><a href="chapter${index + 1}.xhtml">${escHtml(chapter.title)}</a></li>`).join('\n')}
    </ol>
  </nav>
</body>
</html>
`;

  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/style.css', data: css },
    ...chapterFiles.map((file) => ({ name: `OEBPS/${file.name}`, data: file.data })),
    ...images.map((image) => ({ name: `OEBPS/${image.name}`, data: image.data })),
  ], { date: doc.created });
}

function renderSimple(doc) {
  switch (doc.format) {
    case 'rtf': return renderRtf(doc);
    case 'html': return renderHtml(doc);
    case 'md': return renderMarkdown(doc);
    case 'txt': return renderText(doc);
    case 'csv': return renderDelimited(doc, ',');
    case 'tsv': return renderDelimited(doc, '\t');
    case 'epub': return renderEpub(doc);
    default: throw new Error(`No writer for ${doc.format}.`);
  }
}

module.exports = { renderSimple };
