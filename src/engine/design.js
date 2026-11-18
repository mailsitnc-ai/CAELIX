'use strict';

// Design fidelity checking for pages the agent writes.
//
// Models happily ship a white page with black text when the user asked for
// "dark blue liquid glass". This module reads the CSS the agent actually wrote
// and reports what the page will look like, so "done" can be checked instead of
// assumed. It is static analysis: it cannot see styles a script applies later.

const fs = require('fs');
const path = require('path');

// ---- CSS reading ----------------------------------------------------------

function stripComments(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitDeclarations(text) {
  const out = [];
  let buffer = '';
  let depth = 0;
  let quote = null;
  for (const char of String(text || '')) {
    if (quote) {
      buffer += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; buffer += char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ';' && depth === 0) {
      const piece = buffer.trim();
      buffer = '';
      if (!piece) continue;
      const colon = piece.indexOf(':');
      if (colon < 0) continue;
      out.push([piece.slice(0, colon).trim().toLowerCase(), piece.slice(colon + 1).trim()]);
      continue;
    }
    buffer += char;
  }
  const piece = buffer.trim();
  if (piece) {
    const colon = piece.indexOf(':');
    if (colon > 0) out.push([piece.slice(0, colon).trim().toLowerCase(), piece.slice(colon + 1).trim()]);
  }
  return out;
}

// Walk CSS into { selector, context, declarations, children } nodes. Works for
// nested at-rules like @media and @supports without a full parser.
function parseBlocks(css) {
  const roots = [];
  const stack = [];
  let buffer = '';
  for (const char of String(css || '')) {
    if (char === '{') {
      const node = { selector: buffer.trim(), context: [], declarations: [], children: [] };
      buffer = '';
      if (stack.length) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      stack.push(node);
      continue;
    }
    if (char === '}') {
      const node = stack.pop();
      if (node && buffer.trim()) node.declarations.push(...splitDeclarations(buffer));
      buffer = '';
      continue;
    }
    buffer += char;
  }
  return roots;
}

function flatten(nodes, context = [], out = []) {
  for (const node of nodes) {
    const chain = [...context, node.selector];
    for (const declaration of node.declarations) {
      out.push({ selector: node.selector, chain, property: declaration[0], value: declaration[1] });
    }
    flatten(node.children, chain, out);
  }
  return out;
}

// ---- colours --------------------------------------------------------------

const NAMED = {
  transparent: [0, 0, 0, 0],
  white: [255, 255, 255, 1],
  black: [0, 0, 0, 1],
  silver: [192, 192, 192, 1],
  gray: [128, 128, 128, 1],
  grey: [128, 128, 128, 1],
  whitesmoke: [245, 245, 245, 1],
  snow: [255, 250, 250, 1],
  ivory: [255, 255, 240, 1],
  navy: [0, 0, 128, 1],
  blue: [0, 0, 255, 1],
  darkblue: [0, 0, 139, 1],
  midnightblue: [25, 25, 112, 1],
  royalblue: [65, 105, 225, 1],
  steelblue: [70, 130, 180, 1],
  skyblue: [135, 206, 235, 1],
  lightblue: [173, 216, 230, 1],
  cyan: [0, 255, 255, 1],
  teal: [0, 128, 128, 1],
  purple: [128, 0, 128, 1],
  indigo: [75, 0, 130, 1],
  red: [255, 0, 0, 1],
  crimson: [220, 20, 60, 1],
  green: [0, 128, 0, 1],
  orange: [255, 165, 0, 1],
  gold: [255, 215, 0, 1],
  pink: [255, 192, 203, 1],
  violet: [238, 130, 238, 1],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseColorToken(token) {
  const value = String(token || '').trim().toLowerCase();
  if (!value) return null;
  if (NAMED[value]) {
    const [r, g, b, a] = NAMED[value];
    return { r, g, b, a };
  }
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const parts = hex.split('').map((char) => parseInt(char + char, 16));
      if (parts.some((part) => Number.isNaN(part))) return null;
      return { r: parts[0], g: parts[1], b: parts[2], a: hex.length === 4 ? parts[3] / 255 : 1 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const parts = [];
      for (let index = 0; index < hex.length; index += 2) parts.push(parseInt(hex.slice(index, index + 2), 16));
      if (parts.some((part) => Number.isNaN(part))) return null;
      return { r: parts[0], g: parts[1], b: parts[2], a: hex.length === 8 ? parts[3] / 255 : 1 };
    }
    return null;
  }
  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[\s,/]+/).filter(Boolean);
    const channel = (part) => (part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part));
    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    if ([r, g, b].some((part) => Number.isNaN(part))) return null;
    const a = parts[3] === undefined ? 1 : (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]));
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: Number.isNaN(a) ? 1 : clamp(a, 0, 1) };
  }
  const hslMatch = value.match(/^hsla?\(([^)]+)\)$/);
  if (hslMatch) {
    const parts = hslMatch[1].split(/[\s,/]+/).filter(Boolean);
    const h = ((parseFloat(parts[0]) % 360) + 360) % 360;
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    const a = parts[3] === undefined ? 1 : parseFloat(parts[3]);
    if ([h, s, l].some((part) => Number.isNaN(part))) return null;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const table = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return {
      r: Math.round((table[0] + m) * 255),
      g: Math.round((table[1] + m) * 255),
      b: Math.round((table[2] + m) * 255),
      a: Number.isNaN(a) ? 1 : clamp(a, 0, 1),
    };
  }
  return null;
}

