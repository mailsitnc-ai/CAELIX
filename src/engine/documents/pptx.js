'use strict';

// PowerPoint writer. Builds a complete package (master, blank layout, theme)
// with a dark cover slide, light content slides, bulleted text, tables and
// images laid out on a 16:9 canvas.

const path = require('path');
const { zip } = require('./zip');
const { inspectImage } = require('./media');
const { parseInline, plainText } = require('./inline');

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const SLIDE_W = 12192000;
const SLIDE_H = 6858000;
const MARGIN = 838200;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function runXml(text, { size = 1800, bold = false, color = '1B2027', italic = false, code = false } = {}) {
  return `<a:r><a:rPr lang="en-GB" sz="${size}" b="${bold ? 1 : 0}" i="${italic ? 1 : 0}" dirty="0">`
    + `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`
    + `${code ? '<a:latin typeface="Consolas"/><a:cs typeface="Consolas"/>' : `<a:latin typeface="Calibri"/><a:cs typeface="Calibri"/>`}`
    + `</a:rPr><a:t>${esc(text)}</a:t></a:r>`;
}

function paragraphXml(text, options = {}) {
  const runs = parseInline(text);
  const body = runs.map((run) => runXml(plainText([run]), {
    ...options,
    bold: options.bold || run.bold,
    italic: options.italic || run.italic,
    code: options.code || run.code,
  })).join('');
  const bullet = options.bullet
    ? `<a:pPr marL="342900" indent="-342900" lvl="0"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>`
    : '<a:pPr/>';
  return `<a:p>${bullet}${body || '<a:endParaRPr lang="en-GB"/>'}</a:p>`;
}

function textBox({ id, x, y, width, height, paragraphs, anchor = 't' }) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(width)}" cy="${Math.round(height)}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
    + `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr>`
    + `<a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function rect({ id, x, y, width, height, color }) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Bar ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(width)}" cy="${Math.round(height)}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>`
    + '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>';
}

function picture({ id, relId, x, y, width, height, description }) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}" descr="${esc(description || '')}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(width)}" cy="${Math.round(height)}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
}

function tableFrame({ id, x, y, width, height, block }) {
  const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
  const rows = block.headers.length ? [block.headers, ...block.rows] : block.rows;
  const columnWidth = Math.round(width / columns);
  const rowHeight = Math.round(Math.min(457200, height / Math.max(1, rows.length)));

  const grid = Array.from({ length: columns }, () => `<a:gridCol w="${columnWidth}"/>`).join('');
  const body = rows.map((row, rowIndex) => {
    const cells = Array.from({ length: columns }, (_unused, column) => {
      const value = row[column] ?? '';
      const header = block.headers.length > 0 && rowIndex === 0;
      return '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>'
        + paragraphXml(String(value), { size: 1200, bold: header, color: header ? '101419' : '262D38' })
        + '</a:txBody><a:tcPr'
        + (header ? '><a:solidFill><a:srgbClr val="EEF1F5"/></a:solidFill></a:tcPr>' : '/>')
        + '</a:tc>';
    }).join('');
    return `<a:tr h="${rowHeight}">${cells}</a:tr>`;
  }).join('');

  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>`
    + `<p:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(width)}" cy="${Math.round(height)}"/></p:xfrm>`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
    + `<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${grid}</a:tblGrid>${body}</a:tbl>`
    + '</a:graphicData></a:graphic></p:graphicFrame>';
}

function slideXml({ shapes, background }) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    ${background ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : ''}
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${shapes.join('\n      ')}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function themeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="CAELIX">
  <a:themeElements>
    <a:clrScheme name="CAELIX">
      <a:dk1><a:srgbClr val="1B2027"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="22282F"/></a:dk2>
      <a:lt2><a:srgbClr val="F6F7F9"/></a:lt2>
      <a:accent1><a:srgbClr val="3B7DD8"/></a:accent1>
      <a:accent2><a:srgbClr val="5AA9E6"/></a:accent2>
      <a:accent3><a:srgbClr val="7ED0C0"/></a:accent3>
      <a:accent4><a:srgbClr val="F2B880"/></a:accent4>
      <a:accent5><a:srgbClr val="C7A0E8"/></a:accent5>
      <a:accent6><a:srgbClr val="E8838C"/></a:accent6>
      <a:hlink><a:srgbClr val="3B7DD8"/></a:hlink>
      <a:folHlink><a:srgbClr val="7A5AA6"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="CAELIX">
      <a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="CAELIX">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;
}

function slideMasterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3"
    accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`;
}

function slideLayoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

function renderPptx(doc) {
  const slides = doc.slides && doc.slides.length ? doc.slides : [{ title: doc.title, bullets: [] }];
  const entries = [];
  const media = [];
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    '  <Default Extension="png" ContentType="image/png"/>',
    '  <Default Extension="jpeg" ContentType="image/jpeg"/>',
    '  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    '  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
    '  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    '  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
  ];

  const slideIds = [];
  const presentationRels = [
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
    '  <Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>',
  ];

  let imageCounter = 0;
  slides.forEach((slide, index) => {
    const shapes = [];
    const slideRels = [];
    const slideNumber = index + 1;
    const isCover = index === 0 && !slide.subtitle && slide.bullets.length === 0;
    const background = isCover ? '0B0D10' : 'FFFFFF';
    const titleColor = isCover ? 'FFFFFF' : '101419';
    const bodyColor = isCover ? 'D7DDE6' : '262D38';

    if (isCover) {
      shapes.push(rect({ id: 2, x: MARGIN, y: 2900000, width: 1100000, height: 60000, color: '3B7DD8' }));
      shapes.push(textBox({
        id: 3,
        x: MARGIN,
        y: 2200000,
        width: SLIDE_W - MARGIN * 2,
        height: 640000,
        paragraphs: paragraphXml(slide.title || doc.title, { size: 4000, bold: true, color: titleColor }),
        anchor: 'b',
      }));
      const subtitle = slide.subtitle || doc.subtitle || [doc.author, doc.created.toISOString().slice(0, 10)].filter(Boolean).join('  ·  ');
      if (subtitle) {
        shapes.push(textBox({
          id: 4,
          x: MARGIN,
          y: 3060000,
          width: SLIDE_W - MARGIN * 2,
          height: 900000,
          paragraphs: paragraphXml(subtitle, { size: 1800, color: 'AEB6C2' }),
        }));
      }
    } else {
      shapes.push(rect({ id: 2, x: MARGIN, y: 560000, width: 900000, height: 46000, color: '3B7DD8' }));
      shapes.push(textBox({
        id: 3,
        x: MARGIN,
        y: 700000,
        width: SLIDE_W - MARGIN * 2,
        height: 900000,
        paragraphs: paragraphXml(slide.title || '', { size: 3000, bold: true, color: titleColor }),
      }));

      const hasImage = (slide.blocks || []).some((block) => block.type === 'image');
      const bodyWidth = hasImage ? (SLIDE_W - MARGIN * 2) * 0.5 : SLIDE_W - MARGIN * 2;
      const bodyTop = 1800000;
      const bodyHeight = SLIDE_H - bodyTop - 700000;

      if (slide.bullets.length) {
        const size = slide.bullets.length > 6 ? 1500 : slide.bullets.length > 4 ? 1700 : 1900;
        const paragraphs = slide.bullets.map((item) => paragraphXml(item, { size, color: bodyColor, bullet: true })).join('');
        shapes.push(textBox({ id: 4, x: MARGIN, y: bodyTop, width: bodyWidth, height: bodyHeight, paragraphs }));
      }

      let shapeId = 10;
      let offsetY = bodyTop;
      for (const block of slide.blocks || []) {
        if (block.type === 'table') {
          const height = Math.min(bodyHeight, 500000 + block.rows.length * 380000);
          shapes.push(tableFrame({ id: shapeId, x: MARGIN, y: offsetY, width: bodyWidth, height, block }));
          offsetY += height + 200000;
          shapeId += 1;
        } else if (block.type === 'image') {
          const resolved = path.isAbsolute(block.path) ? block.path : path.resolve(doc.baseDir, block.path);
          const record = inspectImage(resolved);
          if (record.kind !== 'png' && record.kind !== 'jpeg') throw new Error('Slides embed PNG or JPEG images only.');
          imageCounter += 1;
          const relId = `rIdImage${slideNumber}_${imageCounter}`;
          const fileName = `ppt/media/image${imageCounter}.${record.kind === 'png' ? 'png' : 'jpeg'}`;
          media.push({ name: fileName, data: record.buffer });
          slideRels.push(`  <Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${imageCounter}.${record.kind === 'png' ? 'png' : 'jpeg'}"/>`);
          const maxWidth = SLIDE_W - MARGIN * 2 - 400000;
          const maxHeight = SLIDE_H - offsetY - 700000;
          let width = maxWidth;
          let height = width * (record.height / record.width);
          if (height > maxHeight) {
            height = maxHeight;
            width = height * (record.width / record.height);
          }
          shapes.push(picture({
            id: shapeId,
            relId,
            x: MARGIN + ((SLIDE_W - MARGIN * 2) - width) / 2,
            y: offsetY + Math.max(0, (maxHeight - height) / 2),
            width,
            height,
            description: block.caption || 'Image',
          }));
          offsetY += height + 200000;
          shapeId += 1;
        }
      }
    }

    entries.push({ name: `ppt/slides/slide${slideNumber}.xml`, data: slideXml({ shapes, background }) });
    entries.push({
      name: `ppt/slides/_rels/slide${slideNumber}.xml.rels`,
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdLayout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
${slideRels.join('\n')}
</Relationships>`,
    });

    contentTypes.push(`  <Override PartName="/ppt/slides/slide${slideNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    slideIds.push(`<p:sldId id="${255 + slideNumber}" r:id="rIdSlide${slideNumber}"/>`);
    presentationRels.push(`  <Relationship Id="rIdSlide${slideNumber}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNumber}.xml"/>`);
  });
  contentTypes.push('</Types>');

  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideIds.join('')}</p:sldIdLst>
  <p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

  const stamp = doc.created.toISOString().replace(/\.\d{3}Z$/, 'Z');

  entries.push(
    { name: '[Content_Types].xml', data: contentTypes.join('\n') },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    },
    { name: 'ppt/presentation.xml', data: presentation },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${presentationRels.join('\n')}
</Relationships>`,
    },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: slideMasterXml() },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
    },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: slideLayoutXml() },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
    },
    { name: 'ppt/theme/theme1.xml', data: themeXml() },
    {
      name: 'docProps/core.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${esc(doc.title)}</dc:title>
  <dc:creator>${esc(doc.author)}</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>
</cp:coreProperties>`,
    },
    {
      name: 'docProps/app.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>CAELIX</Application>
  <Slides>${slides.length}</Slides>
</Properties>`,
    },
    ...media,
  );

  return zip(entries, { date: doc.created });
}

module.exports = { renderPptx, PPTX_MIME };
