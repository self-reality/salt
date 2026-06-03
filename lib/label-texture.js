// -----------------------------------------------------------------------------
// Label-texture builder — pure 2D canvas, no THREE.
//
// Composites the can's full label wrap (the "Decal") on an offscreen <canvas>
// from its individual element SVGs (header, Smiths blurb, the SALT logo medallion,
// footer pill, datamatrix, …) plus the live-rendered Anchoring-facts table, all
// recoloured to the live palette, with the artwork drawn into the Art slot. This
// is the canonical place
// the label is composited: the standalone label.html dev page drives it directly,
// and the 3D scenes can import the same builder and wrap `.canvas` in a texture.
//
// All coordinates are authored in 4096-wide texture space (the Decal frame is
// 4096 wide, sitting BAND_TOP px down from the full can texture's top). The
// working canvas *is* that band: its width is the texture width and its height is
// the draggable band dimension (the analog of the can's Y size), driven by the
// artwork's aspect ratio.
//
// The band height varies, but the elements must not distort with it — so instead
// of stretching one flat Decal image, each element is placed every frame at a
// height-dependent position from its *anchor* rule (see LAYERS). The rules were
// derived by diffing two reference exports of the same decal at different heights,
// elements/Decal-1.svg (4096×1032) and elements/Decal-2.svg (4096×1690).
//
// One element is special: the "Anchoring facts" table reflows instead of scaling,
// so it's rendered live from elements/anchoring-facts.html (see lib/anchoring-facts.js)
// rather than placed as a flat SVG layer.
// -----------------------------------------------------------------------------

import {
  createAnchoringFacts,
  ANCHORING_X,
  ANCHORING_THICKNESS,
  ANCHORING_PAD,
} from './anchoring-facts.js';
import {
  createSmithsText,
  DEFAULT_SMITHS_TEXT,
  SMITHS_X,
  SMITHS_TOP,
  SMITHS_THICKNESS,
  SMITHS_BOTTOM_TO_LOGO,
} from './smiths-text.js';
import { hexToRgb, contrastRatio, relativeLuminance } from './color-extraction.js';

export { DEFAULT_SMITHS_TEXT } from './smiths-text.js';

export const TEX_WIDTH = 4096;
export const BAND_TOP = 2011;            // metadata: Decal offset on the full texture
export const DEFAULT_BAND_HEIGHT = 1033; // the draggable dimension (analog of can Y)
export const REF_HEIGHT = 1032;          // band height the LAYERS coords were measured at (Decal-1)

// Artwork slot: the Decal's "Art" frame (x 490, full band height, 1282 wide).
// The live artwork is drawn here, over the black placeholder rect.
export const ARTWORK_RECT = { x: 490, y: 0, width: 1282 };

// Full-height white structural bars from the Decal frame: the left margin and the
// two thin dividers. They tile cleanly with height, so they're drawn as rects.
const SIDE_BARS = [
  { x: 0, width: 296 },    // left white margin
  { x: 296, width: 4 },    // left divider
  { x: 4040, width: 4 },   // right divider
];

// The Instagram handle mark sits in the left white margin (the first SIDE_BAR,
// x 0..296). The PNG is authored vertically (42×360, reading bottom-to-top), so
// it drops straight into the column with no rotation. IG_HANDLE_MARGIN mirrors
// side-text.js's OUTER_PAD (50) so the mark's top/bottom inset matches the
// author/title side column; it's scaled to fill the band height less that margin
// and centered across the 296px column. See draw().
const IG_HANDLE_FILE = 'elements/svg elements/ig-handle.png';
const IG_HANDLE_COLUMN_WIDTH = 296;
const IG_HANDLE_MARGIN = 50;

