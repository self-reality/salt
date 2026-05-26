// -----------------------------------------------------------------------------
// Side-text generator — live <text> for the two vertical decal labels that
// used to be path-outlined SVG fonts (Preserved.svg and Artwork title side.svg).
//
// Both labels share a column running the full band height on the side of the
// can. Reading the side (rotated 90° CCW) the band reads
//   OUTER_PAD | preserved text | MIN_GAP | title text | OUTER_PAD = bandHeight
// — so the column scales with the height slider. The only free variable is
// the shared font size: it sits at the design MAX (38) while there's slack,
// and shrinks both labels together once a long title or a short band would
// close the gap below MIN_GAP. Re-laid out on every band-height change and
// every title keystroke.
//
// Frame dimensions: both SVGs share the same width so their visual centres
// line up on one texture column. Heights are computed per render — Preserved
// grows downward (anchor='top'), Title grows upward from a fixed bottom edge
// (the layer's yTop is updated by label.js so the bottom stays put).
//
// Pacifico is fetched once from the repo (elements/fonts/Pacifico-Regular.woff2,
// the latin subset of v23 from Google Fonts) and embedded into each SVG as a
// data-URL @font-face — required because SVGs rasterised via Blob URL run in
// their own document context and don't see the page's loaded webfonts. The
// same data URL is also registered with document.fonts so canvas.measureText()
// reports real Pacifico metrics for the layout calc.
// -----------------------------------------------------------------------------

import { REF_HEIGHT } from './label-texture.js';

const INK = '#F8EE46';            // recolored to `text` by recolorDecalSvg
const SIDE_WIDTH = 51;            // SVG width (= thickness of the rotated text)
const MAX_FONT_SIZE = 38;         // design font size; we only shrink from here
const MIN_FONT_SIZE = 6;          // safety floor for absurdly long titles

const PACIFICO_URL = 'elements/fonts/Pacifico-Regular.woff2';

// Layout spec — reading the side of the can (rotated 90° CCW), the band reads:
//   OUTER_PAD | preserved text | MIN_GAP | title text | OUTER_PAD = bandHeight
// The block width *is the band height* (the slider's value), so the budget
// follows the live band height and the layout recomputes on every drag tick.
// OUTER_PAD and MIN_GAP are fixed texture px; the only free variable is the
// shared font size.
const OUTER_PAD = 50;
const MIN_GAP = 15;
// Safety margin inside each SVG so Pacifico's flourishes don't clip at the
// SVG image's edges — not part of the spec's column accounting; the SVG-edge
// positions are inset by INNER_PAD past the text edges below.
const INNER_PAD = 4;

// Preserved is anchor='top' (fixed in band-space): text top edge sits at
// y=OUTER_PAD, so the layer's yTop = OUTER_PAD − INNER_PAD. Constant across
// font sizes since the text top is pinned and the SVG grows downward.
const PRESERVED_YTOP = OUTER_PAD - INNER_PAD;                  // 46

// Title is anchor='bottom': label-texture.js draws it at
// yTop + (H − REF_HEIGHT), so yTop is the draw position *as if* H = REF_HEIGHT.
// At REF_HEIGHT we want the SVG bottom edge at REF_HEIGHT − OUTER_PAD + INNER_PAD
// (so the text bottom edge lands exactly at REF_HEIGHT − OUTER_PAD); from there
// the anchor='bottom' shift carries the bottom edge to H − OUTER_PAD at any H.
const TITLE_SVG_BOTTOM_AT_REF = REF_HEIGHT - OUTER_PAD + INNER_PAD; // 986

export const SIDE_FRAME_WIDTH = SIDE_WIDTH;
export const PRESERVED_FILE = 'Preserved.svg';
export const TITLE_FILE = 'Artwork title side.svg';
export const DEFAULT_PRESERVED_TEXT = 'preserved';
// Curly quotes + double space matching the original artwork-title styling.
export const DEFAULT_TITLE_TEXT = '“Float On”  by oak_arrow';

const escapeXml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// ----------------------------- Pacifico loader -------------------------------

let pacificoPromise = null;

