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

// Element layers composing the Decal, in draw order (back to front). x / yTop are
// each element SVG's top-left in texture space at REF_HEIGHT; `anchor` says how it
// is repositioned as the band height changes (confirmed by the Decal-1→Decal-2
// shift, Δheight = 658):
//   top     – y fixed (pinned to the frame top; Δ 0)
//   bottom  – y shifts down by the full height delta (pinned to the bottom; Δ 658)
//   center  – y shifts by half the delta (constant offset from the centre; Δ 329)
//   stretch – fills the whole band height (y = 0..H), like the artwork
// Files live under 'elements/svg elements/'; label.js fetches ELEMENT_FILES.
// (The "Anchoring facts" table — formerly a 'stretch' layer here — is now rendered
// live from HTML by lib/anchoring-facts.js so it reflows; see draw() below.)
const LAYERS = [
  { name: 'smiths',          file: 'Smiths.svg',           x: 317.22,  yTop: 40.73,  anchor: 'top' },
  { name: 'sm-logo',         file: 'SM-logo.svg',          x: 329,     yTop: 880,    anchor: 'bottom' },
  { name: 'preserved',       file: 'Preserved.svg',        x: 1787.66, yTop: 46.06,  anchor: 'top' },
  { name: 'title-side',      file: 'Artwork title side.svg', x: 1795.16, yTop: 589.06, anchor: 'bottom' },
  // Circle.svg is the SALT medallion. Its central disc (the r=238 #574BA6 circle)
  // sits at (974.14, 974.14) in the 1952×1659 viewBox, and that disc lands at
  // (2970.85, 676.85) in Decal-1 (H=1032) and (2970.86, 1005.85) in Decal-2
  // (H=1690) — Δy 329 for ΔH 658, i.e. 'center'. So x = 2970.85 - 974.14 and
  // yTop = 676.85 - 974.14 (at H = REF_HEIGHT).
  { name: 'medallion',       file: 'Circle.svg',           x: 1996.71, yTop: -297.28, anchor: 'center' },
  { name: 'header',          file: 'Header.svg',           x: 2590,    yTop: 0,      anchor: 'top' },
  { name: 'barcode',         file: 'Barcode.svg',          x: 3724,    yTop: 0,      anchor: 'top' },
  { name: 'stamp',           file: 'Stamp.svg',            x: 3726,    yTop: 531.19, anchor: 'center' },
  { name: 'footer-pill',     file: 'Acceptance.svg',       x: 2704,    yTop: 928,    anchor: 'bottom' },
  { name: 'datamatrix',      file: 'Datamatrix.svg',       x: 3834,    yTop: 908.38, anchor: 'bottom' },
];

// The element SVGs the builder expects (single source of truth for label.js).
export const ELEMENT_FILES = LAYERS.map((l) => l.file);

// Decal authored colours mapped to the derived trio. #574BA6 carries two roles:
// the masked SALT letter edges (outline) and the solid pills (background) — the
// masked variant is matched first by its `mask=` attribute so the two stay
// distinct. The pink page fill (#F2529D) is the background frame; the dark ink
// (#272727) and the yellows (#F2C335 SALT, #F8EE46 accent) are foreground, mapped
// to text. The lone #D9D9D9 (an avatar placeholder) and white/black are untouched.
export function recolorDecalSvg(svg, { background, text, outline }) {
  return svg
    .replace(/fill="#574BA6"(\s+mask="url\([^"]*\)")/gi, `fill="${outline}"$1`)
    .replace(/fill="#574BA6"/gi, `fill="${background}"`)
    .replace(/fill="#F2529D"/gi, `fill="${background}"`)
    .replace(/fill="#F2C335"/gi, `fill="${text}"`)
    .replace(/fill="#F8EE46"/gi, `fill="${text}"`)
    .replace(/fill="#272727"/gi, `fill="${text}"`);
}

// The header wordmark ("SALT Classic") is recoloured on its own: its purple plate
// — the pill *and* the masked rim hugging the SALT letters — reads as one piece,
// so both #574BA6 variants take `outline`, unlike the shared mapping above where a
// bare pill is `background`. The SALT glyphs stay `text`; the "Classic" script
// (white) and the mask's own black/white geometry are left untouched.
export function recolorHeaderSvg(svg, { text, outline }) {
  return svg
    .replace(/fill="#574BA6"/gi, `fill="${outline}"`)
    .replace(/fill="#F2C335"/gi, `fill="${text}"`);
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

  // Per-layer state: the manifest descriptor + its raw svg and recoloured raster.
  const layers = LAYERS.map((desc) => ({ ...desc, svgText: null, img: null }));

  // The "Anchoring facts" table renders live (reflowing) from HTML, so it lives
  // outside `layers`: it must re-render on every size + colour change, not just be
  // recoloured. anchoringToken drops any stale in-flight render.
  const anchoring = createAnchoringFacts();
  let anchoringImg = null;
  let anchoringToken = 0;

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

    // 1) Pink page background, white structural bars, black artwork slot.
    ctx.fillStyle = colors.background || '#000000';
    ctx.fillRect(0, 0, canvas.width, h);
    ctx.fillStyle = '#ffffff';
    for (const bar of SIDE_BARS) ctx.fillRect(bar.x * s, 0, bar.width * s, h);
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
        0, 0, anchoringImg.naturalWidth, anchoringImg.naturalHeight,
        0, 0, Lh, Tw,
      );
      ctx.restore();
    }

    // 4) Flat element layers — each placed by its anchor and drawn at natural size,
    //    so it never distorts. 'stretch' layers fill the band height like the artwork.
    for (const L of layers) {
      if (!L.img) continue;
      const drawW = L.img.naturalWidth;
      const drawH = L.anchor === 'stretch' ? H : L.img.naturalHeight;
      ctx.drawImage(
        L.img, 0, 0, L.img.naturalWidth, L.img.naturalHeight,
        L.x * s, layerY(L, H) * s, drawW * s, drawH * s,
      );
    }
  }

  // Re-rasterise one recoloured layer, redrawing once it's ready. The previous
  // raster stays on screen until the new one decodes (avoids a flicker).
  function rebuildLayer(L) {
    if (!L.svgText) { L.img = null; return; }
    const recolor = L.name === 'header' ? recolorHeaderSvg : recolorDecalSvg;
    rasterizeSvg(recolor(L.svgText, colors), {
      onload: (img) => { L.img = img; draw(); },
      onerror: () => console.warn(`label-texture: ${L.file} failed to rasterise`),
    });
  }
  const rebuildAll = () => { for (const L of layers) rebuildLayer(L); };

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

  draw(); // give the canvas its initial dimensions immediately
  anchoring.load().then(renderAnchoring, (err) =>
    console.warn('label-texture: anchoring-facts failed to load', err),
  );

  return {
    canvas,
    get bandHeight() { return bandHeight; },
    setBandHeight(px) { bandHeight = Math.max(1, Math.round(px)); draw(); renderAnchoring(); },
    setArtwork(img) { artworkImg = img; draw(); },
    // svgByFile: { [filename]: svgText } — keyed by the ELEMENT_FILES names.
    setElements(svgByFile) {
      for (const L of layers) {
        if (svgByFile[L.file] != null) L.svgText = svgByFile[L.file];
      }
      rebuildAll();
    },
    setColors(next) {
      colors = { ...colors, ...next };
      draw();             // background/bars update immediately
      rebuildAll();       // layers re-raster async, then redraw
      renderAnchoring();  // table re-renders with the new ink, then redraws
    },
    draw,
  };
}