// Element layers composing the Decal, in draw order (back to front). x / yTop are
// each element SVG's top-left in texture space at REF_HEIGHT; `anchor` says how it
// is repositioned as the band height changes (confirmed by the Decal-1→Decal-2
// shift, Δheight = 658):
//   top     – y fixed (pinned to the frame top; Δ 0)
//   bottom  – y shifts down by the full height delta (pinned to the bottom; Δ 658)
//   center  – y shifts by half the delta (constant offset from the centre; Δ 329)
//   stretch – fills the whole band height (y = 0..H), like the artwork
// Files live under 'elements/svg elements/'; label.js fetches ELEMENT_FILES.
// (Two former layers — "Anchoring facts" and the Smiths blurb — are now rendered
// live from HTML so they reflow and stay editable; see lib/anchoring-facts.js,
// lib/smiths-text.js, and draw() below.)
const LAYERS = [
  { name: 'sm-logo',         file: 'SM-logo.svg',          x: 329,     yTop: 880,    anchor: 'bottom' },
  // Preserved + title-side share x so their visual centres line up on the same
  // side-column; both SVGs are now generated 51 wide by lib/side-text.js.
  { name: 'preserved',       file: 'Preserved.svg',        x: 1795.16, yTop: 46.06,  anchor: 'top' },
  { name: 'title-side',      file: 'Artwork title side.svg', x: 1795.16, yTop: 589.06, anchor: 'bottom' },
  // Circle.svg is the SALT medallion. Its central disc (the r=238 #574BA6 circle)
  // sits at (974.14, 974.14) in the 1952×1659 viewBox, and that disc lands at
  // (2970.85, 676.85) in Decal-1 (H=1032) and (2970.86, 1005.85) in Decal-2
  // (H=1690) — Δy 329 for ΔH 658, i.e. 'center'. So x = 2970.85 - 974.14 and
  // yTop = 676.85 - 974.14 (at H = REF_HEIGHT). The yTop/anchor here are the
  // "natural" centre-anchor pair used only at H ≥ TOP_TRIO_CENTER_ANCHOR_MIN_H;
  // below that the top-trio rule in draw() overrides y from innerTop instead.
  { name: 'medallion',       file: 'Circle.svg',           x: 1996.71, yTop: -297.28, anchor: 'center' },
  { name: 'header',          file: 'Header.svg',           x: 2590,    yTop: 0,      anchor: 'top' },
  { name: 'barcode',         file: 'Barcode.svg',          x: 3724,    yTop: 0,      anchor: 'top' },
  { name: 'stamp',           file: 'Stamp.svg',            x: 3726,    yTop: 531.19, anchor: 'center' },
  { name: 'footer-pill',     file: 'Acceptance.svg',       x: 2704,    yTop: 928,    anchor: 'bottom' },
  // Datamatrix is generated live by lib/datamatrix.js at DATAMATRIX_SIZE
  // (= 96 × 1.15 = 110.4) — the old static asset had a 96×96 inner matrix in a
  // 96×104 SVG, the spec scales the visible matrix 15% up. x keeps the stamp
  // and datamatrix on one centre line (3882 = 3726 + 312/2); yTop preserves
  // the old 25.62 px gap between the visible matrix bottom and the band's
  // bottom edge (REF_HEIGHT − DATAMATRIX_SIZE − 25.62).
  { name: 'datamatrix',      file: 'Datamatrix.svg',       x: 3826.8,  yTop: 895.98, anchor: 'bottom' },
];

// The decal-background pattern — drawn over the solid background fill but
// under the white side bars, the artwork slot, and every glyph layer. Authored
// at 7012×6205 with a #F2529D reference rect marking the 4096×2196 decal area;
// prepareBackgroundSvg() crops the SVG to that rect and removes the rect.
// The visible paint is fill="black" at opacity 0.06 (the 4 clipPath rects use
// fill="white" for clip geometry only). A flat black overlay vanishes on dark
// backgrounds, so the pattern is re-tinted by brightness: white on dark
// backgrounds (it lightens instead of uselessly darkening), black on light ones,
// each at its own opacity (see backgroundPatternInk / rebuildBackground).
export const BACKGROUND_FILE = 'Background.svg';
const BACKGROUND_REGION = { x: 1770, y: 1416, width: 4096, height: 2196 };

// Below this background relative-luminance the pattern flips to white; above it
// stays black. White-on-dark is pushed a touch harder than black-on-light since
// the mid-tone backgrounds it now covers need more presence to read.
const BG_PATTERN_LIGHT_FLIP_LUM = 0.35;
const BG_PATTERN_OPACITY_ON_LIGHT = 0.07; // black pattern over a light background
const BG_PATTERN_OPACITY_ON_DARK = 0.1;   // white pattern over a dark background

export function backgroundPatternInk(bgHex) {
  return relativeLuminance(hexToRgb(bgHex)) < BG_PATTERN_LIGHT_FLIP_LUM
    ? '#ffffff'
    : '#000000';
}

