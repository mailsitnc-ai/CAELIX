'use strict';

// OpenDocument writer: .odt, .ods and .odp packages that LibreOffice,
// OpenOffice, Pages/Numbers/Keynote (via import) and Google Docs open. The
// `mimetype` member is stored first and uncompressed, as ODF requires.

const path = require('path');
const { zip } = require('./zip');
const { inspectImage } = require('./media');
const { parseInline, plainText } = require('./inline');

const MIMES = {
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"',
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
].join(' ');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function spanRuns(runs) {
  return runs.map((run) => {
    if (!run.bold && !run.italic && !run.strike) return esc(run.text).replace(/\n/g, ' ');
    const styles = [run.bold ? 'Bold' : '', run.italic ? 'Italic' : ''].filter(Boolean).join('_');
    if (!styles) return run.strike ? `<text:s/>` : esc(run.text);
    return `<text:span text:style-name="T${styles}">${esc(run.text)}</text:span>`;
  }).join('');
}

function imageFrame({ record, href, name, widthCm }) {
  const width = widthCm || Math.min(15, (record.width / 96) * 2.54);
  const height = width * (record.height / record.width);
  return `<draw:frame draw:name="${esc(name)}" text:anchor-type="as-char" svg:width="${width.toFixed(2)}cm" svg:height="${height.toFixed(2)}cm">`
    + `<draw:image xlink:href="${href}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>`
    + '</draw:frame>';
}

