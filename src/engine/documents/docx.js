'use strict';

// Word writer. Produces a real OOXML package: styles, numbered lists, tables
// with borders and header shading, monospace code blocks and inline images.

const path = require('path');
const { zip } = require('./zip');
const { inspectImage } = require('./media');
const { parseInline } = require('./inline');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const EMU_PER_INCH = 914400;
const MAX_IMAGE_EMU = Math.round(6 * EMU_PER_INCH);

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function runXml(run, { size = null, forceCode = false } = {}) {
  const properties = [];
  if (run.bold) properties.push('<w:b/>');
  if (run.italic) properties.push('<w:i/>');
  if (run.strike) properties.push('<w:strike/>');
  if (run.code || forceCode) {
    properties.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>');
    properties.push('<w:shd w:val="clear" w:color="auto" w:fill="F1F2F4"/>');
  }
  if (size) properties.push(`<w:sz w:val="${Math.round(size * 2)}"/>`);
  const rPr = properties.length ? `<w:rPr>${properties.join('')}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
}

function paragraph(runs, { style = null, extra = '' } = {}) {
  const pPr = style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : '';
  return `<w:p>${pPr}${runs.map((run) => runXml(run)).join('')}</w:p>`;
}

function listParagraph(text, numId, level = 0) {
  const runs = parseInline(text);
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>`
    + `${runs.map((run) => runXml(run)).join('')}</w:p>`;
}

function buildStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
      <w:sz w:val="22"/><w:szCs w:val="22"/>
      <w:lang w:val="en-GB"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:before="0" w:after="180"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:sz w:val="56"/><w:color w:val="1B2027"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:after="120"/></w:pPr>
    <w:rPr><w:sz w:val="28"/><w:color w:val="5A6270"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="320" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="141922"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="260" w:after="110"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="1B2027"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="200" w:after="90"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="262D38"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="60" w:after="60" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F4F5F7"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="18"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="C3C8D0"/></w:pBdr></w:pPr>
    <w:rPr><w:i/><w:color w:val="4A5160"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr>
  </w:style>
  <w:style w:type="table" w:styleId="TableGrid">
    <w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>
      <w:top w:val="single" w:sz="4" w:space="0" w:color="C9CED6"/>
      <w:left w:val="single" w:sz="4" w:space="0" w:color="C9CED6"/>
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="C9CED6"/>
      <w:right w:val="single" w:sz="4" w:space="0" w:color="C9CED6"/>
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="C9CED6"/>
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="C9CED6"/>
    </w:tblBorders></w:tblPr>
  </w:style>
</w:styles>`;
}

function buildNumbering() {
  const bullet = ['•', '◦', '▪'].map((char, level) => `
      <w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>
        <w:lvlText w:val="${char}"/><w:lvlJc w:val="left"/>
        <w:pPr><w:ind w:left="${720 + level * 360}" w:hanging="360"/></w:pPr>
      </w:lvl>`).join('');
  const decimal = [1, 2, 3].map((level) => `
      <w:lvl w:ilvl="${level - 1}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
        <w:lvlText w:val="%${level}."/><w:lvlJc w:val="left"/>
        <w:pPr><w:ind w:left="${720 + (level - 1) * 360}" w:hanging="360"/></w:pPr>
      </w:lvl>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bullet}</w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${decimal}</w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
}

