'use strict';

// Excel writer: real .xlsx with multiple sheets, a styled frozen header row,
// auto-sized columns, an autofilter and numeric cells kept numeric.

const { zip } = require('./zip');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitiseSheetName(name, index) {
  const cleaned = String(name || '').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

function columnLetter(index) {
  let value = index + 1;
  let out = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

function cellXml(value, rowIndex, columnIndex) {
  const ref = `${columnLetter(columnIndex)}${rowIndex + 1}`;
  const style = rowIndex === 0 ? ' s="1"' : ' s="2"';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = String(value ?? '');
  if (!text) return `<c r="${ref}"${style}/>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

function sheetXml(sheet) {
  const headers = sheet.headers || [];
  const rows = sheet.rows || [];
  const all = headers.length ? [headers, ...rows] : rows;
  const columns = Math.max(headers.length, ...rows.map((row) => row.length), 1);

  const widths = [];
  for (let column = 0; column < columns; column += 1) {
    let longest = 8;
    for (const row of all) {
      const value = row[column];
      const length = value === undefined || value === null ? 0 : String(value).length;
      longest = Math.max(longest, Math.min(60, length + 2));
    }
    widths.push(longest);
  }

  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');

  const rowXml = all.map((row, rowIndex) => {
    const cells = [];
    for (let column = 0; column < columns; column += 1) cells.push(cellXml(row[column], rowIndex, column));
    return `<row r="${rowIndex + 1}"${rowIndex === 0 && headers.length ? ' ht="20" customHeight="1"' : ''}>${cells.join('')}</row>`;
  }).join('');

  const lastColumn = columnLetter(columns - 1);
  const lastRow = Math.max(1, all.length);
  const filter = headers.length && all.length > 1 ? `<autoFilter ref="A1:${lastColumn}${lastRow}"/>` : '';
  const freeze = headers.length
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${freeze}
  <cols>${cols}</cols>
  <sheetData>${rowXml}</sheetData>
  ${filter}
</worksheet>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F5"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFC9CED6"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function renderXlsx(doc) {
  const sheets = (doc.sheets && doc.sheets.length ? doc.sheets : [{ name: 'Sheet1', headers: [], rows: doc.rows || [] }])
    .map((sheet, index) => ({
      name: sanitiseSheetName(sheet.name, index),
      headers: sheet.headers || [],
      rows: sheet.rows || [],
    }));

  // Sheet names must be unique or Excel refuses the workbook.
  const seen = new Set();
  for (const sheet of sheets) {
    let name = sheet.name;
    let suffix = 2;
    while (seen.has(name.toLowerCase())) {
      name = `${sheet.name.slice(0, 28)} ${suffix}`;
      suffix += 1;
    }
    seen.add(name.toLowerCase());
    sheet.name = name;
  }

  const entries = [];
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    '  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
  ];

  const workbookSheets = [];
  const workbookRels = [];
  sheets.forEach((sheet, index) => {
    const number = index + 1;
    contentTypes.push(`  <Override PartName="/xl/worksheets/sheet${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    entries.push({ name: `xl/worksheets/sheet${number}.xml`, data: sheetXml(sheet) });
    workbookSheets.push(`<sheet name="${esc(sheet.name)}" sheetId="${number}" r:id="rId${number}"/>`);
    workbookRels.push(`  <Relationship Id="rId${number}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${number}.xml"/>`);
  });
  contentTypes.push('</Types>');

  const stylesRelId = `rId${sheets.length + 1}`;
  workbookRels.push(`  <Relationship Id="${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets.join('')}</sheets>
</workbook>`;

  const stamp = doc.created.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${esc(doc.title)}</dc:title>
  <dc:creator>${esc(doc.author)}</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>
</cp:coreProperties>`;

  entries.push(
    { name: '[Content_Types].xml', data: contentTypes.join('\n') },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    },
    { name: 'xl/workbook.xml', data: workbook },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${workbookRels.join('\n')}
</Relationships>`,
    },
    { name: 'xl/styles.xml', data: stylesXml() },
    { name: 'docProps/core.xml', data: core },
    {
      name: 'docProps/app.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>CAELIX</Application>
</Properties>`,
    },
  );

  return zip(entries, { date: doc.created });
}

module.exports = { renderXlsx, XLSX_MIME };