function stylesXml(kind) {
  const pageLayout = kind === 'odp'
    ? '<style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="33.867cm" fo:page-height="19.05cm" style:print-orientation="landscape" fo:margin="1cm"/></style:page-layout>'
    : '<style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2.2cm" fo:margin-bottom="2.2cm" fo:margin-left="2.2cm" fo:margin-right="2.2cm"/></style:page-layout>';
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.2">
  <office:font-face-decls>
    <style:font-face style:name="Calibri" svg:font-family="Calibri"/>
    <style:font-face style:name="Liberation Mono" svg:font-family="'Liberation Mono',monospace" style:font-family-generic="modern"/>
  </office:font-face-decls>
  <office:styles>
    <style:default-style style:family="paragraph"><style:paragraph-properties fo:line-height="135%" fo:margin-bottom="0.14in"/><style:text-properties fo:font-size="11pt" style:font-name="Calibri"/></style:default-style>
    <style:style style:name="Standard" style:family="paragraph" style:class="text"/>
    <style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard">
      <style:paragraph-properties fo:margin-top="0.35in" fo:margin-bottom="0.14in" fo:keep-with-next="always"/>
      <style:text-properties fo:font-size="20pt" fo:font-weight="bold" fo:color="#141922"/>
    </style:style>
    <style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Standard">
      <style:paragraph-properties fo:margin-top="0.28in" fo:margin-bottom="0.1in" fo:keep-with-next="always"/>
      <style:text-properties fo:font-size="15pt" fo:font-weight="bold" fo:color="#1b2027"/>
    </style:style>
    <style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:parent-style-name="Standard">
      <style:paragraph-properties fo:margin-top="0.22in" fo:margin-bottom="0.08in" fo:keep-with-next="always"/>
      <style:text-properties fo:font-size="12.5pt" fo:font-weight="bold" fo:color="#262d38"/>
    </style:style>
    <style:style style:name="Title" style:family="paragraph" style:parent-style-name="Standard">
      <style:text-properties fo:font-size="28pt" fo:font-weight="bold" fo:color="#101419"/>
    </style:style>
    <style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Standard">
      <style:text-properties fo:font-size="13pt" fo:color="#5a6270"/>
    </style:style>
    <style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard">
      <style:paragraph-properties fo:background-color="#f4f5f7" fo:padding="0.08in" fo:margin-bottom="0.02in"/>
      <style:text-properties style:font-name="Liberation Mono" fo:font-size="9pt"/>
    </style:style>
    <style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard">
      <style:paragraph-properties fo:margin-left="0.35in" fo:border-left="2pt solid #c3c8d0" fo:padding-left="0.12in"/>
      <style:text-properties fo:font-style="italic" fo:color="#4a5160"/>
    </style:style>
    <style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph">
      <style:paragraph-properties fo:margin-bottom="0.04in"/><style:text-properties fo:font-size="9.5pt"/>
    </style:style>
    <style:style style:name="Table_20_Heading" style:display-name="Table Heading" style:family="paragraph">
      <style:paragraph-properties fo:margin-bottom="0.04in"/><style:text-properties fo:font-size="9.5pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
    <style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
    <style:style style:name="Bold_Italic" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style>
    <text:list-style style:name="L1">
      <text:list-level-style-bullet text:level="1" text:bullet-char="•">
        <style:list-level-properties text:space-before="0.25in" text:min-label-width="0.22in"/>
      </text:list-level-style-bullet>
    </text:list-style>
    <text:list-style style:name="L2">
      <text:list-level-style-number text:level="1" style:num-suffix="." style:num-format="1">
        <style:list-level-properties text:space-before="0.25in" text:min-label-width="0.25in"/>
      </text:list-level-style-number>
    </text:list-style>
  </office:styles>
  <office:automatic-styles>
    ${pageLayout}
    <style:style style:name="dp1" style:family="drawing-page"><style:drawing-page-properties presentation:background-visible="true" presentation:background-objects-visible="true"/></style:style>
    <style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none" draw:auto-grow-height="true"/></style:style>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Default" style:page-layout-name="PM1" draw:style-name="dp1"/>
  </office:master-styles>
</office:document-styles>`;
}

function contentXml({ kind, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.2">
  <office:automatic-styles>
    <style:style style:name="Table1" style:family="table"><style:table-properties table:align="margins" style:width="100%"/></style:style>
    <style:style style:name="Table1.A" style:family="table-column"><style:table-column-properties style:column-width="2.4cm"/></style:style>
    <style:style style:name="Table1.Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.06in" fo:border="0.5pt solid #c9ced6"/></style:style>
    <style:style style:name="Table1.Header" style:family="table-cell"><style:table-cell-properties fo:padding="0.06in" fo:border="0.5pt solid #c9ced6" fo:background-color="#eef1f5"/></style:style>
  </office:automatic-styles>
  <office:body>
    <office:${kind === 'ods' ? 'spreadsheet' : kind === 'odp' ? 'presentation' : 'text'}>
${body}
    </office:${kind === 'ods' ? 'spreadsheet' : kind === 'odp' ? 'presentation' : 'text'}>
  </office:body>
</office:document-content>`;
}

