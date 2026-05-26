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
const SIDE_WIDTH = 51;            // SVG width (= thickness of the rotated text)
const MAX_FONT_SIZE = 38;         // design font size; we only shrink from here
const MIN_FONT_SIZE = 6;          // safety floor for absurdly long titles

const PACIFICO_URL = 'elements/fonts/Pacifico-Regular.woff2';

// Side-column extent in texture space. Mirrors LAYERS in lib/label-texture.js:
// Preserved is anchor='top' pinned at yTop=46.06; Title is anchor='bottom' with
// its bottom edge fixed at y=979.06 (= original yTop 589.06 + height 390).
const COLUMN_TOP_Y = 46.06;
const COLUMN_BOTTOM_Y = 979.06;
const COLUMN_LENGTH = COLUMN_BOTTOM_Y - COLUMN_TOP_Y; // 933 px

// Layout spec — reading the side of the can (rotated 90° CCW), the column is:
//   OUTER_PAD | preserved text | MIN_GAP | title text | OUTER_PAD
// All in texture px. The gap is fixed (not scaled with font size); the only
// degree of freedom is the shared font size.
const OUTER_PAD = 50;
const MIN_GAP = 15;
// Tiny safety margin inside each SVG so Pacifico's flourishes don't clip at
// the SVG image's edges. Doesn't show up in the spec's column accounting —
// the SVG-edge positions are inset by INNER_PAD past the text edges below.
const INNER_PAD = 4;

// Texture-y of the text edges, after subtracting OUTER_PAD from each column
// edge. Per the spec, the "title width" and "preserved width" measure the
// distance between these and the gap between the two texts.
const PRESERVED_TEXT_TOP_Y = COLUMN_TOP_Y + OUTER_PAD;      // 96.06
const TITLE_TEXT_BOTTOM_Y = COLUMN_BOTTOM_Y - OUTER_PAD;    // 929.06

// Preserved is anchor='top'; the layer's yTop is fixed (= text top minus
// INNER_PAD) since the text top is pinned and the SVG height varies downward.
const PRESERVED_YTOP = PRESERVED_TEXT_TOP_Y - INNER_PAD;    // 92.06

// Total texture px available for the two texts together at any font size:
// the column minus both outer pads and the min gap. The shared font size
// shrinks once F·(titleAdv + preservedAdv) would exceed this.
const TEXT_BUDGET = COLUMN_LENGTH - 2 * OUTER_PAD - MIN_GAP; // 818

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
 * Layout (rotated reading direction):
 *   OUTER_PAD | preserved text | MIN_GAP | title text | OUTER_PAD = COLUMN_LENGTH
 *
 * Both texts render naturally (no glyph deformation). The only free variable
 * is the shared font size F, since OUTER_PAD and MIN_GAP are fixed texture
 * px. We solve for the largest F ≤ MAX_FONT_SIZE such that
 *
 *   preservedAdv·F + titleAdv·F ≤ TEXT_BUDGET
 *
 * (TEXT_BUDGET = 933 − 2·50 − 15 = 818). Below that threshold the natural
 * fit already leaves a gap > MIN_GAP at F = MAX_FONT_SIZE, so we keep F at
 * the design size; above it, F shrinks just enough to land the gap on the
 * MIN_GAP boundary. Returns each layer's yTop too — the title is bottom-
 * anchored so its yTop moves with its dynamic height; the preserved yTop is
 * constant (text top is pinned).
 */
export function computeSideLayout(titleText) {
  const pAdv = measureWidth(DEFAULT_PRESERVED_TEXT, 1);
  const tAdv = measureWidth(titleText || ' ', 1);
  const denom = pAdv + tAdv;
  const fitF = denom > 0 ? TEXT_BUDGET / denom : MAX_FONT_SIZE;
  const fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fitF));

  const preservedWidth = pAdv * fontSize;
  const titleWidth = tAdv * fontSize;

  // Each SVG is just big enough to hold its text plus INNER_PAD safety margin.
  const preservedHeight = Math.max(1, Math.ceil(preservedWidth + 2 * INNER_PAD));
  const titleHeight = Math.max(1, Math.ceil(titleWidth + 2 * INNER_PAD));

  // Title yTop so its SVG bottom edge lands at TITLE_TEXT_BOTTOM_Y + INNER_PAD
  // (i.e. the text bottom edge ends exactly at TITLE_TEXT_BOTTOM_Y).
  const titleYTop = TITLE_TEXT_BOTTOM_Y + INNER_PAD - titleHeight;

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