// Every colour mentioned in a value, in order (gradients carry several).
function colorsIn(value) {
  const text = String(value || '').toLowerCase();
  const found = [];
  const pattern = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b[a-z]+\b/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (match[0].startsWith('linear') || match[0].startsWith('radial')) continue;
    const color = parseColorToken(match[0]);
    if (color) found.push(color);
  }
  return found;
}

function toHsl({ r, g, b }) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

function luminance({ r, g, b }) {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a, b) {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function colorLabel(color) {
  if (!color) return 'unset';
  const hex = `#${[color.r, color.g, color.b].map((part) => Math.round(part).toString(16).padStart(2, '0')).join('')}`;
  return color.a < 1 ? `${hex} @ ${Math.round(color.a * 100)}%` : hex;
}

// ---- page reading ---------------------------------------------------------

function readCss(doc, file) {
  const parts = [];
  const styles = doc.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  for (const block of styles) {
    parts.push(block.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, ''));
  }
  const links = doc.match(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi) || [];
  const localCss = [];
  for (const tag of links) {
    const href = /href=["']([^"']+)["']/i.exec(tag);
    if (!href) continue;
    const value = href[1];
    if (/^(https?:)?\/\//.test(value) || value.startsWith('data:')) {
      localCss.push(`/* remote stylesheet not inspected: ${value} */`);
      continue;
    }
    try {
      parts.push(fs.readFileSync(path.resolve(path.dirname(file), value), 'utf8'));
    } catch {
      localCss.push(`/* missing stylesheet: ${value} */`);
    }
  }
  const inline = doc.match(/<body[^>]*style=["']([^"']+)["']/i);
  if (inline) parts.push(`body { ${inline[1]} }`);
  const styleAttributes = doc.match(/style=["']([^"']+)["']/gi) || [];
  parts.push(styleAttributes.map((value) => `[inline] { ${value.replace(/^style=["']|["']$/gi, '')} }`).join('\n'));
  return [...parts, ...localCss].join('\n');
}