function tableXml(block, widths) {
  const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
  const header = block.headers.length ? block.headers : null;
  const rows = header ? block.rows : block.rows;
  const grid = widths.map((width) => `<w:gridCol w:w="${Math.round(width)}"/>`).join('');

  const cell = (value, width, isHeader) => `<w:tc><w:tcPr><w:tcW w:w="${Math.round(width)}" w:type="dxa"/>`
    + (isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF1F5"/>' : '')
    + '</w:tcPr>'
    + `<w:p><w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr>`
    + `${parseInline(value).map((run) => runXml(isHeader ? { ...run, bold: true } : run)).join('')}</w:p></w:tc>`;

  const headerRow = header
    ? `<w:tr><w:trPr><w:tblHeader/></w:trPr>${header.map((value, index) => cell(value, widths[index], true)).join('')}</w:tr>`
    : '';

  const bodyRows = rows.map((row) => {
    const cells = [];
    for (let index = 0; index < columns; index += 1) cells.push(cell(row[index] ?? '', widths[index], false));
    return `<w:tr>${cells.join('')}</w:tr>`;
  }).join('');

  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>`
    + '<w:tblLayout w:type="fixed"/></w:tblPr>'
    + `<w:tblGrid>${grid}</w:tblGrid>${headerRow}${bodyRows}</w:tbl><w:p/>`;
}

function imageXml(record, imageIndex) {
  const maxWidth = Math.min(record.width * 9525, MAX_IMAGE_EMU);
  const ratio = record.height / record.width;
  const width = Math.round(maxWidth);
  const height = Math.round(maxWidth * ratio);
  const id = `rIdImage${imageIndex}`;
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="80" w:after="80"/></w:pPr><w:r><w:drawing>`
    + '<wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${width}" cy="${height}"/>`
    + '<wp:docPr id="1" name="Picture"/>'
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:nvPicPr><pic:cNvPr id="1" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>'
    + `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

function renderDocx(doc) {
  const body = [];
  const media = [];
  const relationships = [];

  body.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${runXml({ text: doc.title, bold: true })}</w:p>`);
  if (doc.subtitle) body.push(`<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr>${runXml({ text: doc.subtitle })}</w:p>`);

  const metaLine = [doc.author, doc.created.toISOString().slice(0, 10)].filter(Boolean).join('  ·  ');
  body.push(`<w:p><w:pPr><w:spacing w:after="240"/></w:pPr>${runXml({ text: metaLine, italic: true })}</w:p>`);

  let imageIndex = 0;
  for (const block of doc.blocks) {
    if (block.type === 'heading') {
      const style = `Heading${Math.min(3, block.level)}`;
      body.push(paragraph(parseInline(block.text), { style }));
    } else if (block.type === 'paragraph') {
      body.push(paragraph(parseInline(block.text)));
    } else if (block.type === 'bullets' || block.type === 'numbers') {
      const numId = block.type === 'bullets' ? 1 : 2;
      for (const item of block.items) body.push(listParagraph(item, numId));
    } else if (block.type === 'table') {
      const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
      const weights = [];
      for (let index = 0; index < columns; index += 1) {
        const cells = [block.headers[index] || '', ...block.rows.map((row) => row[index] || '')];
        weights.push(Math.min(48, Math.max(8, ...cells.map((value) => String(value).length))));
      }
      const total = weights.reduce((sum, value) => sum + value, 0) || 1;
      const widths = weights.map((value) => (value / total) * 9360);
      body.push(tableXml(block, widths));
    } else if (block.type === 'code') {
      for (const line of String(block.text || '').split('\n')) {
        body.push(`<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${runXml({ text: line || ' ', code: true })}</w:p>`);
      }
    } else if (block.type === 'quote') {
      body.push(paragraph(parseInline(block.text), { style: 'Quote' }));
    } else if (block.type === 'image') {
      const resolved = path.isAbsolute(block.path) ? block.path : path.resolve(doc.baseDir, block.path);
      const record = inspectImage(resolved);
      if (record.kind !== 'png' && record.kind !== 'jpeg') {
        throw new Error('Word documents embed PNG or JPEG images only.');
      }
      imageIndex += 1;
      media.push({
        name: `word/media/image${imageIndex}.${record.kind === 'png' ? 'png' : 'jpeg'}`,
        data: record.buffer,
      });
      relationships.push({
        id: `rIdImage${imageIndex}`,
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
        target: `media/image${imageIndex}.${record.kind === 'png' ? 'png' : 'jpeg'}`,
      });
      body.push(imageXml(record, imageIndex));
      if (block.caption) {
        body.push(`<w:p><w:pPr><w:jc w:val="center"/><w:pStyle w:val="Subtitle"/></w:pPr>${runXml({ text: block.caption, italic: true })}</w:p>`);
      }
    } else if (block.type === 'pagebreak') {
      body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>${body.join('')}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
${relationships.map((rel) => `  <Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"/>`).join('\n')}
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const stamp = doc.created.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${esc(doc.title)}</dc:title>
  <dc:creator>${esc(doc.author)}</dc:creator>
  <cp:lastModifiedBy>${esc(doc.author)}</cp:lastModifiedBy>
  <dc:subject>${esc(doc.subject)}</dc:subject>
  <dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>
</cp:coreProperties>`;

  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>CAELIX</Application>
</Properties>`;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: buildStyles() },
    { name: 'word/numbering.xml', data: buildNumbering() },
    { name: 'word/_rels/document.xml.rels', data: documentRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app },
    ...media,
  ];

  return zip(entries, { date: doc.created });
}

module.exports = { renderDocx, DOCX_MIME };
