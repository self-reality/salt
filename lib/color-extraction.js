// -----------------------------------------------------------------------------
// Derive a harmonious 3-colour palette from an artwork image.
//
// Given an artwork (the image composited onto the can label), produce a trio:
//   { background, text, outline }
//   - background : replaces the can label's black band behind the artwork
//   - text       : the header wordmark's letter fill
//   - outline    : the header wordmark's letter edge
//
// Two methods are offered (see deriveColors). They differ mainly in how the
// background / accent is chosen; both run the same final pass so the
// panel sliders (saturation, min-contrast) affect every method consistently:
// the text is pushed until it meets a WCAG contrast ratio against the
// background. Each method tries to extract all three colours from the artwork,
// including the outline; when a method finds no suitable third colour, the
// outline falls back to a near-black/near-white edge legible against the text.
//
// Colours are plain [r,g,b] (0-255) internally and returned as '#rrggbb'.
// Pixel reading uses a small offscreen canvas; artworks are same-origin (served
// from /artworks) and uploads use object URLs, so getImageData never taints.
// -----------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// --- conversions -------------------------------------------------------------

export function rgbToHex([r, g, b]) {
  const h = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [h, s, l];
}

export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

// --- WCAG luminance / contrast ----------------------------------------------

export function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// --- adjustments -------------------------------------------------------------

function adjustSaturation(rgb, factor) {
  const [h, s, l] = rgbToHsl(rgb);
  return hslToRgb([h, clamp(s * factor, 0, 1), l]);
}

/** Push fg's lightness away from bg until it clears minRatio (keeps hue/sat). */
function ensureContrast(fg, bg, minRatio) {
  let best = fg, bestC = contrastRatio(fg, bg);
  if (bestC >= minRatio) return fg;
  const [h, s] = rgbToHsl(fg);
  let [, , l] = rgbToHsl(fg);
  const dir = relativeLuminance(bg) > 0.4 ? -1 : 1; // light bg -> darken text
  for (let i = 0; i < 22; i++) {
    l = clamp(l + dir * 0.05, 0, 1);
    const cand = hslToRgb([h, s, l]);
    const c = contrastRatio(cand, bg);
    if (c > bestC) { best = cand; bestC = c; }
    if (c >= minRatio) return cand;
    if (l <= 0 || l >= 1) break;
  }
  return best; // couldn't fully reach it; return the most contrasting we found
}

/** A near-black or near-white edge, whichever reads better against the text. */
function pickOutline(text) {
  const dark = [18, 18, 20], light = [244, 244, 246];
  return contrastRatio(dark, text) >= contrastRatio(light, text) ? dark : light;
}

