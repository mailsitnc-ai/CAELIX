'use strict';

// Image inspection and, for PDF only, PNG raster decoding. Office formats can
// embed PNG/JPEG bytes untouched; PDF needs either JPEG (DCTDecode) or raw RGB
// samples, so PNGs are decoded and re-deflated here.

const fs = require('fs');
const zlib = require('zlib');

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504E47) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xFF) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function gifSize(buffer) {
  if (buffer.length < 10 || buffer.toString('ascii', 0, 3) !== 'GIF') return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

// Resolve an image path into bytes plus metadata. Relative paths are resolved
// against the document's working directory by the caller.
function inspectImage(file) {
  const buffer = fs.readFileSync(file);
  const png = pngSize(buffer);
  if (png) return { kind: 'png', ...png, buffer, mime: 'image/png' };
  const jpeg = jpegSize(buffer);
  if (jpeg) return { kind: 'jpeg', ...jpeg, buffer, mime: 'image/jpeg' };
  const gif = gifSize(buffer);
  if (gif) return { kind: 'gif', ...gif, buffer, mime: 'image/gif' };
  throw new Error(`Unsupported image: ${file} (use PNG or JPEG).`);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Decode a non-interlaced PNG into 8-bit RGB. Returns { width, height, rgb }.
function pngToRgb(buffer) {
  const size = pngSize(buffer);
  if (!size) throw new Error('Not a PNG image.');
  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const dataChunks = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const data = buffer.subarray(start, start + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      dataChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = start + length + 4;
  }

  if (!header) throw new Error('PNG has no header.');
  if (header.interlace !== 0) throw new Error('Interlaced PNGs are not supported; re-save without interlacing.');
  if (header.depth !== 8 && header.depth !== 16) throw new Error('Unsupported PNG bit depth.');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  if (!channels) throw new Error('Unsupported PNG colour type.');

  const raw = zlib.inflateSync(Buffer.concat(dataChunks));
  const bytesPerSample = header.depth / 8;
  const stride = Math.ceil((header.width * channels * header.depth) / 8);
  const bpp = Math.max(1, channels * bytesPerSample);
  const pixels = Buffer.alloc(stride * header.height);
  let position = 0;

  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[position];
    position += 1;
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[position + x];
      const left = x >= bpp ? pixels[rowStart + x - bpp] : 0;
      const up = y > 0 ? pixels[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[prevStart + x - bpp] : 0;
      let out;
      if (filter === 0) out = value;
      else if (filter === 1) out = value + left;
      else if (filter === 2) out = value + up;
      else if (filter === 3) out = value + ((left + up) >> 1);
      else if (filter === 4) out = value + paeth(left, up, upLeft);
      else throw new Error('Corrupt PNG row filter.');
      pixels[rowStart + x] = out & 0xFF;
    }
    position += stride;
  }

  const rgb = Buffer.alloc(header.width * header.height * 3);
  const sample = (row, index) => {
    const base = row * stride + index * bytesPerSample;
    return header.depth === 16 ? pixels[base] : pixels[base];
  };
  const transparentGray = transparency && header.colorType === 0 ? transparency.readUInt16BE(0) & 0xFF : null;

  for (let y = 0; y < header.height; y += 1) {
    for (let x = 0; x < header.width; x += 1) {
      let r;
      let g;
      let b;
      const index = y * header.width + x;
      if (header.colorType === 2) {
        r = sample(y, x * 3);
        g = sample(y, x * 3 + 1);
        b = sample(y, x * 3 + 2);
      } else if (header.colorType === 6) {
        r = sample(y, x * 4);
        g = sample(y, x * 4 + 1);
        b = sample(y, x * 4 + 2);
        const alpha = sample(y, x * 4 + 3);
        if (alpha < 255) {
          r = Math.round((r * alpha + 255 * (255 - alpha)) / 255);
          g = Math.round((g * alpha + 255 * (255 - alpha)) / 255);
          b = Math.round((b * alpha + 255 * (255 - alpha)) / 255);
        }
      } else if (header.colorType === 0) {
        const gray = sample(y, x);
        r = transparentGray !== null && gray === transparentGray ? 255 : gray;
        g = r;
        b = r;
      } else if (header.colorType === 4) {
        const gray = sample(y, x * 2);
        const alpha = sample(y, x * 2 + 1);
        r = Math.round((gray * alpha + 255 * (255 - alpha)) / 255);
        g = r;
        b = r;
      } else {
        if (!palette) throw new Error('Indexed PNG has no palette.');
        const entry = sample(y, x);
        r = palette[entry * 3];
        g = palette[entry * 3 + 1];
        b = palette[entry * 3 + 2];
      }
      rgb[index * 3] = r;
      rgb[index * 3 + 1] = g;
      rgb[index * 3 + 2] = b;
    }
  }

  return { width: header.width, height: header.height, rgb };
}

module.exports = { inspectImage, pngToRgb, pngSize, jpegSize };