// Fetch the local Pacifico woff2 once, resolve to a data URL, and also
// register it in document.fonts so canvas.measureText sees the real font.
// Resolves to null on failure — generateSideTextSvg + computeSideLayout both
// degrade to the system cursive fallback without breaking the page.
export function loadPacificoDataUrl() {
  if (pacificoPromise) return pacificoPromise;
  pacificoPromise = (async () => {
    try {
      const res = await fetch(PACIFICO_URL);
      if (!res.ok) return null;
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      });
      if (!dataUrl) return null;
      try {
        const face = new FontFace('Pacifico', `url(${dataUrl}) format('woff2')`);
        await face.load();
        document.fonts.add(face);
      } catch (_) { /* canvas falls back to system cursive */ }
      return dataUrl;
    } catch (_) {
      return null;
    }
  })();
  return pacificoPromise;
}

// ----------------------------- Layout -------------------------------

let measureCtx = null;
function measureWidth(text, fontSize) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${fontSize}px Pacifico, cursive`;
  return measureCtx.measureText(text).width;
}

/**
 * Pick a shared font size + per-SVG heights for the two side labels.
 *
 * Layout (rotated reading direction, where the block runs the full band):
 *   OUTER_PAD | preserved text | MIN_GAP | title text | OUTER_PAD = bandHeight
 *
 * Both texts render naturally (no glyph deformation). With OUTER_PAD and
 * MIN_GAP fixed in texture px, the only free variable is the shared font
 * size F. We solve for the largest F ≤ MAX_FONT_SIZE such that
 *
 *   preservedAdv·F + titleAdv·F ≤ bandHeight − 2·OUTER_PAD − MIN_GAP
 *
 * Below that threshold the natural fit leaves a gap > MIN_GAP at F = 38, so
 * F stays at the design size; above it, F shrinks just enough to land the
 * gap exactly on MIN_GAP. Recomputed on every band-height change so the
 * layout tracks the slider.
 */
export function computeSideLayout(titleText, bandHeight) {
  const pAdv = measureWidth(DEFAULT_PRESERVED_TEXT, 1);
  const tAdv = measureWidth(titleText || ' ', 1);
  const denom = pAdv + tAdv;
  const budget = Math.max(0, bandHeight - 2 * OUTER_PAD - MIN_GAP);
  const fitF = denom > 0 ? budget / denom : MAX_FONT_SIZE;
  const fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fitF));

  const preservedWidth = pAdv * fontSize;
  const titleWidth = tAdv * fontSize;

  // Each SVG is just big enough to hold its text plus INNER_PAD safety margin.
  const preservedHeight = Math.max(1, Math.ceil(preservedWidth + 2 * INNER_PAD));
  const titleHeight = Math.max(1, Math.ceil(titleWidth + 2 * INNER_PAD));

  // Title's yTop is the draw position at REF_HEIGHT — label-texture.js's
  // anchor='bottom' shift carries the SVG bottom from this REF_HEIGHT value to
  // (H − OUTER_PAD + INNER_PAD) at the live band height H.
  const titleYTop = TITLE_SVG_BOTTOM_AT_REF - titleHeight;

  return {
    fontSize,
    preservedHeight,
    preservedYTop: PRESERVED_YTOP,
    titleHeight,
    titleYTop,
  };
}

// ----------------------------- SVG generator -------------------------------

/**
 * Build a side-text SVG. The text is rotated -90° around the centre so it
 * reads bottom-to-top. No textLength — the SVG height is sized by the caller
 * (via computeSideLayout) to fit the text naturally.
 *
 * @param {string} text
 * @param {{ width:number, height:number, fontSize:number }} frame
 * @param {string|null} fontDataUrl - Pacifico woff2 as a data URL, or null
 */
export function generateSideTextSvg(text, frame, fontDataUrl) {
  const { width, height, fontSize } = frame;
  const cx = width / 2;
  const cy = height / 2;
  const fontFace = fontDataUrl
    ? `<style>@font-face{font-family:'Pacifico';` +
      `src:url(${fontDataUrl}) format('woff2');font-display:block;}</style>`
    : '';
  return (
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"` +
    ` fill="none" xmlns="http://www.w3.org/2000/svg">` +
      fontFace +
      `<text x="${cx}" y="${cy}" fill="${INK}"` +
        ` font-family="Pacifico, cursive" font-size="${fontSize}"` +
        ` text-anchor="middle" dominant-baseline="central"` +
        ` transform="rotate(-90, ${cx}, ${cy})">` +
        escapeXml(text) +
      `</text>` +
    `</svg>`
  );
}