/** Euclidean distance between two [r,g,b] colours (0–441). */
function colorDistance(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// An extracted colour reads as an outline only if it's clearly separated from
// the text fill it rims; below this WCAG ratio we fall back to black/white.
const OUTLINE_MIN_CONTRAST = 2.0;
// Candidates within this RGB distance of the text or background are skipped —
// too close to read as a distinct third colour.
const OUTLINE_MIN_DISTANCE = 48;

/**
 * Choose a third colour for the outline from a method's extracted candidates:
 * the one with the most contrast against the text, while staying distinct from
 * both text and background. Returns null when nothing qualifies, so the caller
 * can fall back to a synthetic black/white edge.
 */
export function bestOutlineFrom(candidates, text, background) {
  let best = null, bestContrast = 0;
  for (const rgb of candidates) {
    if (colorDistance(rgb, text) < OUTLINE_MIN_DISTANCE) continue;
    if (colorDistance(rgb, background) < OUTLINE_MIN_DISTANCE) continue;
    const c = contrastRatio(rgb, text);
    if (c > bestContrast) { bestContrast = c; best = rgb; }
  }
  return bestContrast >= OUTLINE_MIN_CONTRAST ? best : null;
}

/**
 * Shared final pass: apply the saturation boost and push the text until it
 * clears the contrast ratio against the background. `outline` is the method's
 * extracted third colour — saturation-matched, then nudged only if the finalized
 * text erased its separation; when a method supplies none (null), fall back to a
 * synthetic black/white edge. Used by every built-in method and by node-vibrant
 * so the panel's saturation / min-contrast sliders affect them all identically.
 * Returns hex strings.
 */
export function finalizeTrio(background, text, outline, { saturation = 1, minContrast = 4.5 } = {}) {
  background = adjustSaturation(background, saturation);
  text = adjustSaturation(text, saturation);
  text = ensureContrast(text, background, minContrast);
  let outlineRgb;
  if (outline) {
    outlineRgb = adjustSaturation(outline, saturation);
    outlineRgb = ensureContrast(outlineRgb, text, OUTLINE_MIN_CONTRAST);
  } else {
    outlineRgb = pickOutline(text);
  }
  return {
    background: rgbToHex(background),
    text: rgbToHex(text),
    outline: rgbToHex(outlineRgb),
  };
}

// --- pixel sampling ----------------------------------------------------------

/** Draw image into a size×size canvas and return opaque pixels as [r,g,b][]. */
function samplePixels(image, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue; // skip transparent
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  return pixels;
}

// --- median-cut quantisation -------------------------------------------------

function channelRanges(box) {
  const min = [255, 255, 255], max = [0, 0, 0];
  for (const p of box) {
    for (let c = 0; c < 3; c++) {
      if (p[c] < min[c]) min[c] = p[c];
      if (p[c] > max[c]) max[c] = p[c];
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

function averageColor(box) {
  const sum = [0, 0, 0];
  for (const p of box) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
  const n = box.length || 1;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

/** Split pixels into `count` buckets, returned as {rgb,count} sorted by size. */
function medianCut(pixels, count) {
  if (!pixels.length) return [{ rgb: [0, 0, 0], count: 0 }];
  let boxes = [pixels];
  while (boxes.length < count) {
    let bi = -1, bestRange = -1, bestCh = 0;
    boxes.forEach((box, idx) => {
      if (box.length < 2) return;
      const r = channelRanges(box);
      const m = Math.max(r[0], r[1], r[2]);
      if (m > bestRange) {
        bestRange = m;
        bi = idx;
        bestCh = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2;
      }
    });
    if (bi < 0 || bestRange <= 0) break;
    const box = boxes[bi];
    box.sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = box.length >> 1;
    const b1 = box.slice(0, mid), b2 = box.slice(mid);
    if (!b1.length || !b2.length) break;
    boxes.splice(bi, 1, b1, b2);
  }
  return boxes
    .map((box) => ({ rgb: averageColor(box), count: box.length }))
    .sort((a, b) => b.count - a.count);
}

// --- methods -----------------------------------------------------------------

// Each returns a raw { background, text, outline } trio extracted from the
// artwork (outline may be null when no suitable third colour is found); the
// outline + final passes are applied by deriveColors so every method behaves
// consistently.

function methodDominant(pixels, { paletteSize, vividness }) {
  const palette = medianCut(pixels.slice(), paletteSize);
  const colors = palette.map((p) => p.rgb);
  const background = colors[0];
  // Pick the palette colour scoring highest on contrast × (1 + vividness·sat).
  // vividness 0 is a pure max-contrast pick; higher values increasingly favour
  // saturated hues over plain contrast.
  let text = null, bestScore = -1;
  for (const rgb of colors) {
    const [, s] = rgbToHsl(rgb);
    const score = contrastRatio(rgb, background) * (1 + vividness * s);
    if (score > bestScore) { bestScore = score; text = rgb; }
  }
  text = text || [255, 255, 255];
  // Outline: a third palette colour distinct from both background and text.
  const outline = bestOutlineFrom(colors, text, background);
  return { background, text, outline };
}

function methodAverage(pixels, { hueShift }) {
  const background = averageColor(pixels);
  const [h, s, l] = rgbToHsl(background);
  // Rotate the text hue off the background (180° = complementary) and flip its
  // lightness — a starting point before the contrast fix.
  const text = hslToRgb([h + hueShift, clamp(s + 0.15, 0, 1), l > 0.5 ? 0.15 : 0.9]);
  // Outline: split the pixels at the overall average's luminance and average
  // each side — two real tones from the art, the better-separated one rims it.
  const bgLum = relativeLuminance(background);
  const darker = [], lighter = [];
  for (const p of pixels) (relativeLuminance(p) < bgLum ? darker : lighter).push(p);
  const candidates = [];
  if (darker.length) candidates.push(averageColor(darker));
  if (lighter.length) candidates.push(averageColor(lighter));
  const outline = bestOutlineFrom(candidates, text, background);
  return { background, text, outline };
}

const METHODS = {
  dominant: methodDominant,
  average: methodAverage,
};

/**
 * Derive { background, text, outline } hex colours from an artwork image.
 *
 * @param {HTMLImageElement} image
 * @param {object} [opts]
 * @param {'dominant'|'average'} [opts.method]
 * @param {number} [opts.sampleSize]  - offscreen sampling resolution (px)
 * @param {number} [opts.paletteSize] - median-cut bucket count (dominant)
 * @param {number} [opts.vividness]   - text contrast↔saturation bias (dominant)
 * @param {number} [opts.hueShift]    - text hue rotation in degrees (average)
 * @param {number} [opts.saturation]  - multiplier applied to bg + text
 * @param {number} [opts.minContrast] - WCAG ratio enforced text vs background
 */
export function deriveColors(image, {
  method = 'dominant',
  sampleSize = 64,
  paletteSize = 8,
  vividness = 2.5,
  hueShift = 180,
  saturation = 1,
  minContrast = 4.5,
} = {}) {
  const fallback = { background: '#000000', text: '#ffffff', outline: '#000000' };
  if (!image) return fallback;

  let pixels;
  try {
    pixels = samplePixels(image, Math.max(8, Math.round(sampleSize)));
  } catch (err) {
    console.warn('deriveColors: could not sample image pixels', err);
    return fallback;
  }
  if (!pixels.length) return fallback;

  const fn = METHODS[method] || METHODS.dominant;
  const { background, text, outline } = fn(pixels, {
    paletteSize: Math.max(2, Math.round(paletteSize)),
    vividness,
    hueShift,
  });

  return finalizeTrio(background, text, outline, { saturation, minContrast });
}