function matchesBody(selector) {
  return /(^|[\s,>+~])(body|html|:root)(?=$|[\s,.:#[])/i.test(selector);
}

// ---- the check ------------------------------------------------------------

function checkDesign(source, { file = 'index.html', goals = [] } = {}) {
  let doc = '';
  let css = '';
  if (/<html|<body|<style/i.test(source)) {
    doc = source;
    css = stripComments(readCss(doc, file));
  } else {
    css = stripComments(source);
  }
  const declarations = flatten(parseBlocks(css));

  // Resolve var(--token) so palettes declared once in :root are measured.
  const variables = new Map();
  for (const declaration of declarations) {
    if (declaration.property.startsWith('--') && !variables.has(declaration.property)) {
      variables.set(declaration.property, declaration.value);
    }
  }
  const resolveVars = (value, depth = 0) => {
    if (depth > 5 || !value || !value.includes('var(')) return value;
    const replaced = String(value).replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_match, name, fallback) => {
      const found = variables.get(name);
      return found ? found : (fallback || '');
    });
    return replaced === value ? replaced : resolveVars(replaced, depth + 1);
  };
  for (const declaration of declarations) declaration.value = resolveVars(declaration.value);

  // Group resolved declarations by selector so glass checks verify the SAME
  // element's backdrop-filter, fill opacity, hairline border, and shadow.
  const selectorMap = new Map();
  for (const declaration of declarations) {
    const key = declaration.selector || '';
    if (!selectorMap.has(key)) selectorMap.set(key, []);
    selectorMap.get(key).push(declaration);
  }

  const metrics = {
    bytes: source.length,
    cssBytes: css.length,
    viewport: /<meta[^>]+name=["']?viewport["']?/i.test(doc),
    variables: new Set(declarations.filter((d) => d.property.startsWith('--')).map((d) => d.property)).size,
    hoverRules: new Set(declarations.filter((d) => /:hover/.test(d.selector)).map((d) => d.selector)).size,
    focusVisibleRules: new Set(declarations.filter((d) => /:focus(-visible)?/.test(d.selector)).map((d) => d.selector)).size,
    activeRules: new Set(declarations.filter((d) => /:active/.test(d.selector)).map((d) => d.selector)).size,
    mediaQueries: (css.match(/@media\b/g) || []).length,
    responsiveMediaQueries: [...css.matchAll(/@media\s*([^{]+)\{/gi)]
      .filter((m) => /\b(max|min)-(device-)?(width|height)\b|orientation|aspect-ratio/i.test(m[1])).length,
    transitions: declarations.filter((d) => d.property === 'transition' || d.property === 'transition-property').length,
    animations: (css.match(/@keyframes\b/g) || []).length,
    // A filter must name a function: `backdrop-filter: 20px` is invalid CSS and
    // the browser drops it, which is exactly the "looks flat" failure mode.
    backdropFilters: declarations.filter((d) => (d.property === 'backdrop-filter' || d.property === '-webkit-backdrop-filter')
      && /\b(blur|saturate|brightness|contrast|grayscale|sepia|hue-rotate|invert|opacity|drop-shadow)\(/.test(d.value)),
    gradients: (css.match(/(linear|radial|conic)-gradient\(/g) || []).length,
    shadows: declarations.filter((d) => d.property === 'box-shadow').length,
    insetHighlights: declarations.filter((d) => d.property === 'box-shadow' && /\binset\b/i.test(d.value)).length,
    flex: declarations.filter((d) => d.property === 'display' && /flex/.test(d.value)).length,
    grid: declarations.filter((d) => d.property === 'display' && /grid/.test(d.value)).length,
    fonts: '',
    radius: '',
    outlineNone: declarations.filter((d) => d.property === 'outline' && /^none|0/.test(d.value)).length,
    reducedMotion: /prefers-reduced-motion/.test(css),
  };

  const fontsDecl = declarations.find((d) => d.property === 'font-family');
  if (fontsDecl) metrics.fonts = fontsDecl.value;
  const radiusDecl = declarations.find((d) => d.property === 'border-radius');
  if (radiusDecl) metrics.radius = radiusDecl.value;
  const blur = metrics.backdropFilters
    .map((d) => /blur\(\s*([\d.]+)(px|rem)/.exec(d.value))
    .filter(Boolean)
    .map((match) => Number(match[1]) * (match[2] === 'rem' ? 16 : 1));
  metrics.maxBlurPx = blur.length ? Math.max(...blur) : 0;

  // Background: body first, then :root/html, then pseudo/ambient layers.
  // Stacked CSS backgrounds list translucent glow overlays FIRST and the base
  // canvas LAST; measure contrast against the base opaque stop (or bottom layer)
  // rather than a semi-transparent glow stop.
  const backgroundDecls = declarations.filter((d) => matchesBody(d.selector)
    && (d.property === 'background' || d.property === 'background-color' || d.property === 'background-image'));
  const backgroundColors = backgroundDecls.flatMap((d) => colorsIn(d.value)).filter((color) => color.a > 0);
  const opaqueBg = backgroundColors.find((color) => color.a >= 0.85);
  const background = opaqueBg || backgroundColors[backgroundColors.length - 1] || backgroundColors[0] || null;

  const textDecls = declarations.filter((d) => matchesBody(d.selector) && d.property === 'color');
  const textColors = textDecls.flatMap((d) => colorsIn(d.value));
  const text = textColors[textColors.length - 1] || null;

  // Gradients carry several stops: a page is dark when the stops are dark.
  // Translucent overlay stops barely tint what is underneath: weight by alpha
  // so a 3%-white glow cannot make a near-black page read as "light".
  const weightSum = backgroundColors.reduce((sum, color) => sum + Math.max(color.a, 0.01), 0);
  const lightness = backgroundColors.length
    ? backgroundColors.reduce((sum, color) => sum + toHsl(color).l * Math.max(color.a, 0.01), 0) / weightSum
    : null;
  const effectiveChroma = (color) => (Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)) * color.a;
  const hueTarget = backgroundColors.find((color) => effectiveChroma(color) >= 14 && toHsl(color).s > 0.12)
    || backgroundColors.find((color) => toHsl(color).s > 0.12)
    || background;
  const hueHsl = hueTarget ? toHsl(hueTarget) : null;
  metrics.background = colorLabel(background);
  metrics.backgroundColors = backgroundColors.map(colorLabel);
  metrics.text = colorLabel(text);
  metrics.backgroundHue = hueHsl ? Math.round(hueHsl.h) : null;
  metrics.backgroundSaturation = hueHsl ? Number(hueHsl.s.toFixed(2)) : 0;
  metrics.backgroundLightness = lightness === null ? null : Number(lightness.toFixed(2));
  metrics.theme = lightness === null ? 'unknown' : (lightness < 0.28 ? 'dark' : lightness < 0.65 ? 'medium' : 'light');
  metrics.contrast = background && text ? Number(contrastRatio(background, text).toFixed(2)) : null;
  metrics.translucentSurfaces = new Set(declarations
    .filter((d) => (d.property === 'background' || d.property === 'background-color')
      && !matchesBody(d.selector) && colorsIn(d.value).some((color) => color.a > 0 && color.a < 0.95))
    .map((d) => d.selector)).size;

  // Verify that elements with `backdrop-filter` actually let the backdrop show
  // through rather than painting an opaque 95-98% dark card on top of black.
  const translucentGlass = [];
  const opaqueGlass = [];
  for (const [sel, decls] of selectorMap.entries()) {
    const hasFilter = decls.some((d) => (d.property === 'backdrop-filter' || d.property === '-webkit-backdrop-filter')
      && /\bblur\(\s*([\d.]+)(px|rem)/.test(d.value));
    if (!hasFilter) continue;
    const blurMatch = decls
      .map((d) => /blur\(\s*([\d.]+)(px|rem)/.exec(d.value))
      .find(Boolean);
    const blurPx = blurMatch ? Number(blurMatch[1]) * (blurMatch[2] === 'rem' ? 16 : 1) : 0;
    if (blurPx < 4) continue;
    const bgDecls = decls.filter((d) => d.property === 'background' || d.property === 'background-color' || d.property === 'background-image');
    const bgColors = bgDecls.flatMap((d) => colorsIn(d.value)).filter((color) => color.a > 0);
    const hasTranslucentFill = bgColors.length === 0 || bgColors.some((color) => color.a <= 0.65);
    const maxAlpha = bgColors.length ? Math.max(...bgColors.map((color) => color.a)) : 0;
    const borderColors = decls
      .filter((d) => /^border(-color|-top|-top-color|-left|-right|-bottom)?$/.test(d.property))
      .flatMap((d) => colorsIn(d.value));
    const hasVisibleBorder = borderColors.some((color) => color.a >= 0.08);
    const shadowDecls = decls.filter((d) => d.property === 'box-shadow' && !/^none$/i.test(d.value.trim()));
    const hasShadow = shadowDecls.length > 0;
    const hasInset = shadowDecls.some((d) => /\binset\b/i.test(d.value));
    if (!hasTranslucentFill && maxAlpha > 0.72) {
      opaqueGlass.push({ selector: sel, alphaPct: Math.round(maxAlpha * 100) });
    } else {
      translucentGlass.push({ selector: sel, hasVisibleBorder, hasShadow, hasInset });
    }
  }
  metrics.translucentGlassSelectors = translucentGlass.length;
  metrics.opaqueGlassSelectors = opaqueGlass;
  metrics.glassBorderVisible = translucentGlass.some((entry) => entry.hasVisibleBorder);
  metrics.glassShadowed = translucentGlass.some((entry) => entry.hasShadow);

  // Accent colours: buttons, links, badges, accent classes.
  const accents = [];
  for (const declaration of declarations) {
    if (!/button|\.btn|a\b|link|accent|primary|chip|badge|pill/i.test(declaration.selector)) continue;
    if (!/background|color|border-color|fill|stroke/.test(declaration.property)) continue;
    for (const color of colorsIn(declaration.value)) {
      if (color.a < 0.5) continue;
      const hsl = toHsl(color);
      if (hsl.s > 0.18) accents.push({ color, hsl });
    }
  }
  metrics.accents = accents.slice(0, 6).map((entry) => ({
    color: colorLabel(entry.color),
    hue: Math.round(entry.hsl.h),
    saturation: Number(entry.hsl.s.toFixed(2)),
  }));

  // ---- goal evaluation ----
  const HUE_RANGES = {
    blue: [195, 265], navy: [195, 265], teal: [150, 195], cyan: [165, 200],
    green: [80, 165], purple: [255, 300], violet: [255, 300], pink: [300, 350],
    red: [340, 20], orange: [15, 45], gold: [35, 60], amber: [30, 55],
  };
  const withinHue = (hue, range) => (range[0] <= range[1]
    ? hue >= range[0] && hue <= range[1]
    : hue >= range[0] || hue <= range[1]);

  const results = [];
  const words = [...new Set(String(goals.join(' ')).toLowerCase().split(/[^a-z]+/).filter(Boolean))];
  const wantsBackdropColour = words.includes('dark') || words.includes('light') || words.includes('liquid') || words.includes('glass');
  for (const word of words) {
    if (HUE_RANGES[word]) {
      const range = HUE_RANGES[word];
      // Require perceptible chroma (`effectiveChroma >= 14`) so near-black
      // `#000208` (rgb 0,2,8) does not pretend to be rich dark blue.
      const byBackground = backgroundColors.some((color) => {
        const hsl = toHsl(color);
        return effectiveChroma(color) >= 14 && color.a >= 0.3 && hsl.s > 0.12 && withinHue(hsl.h, range);
      });
      const byAccent = accents.some((entry) => effectiveChroma(entry.color) >= 24 && entry.hsl.s > 0.25 && withinHue(entry.hsl.h, range));
      const pass = wantsBackdropColour ? Boolean(byBackground) : Boolean(byBackground || byAccent);
      const detail = byBackground
        ? `background is ${word}`
        : byAccent && !pass
          ? `only an accent is ${word}, while page background ${metrics.background} reads neutral/pitch-black`
          : byAccent
            ? `accent is ${word}`
            : `no perceptible ${word} canvas found (background ${metrics.background})`;
      results.push({ goal: word, pass, detail });
    } else if (word === 'dark') {
      results.push({ goal: word, pass: metrics.backgroundLightness !== null && metrics.backgroundLightness < 0.45, detail: `background ${metrics.background} (lightness ${metrics.backgroundLightness ?? 'unknown'})` });
    } else if (word === 'light') {
      results.push({ goal: word, pass: metrics.backgroundLightness !== null && metrics.backgroundLightness > 0.7, detail: `background ${metrics.background}` });
    } else if (word === 'glass' || word === 'glassmorphism' || word === 'translucent' || word === 'frosted') {
      const pass = metrics.backdropFilters.length > 0
        && metrics.maxBlurPx >= 4
        && metrics.translucentSurfaces > 0
        && metrics.translucentGlassSelectors > 0;
      const detail = opaqueGlass.length && metrics.translucentGlassSelectors === 0
        ? `${opaqueGlass[0].selector} has backdrop-filter blur but ${opaqueGlass[0].alphaPct}% opaque background (lower alpha to 0.06–0.28)`
        : `${metrics.backdropFilters.length} backdrop-filter rule(s), ${metrics.translucentGlassSelectors} translucent blurred panel(s)`;
      results.push({ goal: word, pass, detail });
    } else if (word === 'liquid') {
      const hasLiquidDepth = metrics.translucentGlassSelectors > 0
        && metrics.maxBlurPx >= 12
        && metrics.glassBorderVisible
        && metrics.glassShadowed
        && metrics.gradients > 0;
      const missing = [];
      if (opaqueGlass.length && !metrics.translucentGlassSelectors) missing.push(`${opaqueGlass[0].selector} fill is ${opaqueGlass[0].alphaPct}% opaque`);
      else if (!metrics.translucentGlassSelectors) missing.push('no translucent backdrop-filter panel');
      if (metrics.maxBlurPx < 12) missing.push(`blur ${metrics.maxBlurPx}px (<12px)`);
      if (!metrics.glassBorderVisible) missing.push('glass border is invisible/missing (use ~0.16-0.30 alpha)');
      if (!metrics.glassShadowed) missing.push('glass panel needs box-shadow depth/inset highlight');
      if (!metrics.gradients) missing.push('needs layered gradient/orbs behind glass');
      results.push({
        goal: word,
        pass: hasLiquidDepth,
        detail: hasLiquidDepth
          ? `blur ${metrics.maxBlurPx}px, translucent glass with crisp border, shadow & gradient backdrop`
          : missing.join('; '),
      });
    } else if (word === 'responsive' || word === 'mobile') {
      const pass = metrics.viewport && metrics.responsiveMediaQueries > 0;
      results.push({ goal: word, pass, detail: `viewport ${metrics.viewport ? 'yes' : 'no'}, ${metrics.responsiveMediaQueries} layout media quer${metrics.responsiveMediaQueries === 1 ? 'y' : 'ies'}, flex/grid rules ${metrics.flex + metrics.grid}` });
    } else if (word === 'accessible' || word === 'contrast') {
      const pass = (metrics.contrast === null ? false : metrics.contrast >= 4.5) && metrics.focusVisibleRules > 0;
      results.push({ goal: word, pass, detail: `contrast ${metrics.contrast ?? 'unset'}:1, ${metrics.focusVisibleRules} focus rule(s)` });
    } else if (word === 'rounded') {
      results.push({ goal: word, pass: Boolean(metrics.radius) && !/^0(px|rem|%)?$/.test(metrics.radius), detail: `radius ${metrics.radius || 'none'}` });
    } else if (word === 'gradient') {
      results.push({ goal: word, pass: metrics.gradients > 0, detail: `${metrics.gradients} gradient(s)` });
    } else if (word === 'shadow' || word === 'depth') {
      results.push({ goal: word, pass: metrics.shadows > 0, detail: `${metrics.shadows} shadow rule(s)` });
    }
  }

  // ---- objective craft issues ----
  const issues = [];
  if (doc && !metrics.viewport) issues.push('No <meta name="viewport"> — the page will not lay out on a phone.');
  if (!css.trim()) issues.push('No CSS at all: the page renders as unstyled HTML.');
  else {
    if (!background) issues.push('No page background colour is set — the browser default white shows through.');
    if (!text) issues.push('No body text colour is set — it inherits the browser default.');
    if (metrics.contrast !== null && metrics.contrast < 4.5) issues.push(`Body text contrast is ${metrics.contrast}:1, below the 4.5:1 readability floor.`);
    if (metrics.fonts && /^(serif|times|georgia)$/i.test(metrics.fonts.trim())) issues.push(`Body font is "${metrics.fonts}" — that is the unstyled browser default look.`);
    if (!metrics.fonts && doc) issues.push('No font-family is set, so the page uses the browser default font.');
    if (!metrics.hoverRules && /<(button|a|input|select|textarea)\b/i.test(doc)) issues.push('No :hover rule: interactive elements will not respond to the pointer.');
    if (!metrics.focusVisibleRules) issues.push('No :focus-visible rule: keyboard focus is invisible or the browser default.');
    if (!metrics.responsiveMediaQueries && doc) issues.push('No responsive @media (max-width/min-width) breakpoint: the layout cannot adapt to narrow windows.');
    if (!metrics.variables && metrics.cssBytes > 400) issues.push('No CSS custom properties: the palette is hard-coded in every rule.');
    if (!metrics.transitions && metrics.hoverRules) issues.push('Hover changes without a transition snap instead of easing.');
    if (metrics.outlineNone && !metrics.focusVisibleRules) issues.push('outline:none removes focus rings with no replacement.');
    if (opaqueGlass.length && !words.includes('glass') && !words.includes('liquid')) {
      issues.push(`${opaqueGlass[0].selector} has backdrop-filter blur but ${opaqueGlass[0].alphaPct}% opaque background — lower fill alpha to 0.06–0.28 so glass refracts.`);
    }
  }
  for (const result of results) if (!result.pass) issues.push(`Goal "${result.goal}" is not met: ${result.detail}.`);

  const unique = [...new Set(issues)];
  // Fatal problems cost more than polish: an unstyled page is not 80% done.
  const weight = (issue) => {
    if (/^No CSS at all/.test(issue)) return 30;
    if (/^No page background/.test(issue)) return 16;
    if (/contrast is/.test(issue)) return 14;
    if (/unstyled browser default look/.test(issue)) return 12;
    if (/^Goal /.test(issue)) return 8;
    return 7;
  };
  const score = Math.max(0, Math.min(100, 100 - unique.reduce((sum, issue) => sum + weight(issue), 0)));
  return {
    file,
    ok: unique.length === 0,
    score,
    goals: results,
    metrics,
    issues: unique,
  };
}

const KNOWN_GOAL_WORDS = new Set([
  'dark', 'light', 'blue', 'navy', 'teal', 'cyan', 'green', 'purple', 'violet',
  'pink', 'red', 'orange', 'gold', 'amber', 'liquid', 'glass', 'glassmorphism',
  'translucent', 'frosted', 'responsive', 'mobile', 'accessible', 'contrast',
  'rounded', 'gradient', 'shadow', 'depth',
]);

// Pull visual design keywords straight from the user's prompt so edit hints and
// finish gates verify what they actually asked for.
function extractDesignGoals(promptText) {
  const words = String(promptText || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const found = [];
  for (const word of words) {
    if (KNOWN_GOAL_WORDS.has(word) && !found.includes(word)) found.push(word);
  }
  return found;
}

function summarise(report) {
  if (!report) return '';
  if (report.ok) return `design ${report.score}/100 — styled as asked, no issues found`;
  const top = report.issues.slice(0, 3).join(' ');
  return `design ${report.score}/100 — ${report.issues.length} issue(s): ${top}${report.issues.length > 3 ? ' …' : ''}`;
}

// Appended to an edit result so a plain page or missed visual brief cannot pass unnoticed.
function designHint(root, files, maxFiles = 2, goals = []) {
  const lines = [];
  const activeGoals = Array.isArray(goals) ? goals.filter(Boolean) : [];
  for (const file of (Array.isArray(files) ? files : [files]).slice(0, maxFiles)) {
    if (!/\.(html?|css)$/i.test(file)) continue;
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (source.length > 400000) continue;
    if (/\.html?$/i.test(file) && !/<(body|style)/i.test(source)) continue;
    try {
      const report = checkDesign(source, { file, goals: activeGoals });
      if (report.issues.length) {
        lines.push(`- ${path.basename(file)}: design ${report.score}/100 — ${report.issues.slice(0, 3).join(' ')}`);
      }
    } catch { /* never break a successful edit */ }
  }
  if (!lines.length) return '';
  const briefHint = activeGoals.length ? ` (brief: ${activeGoals.join(', ')})` : '';
  return `\nDesign check${briefHint} (static analysis of the CSS just written):\n${lines.join('\n')}\nFix every reported issue above and verify cleanly with design_check before finishing.`;
}

module.exports = { checkDesign, extractDesignGoals, summarise, designHint, parseColorToken, toHsl, contrastRatio };