// Crop the authored SVG to the decal rect, and optionally re-tint the visible
// paint (only fill="black" — the clipPath whites are geometry, left untouched)
// and rewrite the group opacity. Both `ink` and `opacity` are optional so the
// raw-crop call shape still works.
export function prepareBackgroundSvg(svgText, { ink = '#000000', opacity } = {}) {
  const { x, y, width, height } = BACKGROUND_REGION;
  let out = svgText
    .replace(/<rect\b[^>]*fill="#F2529D"[^>]*\/>\s*/i, '')
    .replace(
      /<svg\b[^>]*>/i,
      `<svg width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">`,
    );
  if (ink !== '#000000' && ink !== 'black') out = out.replace(/fill="black"/gi, `fill="${ink}"`);
  if (opacity != null) out = out.replace(/opacity="0\.06"/gi, `opacity="${opacity}"`);
  return out;
}

// The element SVGs the builder expects (single source of truth for label.js).
export const ELEMENT_FILES = [...LAYERS.map((l) => l.file), BACKGROUND_FILE];

// Right-column trio (Barcode top-anchored, Stamp centre-anchored, Datamatrix
// bottom-anchored). The stamp and datamatrix share centre x=3882 (= 3726 +
// 312/2 = 3826.8 + 110.4/2); the barcode's right edge sits flush with the
// right divider at x=4040 (= 3724 + 316). Their natural anchor offsets close
// the stamp→datamatrix gap at H≈922 and the barcode→stamp gap at H≈898; at
// H=930 the smaller of the two gaps is ~4 px — the floor below which the
// elements would overlap. So below H=RIGHT_COL_MIN_H we treat anchoring as if
// H were 930 and uniformly scale the trio by k = H / 930, keeping the stamp
// and datamatrix centred on RIGHT_COL_CENTER_X and the barcode pinned to its
// right-top corner so it stays flush with the divider.
const RIGHT_COL_NAMES = new Set(['barcode', 'stamp', 'datamatrix']);
const RIGHT_COL_MIN_H = 930;
const RIGHT_COL_CENTER_X = 3882;
const BARCODE_RIGHT_X = 4040;

// Top trio (Header top-anchored, the medallion's central "Inner Circle"
// — the r=238 #574BA6 disc at (974.138, 974.137) in Circle.svg's
// 1952×1912 viewBox — between them, and the Acceptance pill bottom-
// anchored). The band must hold the three stacked with min spacings s₁
// above the Inner Circle (default 10 px) and s₂ below it (default −5;
// negative means a small overlap with the pill is fine):
//
//     H = 322·k + s₁ + 476·k + s₂ + 104·k = 902·k + (s₁ + s₂)
//
// so the natural-size fit threshold is 902 + s₁ + s₂ (k=1). Below that we
// scale the trio uniformly by k = (H − s₁ − s₂) / 902; never above 1. The
// two spacings are live (setMinSpacings()) so the side panel can tune
// them; the thresholds below are computed per frame from current state.
// INNER_CIRCLE_TOP_IN_SVG = 974.137 − 238 is the Inner Circle's top edge
// in Circle.svg coords, used to convert the chosen Inner Circle top in
// canvas-y back into Circle.svg's drawn yTop.
const TOP_TRIO_NAMES = new Set(['header', 'medallion', 'footer-pill']);
const INNER_CIRCLE_TOP_IN_SVG = 736.137;
export const DEFAULT_INNER_CIRCLE_SPACING_ABOVE = 10;
export const DEFAULT_INNER_CIRCLE_SPACING_BELOW = -5;
// Per-frame helpers. centerAnchorMinH: at k=1 the centre-anchored Inner
// Circle bottom is at H/2 + 398.857, so it keeps the spacing ≥ s₂ as long
// as (H − 104) − (H/2 + 398.857) ≥ s₂, i.e. H ≥ 2·(s₂ + 502.857). Below
// that we pin the Inner Circle bottom s₂ below the pill top. topTrioMinH:
// the fit threshold derived from the equation above.
const centerAnchorMinH = (s2) => 2 * (s2 + 502.857);
const topTrioMinH = (s1, s2) => 902 + s1 + s2;

// SM-logo's top edge at band height H (it's bottom-anchored, so its top sits a
// fixed distance from the band's bottom). Used as the lower boundary of the
// Smiths text block — that block's length grows with the band height.
const SM_LOGO = LAYERS.find((l) => l.name === 'sm-logo');
const SM_LOGO_OFFSET = REF_HEIGHT - SM_LOGO.yTop; // 152 px above band bottom
const smLogoTop = (H) => H - SM_LOGO_OFFSET;
const smithsLengthFor = (H) =>
  Math.max(1, smLogoTop(H) - SMITHS_BOTTOM_TO_LOGO - SMITHS_TOP);