function renderTextDocument(doc) {
  const parts = [];
  const images = [];
  parts.push(`<text:p text:style-name="Title">${esc(doc.title)}</text:p>`);
  if (doc.subtitle) parts.push(`<text:p text:style-name="Subtitle">${esc(doc.subtitle)}</text:p>`);
  parts.push(`<text:p text:style-name="Subtitle">${esc([doc.author, doc.created.toISOString().slice(0, 10)].filter(Boolean).join('  ·  '))}</text:p>`);

  let imageIndex = 0;
  for (const block of doc.blocks) {
    if (block.type === 'heading') {
      const level = Math.min(3, block.level);
      parts.push(`<text:h text:outline-level="${level}" text:style-name="Heading_20_${level}">${spanRuns(parseInline(block.text))}</text:h>`);
    } else if (block.type === 'paragraph') {
      parts.push(`<text:p text:style-name="Standard">${spanRuns(parseInline(block.text))}</text:p>`);
    } else if (block.type === 'bullets' || block.type === 'numbers') {
      const styleName = block.type === 'bullets' ? 'L1' : 'L2';
      const items = block.items.map((item) => `<text:list-item><text:p text:style-name="Standard">${spanRuns(parseInline(item))}</text:p></text:list-item>`).join('');
      parts.push(`<text:list text:style-name="${styleName}">${items}</text:list>`);
    } else if (block.type === 'table') {
      const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
      const rows = block.headers.length ? [block.headers, ...block.rows] : block.rows;
      const bodyRows = rows.map((row, rowIndex) => {
        const header = block.headers.length > 0 && rowIndex === 0;
        const cells = Array.from({ length: columns }, (_unused, column) => {
          const style = header ? 'Table1.Header' : 'Table1.Cell';
          const paragraphStyle = header ? 'Table_20_Heading' : 'Table_20_Contents';
          return `<table:table-cell table:style-name="${style}" office:value-type="string"><text:p text:style-name="${paragraphStyle}">${esc(row[column] ?? '')}</text:p></table:table-cell>`;
        }).join('');
        return `<table:table-row>${cells}</table:table-row>`;
      }).join('');
      parts.push(`<table:table table:name="Table1" table:style-name="Table1"><table:table-column table:style-name="Table1.A" table:number-columns-repeated="${columns}"/>${bodyRows}</table:table><text:p/>`);
    } else if (block.type === 'code') {
      for (const line of String(block.text || '').split('\n')) {
        parts.push(`<text:p text:style-name="Preformatted_20_Text">${esc(line || ' ')}</text:p>`);
      }
    } else if (block.type === 'quote') {
      parts.push(`<text:p text:style-name="Quotations">${spanRuns(parseInline(block.text))}</text:p>`);
    } else if (block.type === 'image') {
      const resolved = path.isAbsolute(block.path) ? block.path : path.resolve(doc.baseDir, block.path);
      const record = inspectImage(resolved);
      imageIndex += 1;
      const ext = record.kind === 'png' ? 'png' : record.kind === 'jpeg' ? 'jpg' : 'gif';
      const href = `Pictures/image${imageIndex}.${ext}`;
      images.push({ name: href, data: record.buffer, mime: record.mime });
      parts.push(`<text:p text:style-name="Standard">${imageFrame({ record, href, name: `Image${imageIndex}` })}</text:p>`);
    } else if (block.type === 'pagebreak') {
      parts.push('<text:p text:style-name="Standard"><text:soft-page-break/></text:p>');
    }
  }
  return { body: parts.join('\n      '), images };
}

function renderSheet(doc) {
  const sheets = doc.sheets && doc.sheets.length ? doc.sheets : [{ name: 'Sheet1', headers: [], rows: doc.rows || [] }];
  const parts = [];
  for (const sheet of sheets) {
    const rows = sheet.headers && sheet.headers.length ? [sheet.headers, ...sheet.rows] : sheet.rows;
    const columns = Math.max(sheet.headers?.length || 0, ...sheet.rows.map((row) => row.length), 1);
    const bodyRows = rows.map((row) => {
      const cells = Array.from({ length: columns }, (_unused, column) => {
        const value = row[column];
        if (typeof value === 'number' && Number.isFinite(value)) {
          return `<table:table-cell office:value-type="float" office:value="${value}"><text:p>${value}</text:p></table:table-cell>`;
        }
        return `<table:table-cell office:value-type="string"><text:p>${esc(value ?? '')}</text:p></table:table-cell>`;
      }).join('');
      return `<table:table-row>${cells}</table:table-row>`;
    }).join('');
    parts.push(`<table:table table:name="${esc(sheet.name || 'Sheet1')}"><table:table-column table:number-columns-repeated="${columns}"/>${bodyRows}</table:table>`);
  }
  return { body: parts.join('\n      '), images: [] };
}

