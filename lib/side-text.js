// -----------------------------------------------------------------------------
// Side-text generator — live <text> for the two vertical decal labels that
// used to be path-outlined SVG fonts (Preserved.svg and Artwork title side.svg).
//
// Both labels share a column on the side of the can. Reading the side of the
// can (rotated 90° CCW) they sit on the same line: "preserved" near one end,
// the artwork title near the other. As the title text gets longer its SVG
// grows along that column toward "preserved"; once the gap between the two
// SVGs would drop below ~2 character widths at the current font size, both
// fonts shrink together so the gap stays at exactly that minimum. The user
// sees long titles fit by scaling the whole side-column down, not by glyph-
// squishing one element.
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

const INK = '#F8EE46';            // recolored to `text` by recolorDecalSvg
const PAD = 8;                    // inset (texture px) at each short end
const MAX_FONT_SIZE = 38;         // design font size; we only shrink from here
const MIN_FONT_SIZE = 6;          // safety floor for absurdly long titles
const SIDE_WIDTH = 51;            // SVG width (= thickness of the rotated text)

const PACIFICO_URL = 'elements/fonts/Pacifico-Regular.woff2';

// Texture-space column extent for the side text, mirrored from LAYERS in
// lib/label-texture.js: Preserved is anchor='top' pinned at yTop=46.06; Title
// is anchor='bottom' with its bottom edge fixed at y=979.06 (= original
// yTop 589.06 + height 390). The text labels grow into the gap between.
export const PRESERVED_TOP_Y = 46.06;
export const TITLE_BOTTOM_Y = 979.06;
const SIDE_COLUMN_LENGTH = TITLE_BOTTOM_Y - PRESERVED_TOP_Y; // 933 px

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
 * Both texts render naturally (no glyph deformation). Their SVG heights are
 * sized to fit each text's measured advance plus 2·PAD. We solve for the
 * largest fontSize ≤ MAX_FONT_SIZE such that
 *
 *   preservedAdv·F + titleAdv·F + 4·PAD + minGap·F ≤ SIDE_COLUMN_LENGTH
 *
 * where minGap·F is the 2-character-wide gap the user spec'd. Since every
 * advance scales linearly with F, one division gives the exact threshold.
 *
 * Returns the title's new yTop too — the title is bottom-anchored, so when
 * its SVG height changes the layer's yTop must move to keep the bottom edge
 * pinned at TITLE_BOTTOM_Y. label.js applies this via builder.setLayerYTop().
 */
export function computeSideLayout(titleText) {
  const pAdv = measureWidth(DEFAULT_PRESERVED_TEXT, 1);
  const tAdv = measureWidth(titleText || ' ', 1);
  const gapAdv = measureWidth('MM', 1); // 2-char-wide minimum gap
  const denom = pAdv + tAdv + gapAdv;
  const fitF = denom > 0 ? (SIDE_COLUMN_LENGTH - 4 * PAD) / denom : MAX_FONT_SIZE;
  const fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fitF));

  const preservedHeight = Math.max(1, Math.ceil(pAdv * fontSize + 2 * PAD));
  const titleHeight = Math.max(1, Math.ceil(tAdv * fontSize + 2 * PAD));
  const titleYTop = TITLE_BOTTOM_Y - titleHeight;

  return { fontSize, preservedHeight, titleHeight, titleYTop };
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