// Decal authored colours mapped to the derived trio. #574BA6 is the outline ink
// everywhere it appears: the masked SALT letter edges, the medallion disc
// (Circle.svg) and the footer pill (Acceptance.svg) — the only decal layers that
// carry it. The pink page fill (#F2529D) is the background frame; the dark ink
// (#272727) and the yellows (#F2C335 SALT, #F8EE46 accent) are foreground, mapped
// to text. The lone #D9D9D9 (an avatar placeholder) and white/black are untouched.
export function recolorDecalSvg(svg, { background, text, outline }) {
  return svg
    .replace(/fill="#574BA6"/gi, `fill="${outline}"`)
    .replace(/fill="#F2529D"/gi, `fill="${background}"`)
    .replace(/fill="#F2C335"/gi, `fill="${text}"`)
    .replace(/fill="#F8EE46"/gi, `fill="${text}"`)
    .replace(/fill="#272727"/gi, `fill="${text}"`);
}

// The header wordmark ("SALT Classic") is recoloured on its own: its purple plate
// — the pill *and* the masked rim hugging the SALT letters — reads as one piece,
// both #574BA6 variants taking `outline` (as it does across the decal). It maps
// only the two inks it actually uses; the SALT glyphs stay `text`, while the
// "Classic" script (white) and the mask's own black/white geometry are untouched.
export function recolorHeaderSvg(svg, { text, outline }) {
  return svg
    .replace(/fill="#574BA6"/gi, `fill="${outline}"`)
    .replace(/fill="#F2C335"/gi, `fill="${text}"`);
}

// Header/Circle/Acceptance/Stamp carry visible white glyphs (the "Classic"
// script, the medallion text, the pill text, the rotated stamp text + rim) on a
// coloured patch — `outline` for the pill/disc layers, `background` for the
// stamp (which sits straight on the label background). When that patch goes
// near-white the glyphs vanish, so we flip them to black below a contrast
// threshold. WCAG large-text floor is 3:1; we trigger the flip a touch earlier
// at 3.5:1 so things like (244,244,246) (white-contrast ≈ 1.10) and
// (238,230,220) (≈ 1.24) are caught cleanly, without disturbing normal
// saturated outlines (e.g. #574BA6 ≈ 8.6:1).
const WHITE_FLIP_MIN_CONTRAST = 3.5;
const WHITE_RGB = [255, 255, 255];

export function inkOverWhiteOn(bgHex) {
  return contrastRatio(WHITE_RGB, hexToRgb(bgHex)) < WHITE_FLIP_MIN_CONTRAST
    ? '#000000'
    : '#ffffff';
}

// Replace `fill="white"` / `stroke="white"` outside `<mask>` blocks (Header.svg
// uses a white-fill rect *inside* a mask as its show region — flipping that
// would erase the wordmark). The regex alternates: a whole mask block matches
// first and is preserved verbatim; otherwise an isolated white fill/stroke
// attribute is rewritten.
function recolorWhiteInk(svg, ink) {
  if (ink === '#ffffff') return svg;
  return svg.replace(
    /<mask\b[\s\S]*?<\/mask>|(fill|stroke)="white"/gi,
    (match, attr) => (attr ? `${attr}="${ink}"` : match),
  );
}

export const svgToDataUrl = (svg) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// Element SVGs embed raster assets (logos, barcode, datamatrix, avatar), so each
// is rasterised via a Blob URL rather than a data URL — far cheaper than
// percent-encoding the whole string on every recolour.
function rasterizeSvg(svgText, { onload, onerror }) {
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); onload(img); };
  img.onerror = (err) => { URL.revokeObjectURL(url); onerror?.(err); };
  img.src = url;
}

// Undistorted band height for an artwork shown in the fixed-width artwork slot —
// the same relationship as the can-stretch factor in lib/can.js (the artwork
// fills the band height, so band height tracks the artwork's aspect ratio).
export function bandHeightForArtwork(img) {
  if (!img || !img.width) return DEFAULT_BAND_HEIGHT;
  return Math.round((ARTWORK_RECT.width * img.height) / img.width);
}