function renderSlides(doc) {
  const slides = doc.slides && doc.slides.length ? doc.slides : [{ title: doc.title, bullets: [] }];
  const parts = [];
  const images = [];
  let imageIndex = 0;

  slides.forEach((slide, index) => {
    const shapes = [];
    const isCover = index === 0 && !slide.subtitle && slide.bullets.length === 0;
    const titleStyle = isCover ? 'Title' : 'Heading_20_1';
    shapes.push(`<draw:frame draw:style-name="gr1" draw:name="Title ${index + 1}" text:anchor-type="absolute" svg:x="2cm" svg:y="1.6cm" svg:width="29.8cm" svg:height="3cm">`
      + `<draw:text-box><text:p text:style-name="${titleStyle}">${esc(slide.title || doc.title)}</text:p></draw:text-box></draw:frame>`);

    if (isCover && (slide.subtitle || doc.subtitle)) {
      shapes.push(`<draw:frame draw:style-name="gr1" draw:name="Subtitle" text:anchor-type="absolute" svg:x="2cm" svg:y="4.8cm" svg:width="29.8cm" svg:height="2cm">`
        + `<draw:text-box><text:p text:style-name="Subtitle">${esc(slide.subtitle || doc.subtitle)}</text:p></draw:text-box></draw:frame>`);
    }

    if (slide.bullets && slide.bullets.length) {
      const items = slide.bullets.map((item) => `<text:p text:style-name="Standard">• ${spanRuns(parseInline(item))}</text:p>`).join('');
      shapes.push(`<draw:frame draw:style-name="gr1" draw:name="Body ${index + 1}" text:anchor-type="absolute" svg:x="2.2cm" svg:y="5cm" svg:width="29.4cm" svg:height="11cm">`
        + `<draw:text-box>${items}</draw:text-box></draw:frame>`);
    }

    let offsetY = 12;
    for (const block of slide.blocks || []) {
      if (block.type === 'image') {
        const resolved = path.isAbsolute(block.path) ? block.path : path.resolve(doc.baseDir, block.path);
        const record = inspectImage(resolved);
        imageIndex += 1;
        const ext = record.kind === 'png' ? 'png' : record.kind === 'jpeg' ? 'jpg' : 'gif';
        const href = `Pictures/image${imageIndex}.${ext}`;
        images.push({ name: href, data: record.buffer, mime: record.mime });
        shapes.push(`<draw:frame draw:style-name="gr1" draw:name="Picture ${imageIndex}" text:anchor-type="absolute" svg:x="12cm" svg:y="${offsetY}cm" svg:width="14cm" svg:height="${(14 * record.height / record.width).toFixed(2)}cm">`
          + `<draw:image xlink:href="${href}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`);
        offsetY += 1;
      }
    }

    parts.push(`<draw:page draw:name="Slide${index + 1}" draw:style-name="dp1" draw:master-page-name="Default">
      ${shapes.join('\n      ')}
    </draw:page>`);
  });

  return { body: parts.join('\n      '), images };
}

function manifestXml(kind, images) {
  const mime = MIMES[kind];
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${mime}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/>
${images.map((image) => `  <manifest:file-entry manifest:full-path="${image.name}" manifest:media-type="${image.mime}"/>`).join('\n')}
</manifest:manifest>`;
}

function renderOdf(doc) {
  const kind = doc.format;
  const rendered = kind === 'ods' ? renderSheet(doc) : kind === 'odp' ? renderSlides(doc) : renderTextDocument(doc);
  const stamp = doc.created.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NS} office:version="1.2">
  <office:meta>
    <dc:title>${esc(doc.title)}</dc:title>
    <dc:creator>${esc(doc.author)}</dc:creator>
    <meta:creation-date>${stamp}</meta:creation-date>
    <meta:generator>CAELIX</meta:generator>
  </office:meta>
</office:document-meta>`;

  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-settings ${NS} office:version="1.2"><office:settings/></office:document-settings>`;

  const entries = [
    { name: 'mimetype', data: MIMES[kind], store: true },
    { name: 'content.xml', data: contentXml({ kind, body: rendered.body }) },
    { name: 'styles.xml', data: stylesXml(kind) },
    { name: 'meta.xml', data: meta },
    { name: 'settings.xml', data: settings },
    { name: 'META-INF/manifest.xml', data: manifestXml(kind, rendered.images) },
    ...rendered.images,
  ];

  return zip(entries, { date: doc.created });
}

module.exports = { renderOdf, ODF_MIMES: MIMES };
