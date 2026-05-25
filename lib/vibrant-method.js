// -----------------------------------------------------------------------------
// "Vibrant.js" derivation method, backed by node-vibrant (loaded from CDN via
// the import map). node-vibrant returns named swatches — Vibrant / Muted /
// DarkVibrant / DarkMuted / LightVibrant / LightMuted — each with a coverage
// population. We map them to our three roles and then run the same finalizeTrio
// pass as the built-in methods, so the panel's saturation / min-contrast sliders
// still apply.
//
// getPalette() is async and depends only on the image, so we cache the raw
// palette per image (WeakMap) — dragging the sliders only re-runs the cheap
// synchronous finalize step, never a re-quantise.
// -----------------------------------------------------------------------------

import { Vibrant } from 'node-vibrant/browser';
import { finalizeTrio } from './color-extraction.js';

const paletteCache = new WeakMap(); // HTMLImageElement -> palette

// node-vibrant's six named swatches, for the panel's role dropdowns.
export const VIBRANT_SWATCHES = [
  'Vibrant', 'LightVibrant', 'DarkVibrant', 'Muted', 'LightMuted', 'DarkMuted',
];

/** Quantise the image into node-vibrant swatches, cached per image. */
export async function getVibrantPalette(image) {
  if (paletteCache.has(image)) return paletteCache.get(image);
  const palette = await Vibrant.from(image).getPalette();
  paletteCache.set(image, palette);
  return palette;
}

/** First non-null swatch among `names`, as [r,g,b]; null if none present. */
function pickRgb(palette, names) {
  for (const name of names) {
    const sw = palette[name];
    if (sw && sw.rgb) return [sw.rgb[0], sw.rgb[1], sw.rgb[2]];
  }
  return null;
}

/**
 * Build the { background, text, outline } trio from a node-vibrant palette.
 * bgSwatch / textSwatch pin a role to a named swatch; 'auto' (or a swatch absent
 * from this palette) falls through a sensible chain — background prefers a deep,
 * calm swatch, text a vivid one — so sparse palettes still produce a result.
 */
export function trioFromPalette(palette, {
  saturation = 1,
  minContrast = 4.5,
  bgSwatch = 'auto',
  textSwatch = 'auto',
} = {}) {
  const background =
    (bgSwatch !== 'auto' && pickRgb(palette, [bgSwatch])) ||
    pickRgb(palette, ['DarkMuted', 'DarkVibrant', 'Muted', 'Vibrant']) || [0, 0, 0];
  const text =
    (textSwatch !== 'auto' && pickRgb(palette, [textSwatch])) ||
    pickRgb(palette, ['Vibrant', 'LightVibrant', 'LightMuted', 'Muted']) || [255, 255, 255];
  return finalizeTrio(background, text, { saturation, minContrast });
}

/** Convenience: derive the trio straight from an image (fetches the palette). */
export async function deriveColorsVibrant(image, opts = {}) {
  const palette = await getVibrantPalette(image);
  return trioFromPalette(palette, opts);
}