/**
 * Creates a label-band builder.
 *
 * @param {object} [opts]
 * @param {number} [opts.resolution] - internal canvas width in px (default 4096).
 *   Every authored coordinate is scaled by `resolution / TEX_WIDTH`, mirroring
 *   lib/can.js so lower-res working canvases stay pixel-faithful.
 * @returns builder with { canvas, bandHeight, setBandHeight, setArtwork,
 *   setElements, setColors, draw }.
 */
export function createLabelTexture({ resolution = TEX_WIDTH } = {}) {
  const s = resolution / TEX_WIDTH;

  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  const ctx = canvas.getContext('2d');

  let bandHeight = DEFAULT_BAND_HEIGHT;
  let artworkImg = null;                                   // HTMLImageElement
  let colors = { background: '#000000', text: '#ffffff', outline: '#000000' };
  // Top-trio min spacings around the Inner Circle (see TOP_TRIO_NAMES above).
  let innerCircleSpacingAbove = DEFAULT_INNER_CIRCLE_SPACING_ABOVE;
  let innerCircleSpacingBelow = DEFAULT_INNER_CIRCLE_SPACING_BELOW;

  // Per-layer state: the manifest descriptor + its raw svg and recoloured raster.
  const layers = LAYERS.map((desc) => ({ ...desc, svgText: null, img: null }));

  // Decal-background pattern (see BACKGROUND_FILE above). Held outside `layers`
  // because it draws at a different z-order (under the side bars), not after
  // the anchored stack. The raw svg is kept so the pattern can be re-tinted on
  // palette changes (its ink/opacity depend on colors.background).
  let backgroundSvgText = null;
  let backgroundImg = null;

  // The Instagram-handle brand mark in the left white margin. A fixed asset (not
  // per-artwork), loaded once as a same-origin PNG — same pattern as the SM logo
  // in lib/anchoring-facts.js, which keeps the canvas un-tainted for the WebGL
  // texture upload. Drawn in draw() over the left side bar.
  let igHandleImg = null;

  // The "Anchoring facts" table renders live (reflowing) from HTML, so it lives
  // outside `layers`: it must re-render on every size + colour change, not just be
  // recoloured. anchoringToken drops any stale in-flight render.
  const anchoring = createAnchoringFacts();
  let anchoringImg = null;
  let anchoringToken = 0;

  // The Smiths-text block — also a live HTML render so the copy is editable
  // from the side panel. Same stale-token pattern as the anchoring table.
  const smiths = createSmithsText();
  let smithsText = DEFAULT_SMITHS_TEXT;
  let smithsImg = null;
  let smithsToken = 0;

  // Optional repaint listener. Fired at the end of every draw() — sync and
  // async alike — so a consumer (e.g. lib/can.js) can re-blit this canvas into
  // a texture and flag needsUpdate as the async layers decode in. label.html
  // doesn't set it (its on-screen canvas *is* this canvas), so it's a no-op there.
  let onDraw = null;

  // Top edge (texture space) at which a layer is drawn for the current height H.
  function layerY(desc, H) {
    switch (desc.anchor) {
      case 'bottom': return desc.yTop + (H - REF_HEIGHT);
      case 'center': return desc.yTop + (H - REF_HEIGHT) / 2;
      case 'stretch': return 0;
      default: return desc.yTop; // 'top'
    }
  }

  function draw() {
    const H = bandHeight;
    const h = Math.max(1, Math.round(H * s));
    if (canvas.height !== h) canvas.height = h;             // resizing resets ctx state
    ctx.imageSmoothingQuality = 'high';

    // 1) Pink page background, decal pattern, white structural bars, black
    //    artwork slot. The pattern sits between the solid fill and the bars so
    //    it shows in the gaps between the bars / outside the artwork only.
    ctx.fillStyle = colors.background || '#000000';
    ctx.fillRect(0, 0, canvas.width, h);
    if (backgroundImg) {
      // Width-cover, top-aligned: the 4096-wide pattern fills the band width
      // at native aspect; the bottom of the 2196-tall design is clipped off
      // when the band is shorter.
      ctx.drawImage(
        backgroundImg,
        0, 0, backgroundImg.naturalWidth, backgroundImg.naturalHeight,
        0, 0, BACKGROUND_REGION.width * s, BACKGROUND_REGION.height * s,
      );
    }
    ctx.fillStyle = '#ffffff';
    for (const bar of SIDE_BARS) ctx.fillRect(bar.x * s, 0, bar.width * s, h);
    // Instagram-handle mark over the left white margin: scaled to the band height
    // less IG_HANDLE_MARGIN top and bottom, centered across the 296px column.
    if (igHandleImg) {
      // Fill the band height less the margin, but never upscale past the PNG's
      // native height (360 px).
      const drawH = Math.max(1, Math.min(H - 2 * IG_HANDLE_MARGIN, igHandleImg.naturalHeight));
      const drawW = drawH * (igHandleImg.naturalWidth / igHandleImg.naturalHeight);
      const x = (IG_HANDLE_COLUMN_WIDTH - drawW) / 2; // centered across the column
      const y = (H - drawH) / 2;                       // centered down the band
      ctx.drawImage(
        igHandleImg, 0, 0, igHandleImg.naturalWidth, igHandleImg.naturalHeight,
        x * s, y * s, drawW * s, drawH * s,
      );
    }
    ctx.fillStyle = '#000000';
    ctx.fillRect(ARTWORK_RECT.x * s, 0, ARTWORK_RECT.width * s, h);

    // 2) Artwork over its slot, top-anchored and filling the band height (its
    //    aspect ratio set that height).
    if (artworkImg) {
      ctx.drawImage(
        artworkImg, 0, 0, artworkImg.width, artworkImg.height,
        ARTWORK_RECT.x * s, 0, ARTWORK_RECT.width * s, h,
      );
    }

    // 3) Anchoring-facts table — rendered un-rotated (length × thickness) and
    //    placed rotated 90° into its slot: its length fills the band height (less
    //    ANCHORING_PAD inset top and bottom) while its thickness is fit to the
    //    fixed slot width. Drawn first (back-most), as it was the back layer in
    //    the old manifest.
    if (anchoringImg) {
      const X = ANCHORING_X * s;
      const pad = ANCHORING_PAD * s;
      const Lh = Math.max(1, H * s - 2 * pad); // band length less top/bottom padding
      const Tw = ANCHORING_THICKNESS * s;      // fixed slot width, across the texture
      ctx.save();
      ctx.translate(X, H * s - pad);           // table bottom sits PAD above the band's bottom edge
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(
        anchoringImg,
        0, 0, anchoringImg.width, anchoringImg.height,
        0, 0, Lh, Tw,
      );
      ctx.restore();
    }

    // 4) Smiths text block — rendered un-rotated (length × thickness) and placed
    //    rotated 90° into its slot. Top inset is fixed (SMITHS_TOP below the
    //    band's top); the bottom hugs SM-logo's top with SMITHS_BOTTOM_TO_LOGO
    //    of clearance, so the block's *length* grows with band height. The text
    //    renderer picks a font size that fills (length × thickness).
    if (smithsImg) {
      const L = smithsLengthFor(H);
      const X = SMITHS_X * s;
      const Yb = (SMITHS_TOP + L) * s; // bottom of slot in canvas px
      const Lw = L * s;
      const Tw = SMITHS_THICKNESS * s;
      ctx.save();
      ctx.translate(X, Yb);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(
        smithsImg,
        0, 0, smithsImg.width, smithsImg.height,
        0, 0, Lw, Tw,
      );
      ctx.restore();
    }

    // 5) Flat element layers — each placed by its anchor and drawn at natural size,
    //    so it never distorts. 'stretch' layers fill the band height like the artwork.
    //    Two exception groups share-scale uniformly so their stacks don't collide:
    //      - Right-column trio (Barcode/Stamp/Datamatrix) below RIGHT_COL_MIN_H,
    //        uniformly scaled around its shared centre / right edge.
    //      - Top trio (Header/Medallion/Acceptance) below TOP_TRIO_MIN_H, with the
    //        medallion's Inner Circle placed to honour the 10 / −5 min spacings
    //        described next to TOP_TRIO_NAMES above. Between TOP_TRIO_MIN_H and
    //        TOP_TRIO_CENTER_ANCHOR_MIN_H the trio runs at k=1 but the Inner
    //        Circle gets pinned 5 px below the pill so spacing₂ stays at −5;
    //        above TOP_TRIO_CENTER_ANCHOR_MIN_H the medallion reverts to its
    //        natural centre anchor (no change from before this rule existed).
    const rightScale = H < RIGHT_COL_MIN_H ? H / RIGHT_COL_MIN_H : 1;
    const rightAnchorH = Math.max(H, RIGHT_COL_MIN_H);
    const s1 = innerCircleSpacingAbove;
    const s2 = innerCircleSpacingBelow;
    const topMinH = topTrioMinH(s1, s2);                    // = 902 + s1 + s2
    const centerMinH = centerAnchorMinH(s2);                // = 2·(s2 + 502.857)
    const topScale = H < topMinH ? (H - s1 - s2) / 902 : 1;
    const innerTop =
      topScale < 1                ? 322 * topScale + s1
      : H >= centerMinH           ? H / 2 - 77.143
      :                             H - 580 - s2;
    for (const L of layers) {
      if (!L.img) continue;
      const rightCol = RIGHT_COL_NAMES.has(L.name);
      const topCol = TOP_TRIO_NAMES.has(L.name);
      const k = rightCol ? rightScale : topCol ? topScale : 1;
      const anchorH = rightCol ? rightAnchorH : H;
      const drawW = L.img.naturalWidth * k;
      const drawH = (L.anchor === 'stretch' ? H : L.img.naturalHeight) * k;
      // x — right-col elements scale around their shared centre / right edge;
      // top-trio elements scale around each layer's own natural centre x so
      // they shrink in place (the three centres sit ~1.5 px apart on x≈2972,
      // so this also keeps the trio visually stacked on a single axis). The
      // medallion's "centre" for this purpose is its Inner Circle centre
      // (974.138 in SVG coords), not the SVG midline — slightly off-axis from
      // the SVG centre but the inner disc is what the eye locks onto.
      let x;
      if (rightCol) {
        x = L.name === 'barcode' ? BARCODE_RIGHT_X - drawW : RIGHT_COL_CENTER_X - drawW / 2;
      } else if (L.name === 'medallion') {
        const innerCircleCenterX = L.x + 974.138;        // = 2970.85
        x = innerCircleCenterX - 974.138 * k;
      } else if (topCol) {
        const centerX = L.x + L.img.naturalWidth / 2;
        x = centerX - drawW / 2;
      } else {
        x = L.x;
      }
      // Top-trio y rules — medallion is positioned from innerTop; header
      // stays at y=0 (top-anchored * k = 0); pill keeps its bottom at y=H
      // (so top = H − 104·k, which differs from layerY()*k once k<1).
      let y;
      if (L.name === 'medallion') {
        y = innerTop - INNER_CIRCLE_TOP_IN_SVG * k;
      } else if (L.name === 'footer-pill') {
        y = H - L.img.naturalHeight * k;
      } else if (rightCol) {
        y = layerY(L, anchorH) * k;
      } else {
        y = layerY(L, H) * k;
      }
      ctx.drawImage(
        L.img, 0, 0, L.img.naturalWidth, L.img.naturalHeight,
        x * s, y * s, drawW * s, drawH * s,
      );
    }

    if (onDraw) onDraw();
  }

  // Re-rasterise one recoloured layer, redrawing once it's ready. The previous
  // raster stays on screen until the new one decodes (avoids a flicker).
  function rebuildLayer(L) {
    if (!L.svgText) { L.img = null; return; }
    const recolor = L.name === 'header' ? recolorHeaderSvg : recolorDecalSvg;
    let svg = recolor(L.svgText, colors);
    // Patch the layer's white glyphs sit on: outline for header/medallion/
    // footer-pill, background for the stamp. Other layers keep their whites
    // untouched (they sit on the white side bars or carry no visible white).
    const whitePatch =
      L.name === 'header' || L.name === 'medallion' || L.name === 'footer-pill'
        ? colors.outline
        : L.name === 'stamp'
          ? colors.background
          : null;
    if (whitePatch) svg = recolorWhiteInk(svg, inkOverWhiteOn(whitePatch));
    rasterizeSvg(svg, {
      onload: (img) => { L.img = img; draw(); },
      onerror: () => console.warn(`label-texture: ${L.file} failed to rasterise`),
    });
  }
  const rebuildAll = () => { for (const L of layers) rebuildLayer(L); };

  // Re-raster the decal-background pattern from the stored svg, tinting it to
  // the current background's brightness. Runs on setElements/setElement (new
  // source) and on setColors (the tint tracks the palette).
  function rebuildBackground() {
    if (!backgroundSvgText) { backgroundImg = null; draw(); return; }
    const ink = backgroundPatternInk(colors.background);
    const opacity = ink === '#ffffff' ? BG_PATTERN_OPACITY_ON_DARK : BG_PATTERN_OPACITY_ON_LIGHT;
    rasterizeSvg(prepareBackgroundSvg(backgroundSvgText, { ink, opacity }), {
      onload: (img) => { backgroundImg = img; draw(); },
      onerror: () => console.warn(`label-texture: ${BACKGROUND_FILE} failed to rasterise`),
    });
  }

  // Re-render the live anchoring-facts table for the current band height + ink,
  // dropping any stale in-flight render. The previous raster stays on screen until
  // the new one decodes (no flicker), mirroring rebuildLayer.
  function renderAnchoring() {
    const token = ++anchoringToken;
    const length = Math.max(1, bandHeight - 2 * ANCHORING_PAD);
    anchoring.render(length, colors).then(
      (img) => { if (token === anchoringToken) { anchoringImg = img; draw(); } },
      (err) => console.warn('label-texture: anchoring-facts render failed', err),
    );
  }

  // Re-render the Smiths-text block for the current copy + length + ink. Same
  // flicker-free hand-off as renderAnchoring. Re-runs on band-height changes
  // too, since the length is band-dependent and the font size is fit to it.
  function renderSmiths() {
    const token = ++smithsToken;
    smiths.render(smithsText, smithsLengthFor(bandHeight), colors).then(
      (img) => { if (token === smithsToken) { smithsImg = img; draw(); } },
      (err) => console.warn('label-texture: smiths-text render failed', err),
    );
  }

  draw(); // give the canvas its initial dimensions immediately
  anchoring.load().then(renderAnchoring, (err) =>
    console.warn('label-texture: anchoring-facts failed to load', err),
  );
  renderSmiths();

  // Load the Instagram-handle mark once, then repaint so it appears.
  {
    const img = new Image();
    img.onload = () => { igHandleImg = img; draw(); };
    img.onerror = () => console.warn(`label-texture: ${IG_HANDLE_FILE} failed to load`);
    img.src = encodeURI(IG_HANDLE_FILE);
  }

  return {
    canvas,
    get bandHeight() { return bandHeight; },
    setBandHeight(px) {
      bandHeight = Math.max(1, Math.round(px));
      draw();
      renderAnchoring();
      renderSmiths(); // length is band-dependent, so refit the font too
    },
    setArtwork(img) { artworkImg = img; draw(); },
    // svgByFile: { [filename]: svgText } — keyed by the ELEMENT_FILES names.
    setElements(svgByFile) {
      for (const L of layers) {
        if (svgByFile[L.file] != null) L.svgText = svgByFile[L.file];
      }
      rebuildAll();
      if (svgByFile[BACKGROUND_FILE] != null) {
        backgroundSvgText = svgByFile[BACKGROUND_FILE];
        rebuildBackground();
      }
    },
    // Replace one element's source and re-raster only that layer — used for
    // live-edited elements (e.g. the barcode value) so the other layers don't
    // all decode again.
    setElement(file, svgText) {
      if (file === BACKGROUND_FILE) { backgroundSvgText = svgText; rebuildBackground(); return; }
      const L = layers.find((l) => l.file === file);
      if (!L) return;
      L.svgText = svgText;
      rebuildLayer(L);
    },
    // Move a layer along the texture's Y axis without re-rasterising it.
    // Used when a layer's natural height changes (live side-text labels): the
    // caller computes the new yTop so the layer's anchored edge stays put.
    // No draw() here — the paired setElement(...) call (or the next external
    // draw) picks up the new value once the new raster is ready.
    setLayerYTop(file, yTop) {
      const L = layers.find((l) => l.file === file);
      if (L) L.yTop = yTop;
    },
    setColors(next) {
      colors = { ...colors, ...next };
      draw();             // background/bars update immediately
      rebuildAll();       // layers re-raster async, then redraw
      rebuildBackground(); // pattern re-tints to the new background brightness
      renderAnchoring();  // table re-renders with the new ink, then redraws
      renderSmiths();     // smiths copy re-renders with the new ink too
    },
    setSmithsText(text) {
      smithsText = text == null ? '' : String(text);
      renderSmiths();
    },
    // Update either or both of the top-trio min spacings around the Inner
    // Circle. Caller may pass only one of {above, below}; the other stays.
    setMinSpacings({ above, below } = {}) {
      if (Number.isFinite(above)) innerCircleSpacingAbove = above;
      if (Number.isFinite(below)) innerCircleSpacingBelow = below;
      draw();
    },
    // Register a callback fired after every draw() (see onDraw above). Pass null
    // to detach. Consumers that mirror this canvas into a texture use it to
    // re-blit + flag needsUpdate as async layers decode in.
    setOnDraw(cb) { onDraw = cb || null; },
    draw,
  };
}
