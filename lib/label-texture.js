// -----------------------------------------------------------------------------
// Label-texture builder — pure 2D canvas, no THREE.
//
// Composites the can's full label wrap (the "Decal") on an offscreen <canvas>:
// the recoloured Decal.svg (background, Smiths blurb, Anchoring-facts table, the
// SALT header, circular back text, barcode/proof/datamatrix, …) with the live
// artwork drawn into the Art slot. This is the canonical place the label is
// composited: the standalone label.html dev page drives it directly, and the 3D
// scenes can import the same builder and wrap `.canvas` in a CanvasTexture.
//
// All element coordinates are authored in 4096-wide texture space (the Decal
// frame is 4096×1033, sitting BAND_TOP px down from the full can texture's top).
// The working canvas *is* that band: its width is the texture width and its
// height is the draggable band dimension (the analog of the can's Y size). The
// Decal.svg is stretched to fill the band height, so the artwork — whose aspect
// ratio drives that height — scales the whole label together (matching how the
// Figma frame's auto-layout fills the column heights).
// -----------------------------------------------------------------------------

export const TEX_WIDTH = 4096;
export const BAND_TOP = 2011;            // metadata: Decal offset on the full texture
export const DEFAULT_BAND_HEIGHT = 1033; // the draggable dimension (analog of can Y)

// Artwork slot: the Decal's "Art" frame (x 490, full band height, 1282 wide).
// The live artwork is drawn here, over the SVG's grey placeholder rect.
export const ARTWORK_RECT = { x: 490, y: 0, width: 1282 };

// Decal.svg authored colours mapped to the derived trio, extending the original
// header logic across the whole wrap. #574BA6 carries two roles: the masked SALT
// letter edges (outline) and the solid pills (background) — the masked variant is
// matched first by its `mask=` attribute so the two stay distinct. The pink page
// fill (#F2529D) is the background frame; the dark ink (#272727) and the yellows
// (#F2C335 SALT, #F8EE46 accent) are the foreground, mapped to text. The lone
// #D9D9D9 (the Art placeholder) and the masks' white/black are left untouched.
export function recolorDecalSvg(svg, { background, text, outline }) {
  return svg
    .replace(/fill="#574BA6"(\s+mask="url\([^"]*\)")/gi, `fill="${outline}"$1`)
    .replace(/fill="#574BA6"/gi, `fill="${background}"`)
    .replace(/fill="#F2529D"/gi, `fill="${background}"`)
    .replace(/fill="#F2C335"/gi, `fill="${text}"`)
    .replace(/fill="#F8EE46"/gi, `fill="${text}"`)
    .replace(/fill="#272727"/gi, `fill="${text}"`);
}

export const svgToDataUrl = (svg) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// Decal.svg embeds raster assets (logos, barcode, datamatrix, avatar) and runs to
// a couple of MB, so it's rasterised via a Blob URL rather than a data URL — far
// cheaper than percent-encoding the whole string on every recolour.
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
 *   setDecalSvg, setColors, draw }.
 */
export function createLabelTexture({ resolution = TEX_WIDTH } = {}) {
  const s = resolution / TEX_WIDTH;

  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  const ctx = canvas.getContext('2d');

  let bandHeight = DEFAULT_BAND_HEIGHT;
  let artworkImg = null;                                   // HTMLImageElement
  let decalSvgText = null;                                 // raw Decal.svg source
  let decalImg = null;                                     // recoloured, rasterised
  let colors = { background: '#000000', text: '#ffffff', outline: '#000000' };

  function draw() {
    const h = Math.max(1, Math.round(bandHeight * s));
    if (canvas.height !== h) canvas.height = h;             // resizing resets ctx state
    ctx.imageSmoothingQuality = 'high';

    // Decal (recoloured SVG: background + every foreground element), stretched to
    // fill the band height. Until it decodes, a flat background keeps the band
    // from flashing transparent.
    if (decalImg) {
      ctx.drawImage(
        decalImg, 0, 0, decalImg.width, decalImg.height,
        0, 0, canvas.width, h,
      );
    } else {
      ctx.fillStyle = colors.background || '#000000';
      ctx.fillRect(0, 0, canvas.width, h);
    }

    // Artwork: drawn into the Art slot over the SVG's placeholder, top-anchored
    // and stretched to the full band height (its aspect ratio set that height).
    if (artworkImg) {
      ctx.drawImage(
        artworkImg, 0, 0, artworkImg.width, artworkImg.height,
        ARTWORK_RECT.x * s, ARTWORK_RECT.y * s,
        ARTWORK_RECT.width * s, h,
      );
    }
  }

  // Re-rasterise the recoloured decal SVG, redrawing once it's ready. Keeps the
  // previous decal on screen until the new one decodes (avoids a flicker).
  function rebuildDecal() {
    if (!decalSvgText) { decalImg = null; draw(); return; }
    rasterizeSvg(recolorDecalSvg(decalSvgText, colors), {
      onload: (img) => { decalImg = img; draw(); },
      onerror: () => console.warn('label-texture: decal SVG failed to rasterise'),
    });
  }

  draw(); // give the canvas its initial dimensions immediately

  return {
    canvas,
    get bandHeight() { return bandHeight; },
    setBandHeight(px) { bandHeight = Math.max(1, Math.round(px)); draw(); },
    setArtwork(img) { artworkImg = img; draw(); },
    setDecalSvg(svgText) { decalSvgText = svgText; rebuildDecal(); },
    setColors(next) {
      colors = { ...colors, ...next };
      draw();         // flat-background fallback updates immediately
      rebuildDecal(); // decal re-rasters async, then redraws
    },
    draw,
  };
}
