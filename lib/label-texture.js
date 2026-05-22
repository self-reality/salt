// -----------------------------------------------------------------------------
// Label-texture builder — pure 2D canvas, no THREE.
//
// Constructs the can's label band (artwork + recoloured "SALT" header on a solid
// background) on an offscreen <canvas>. This is the canonical place the label is
// composited: the standalone label.html dev page drives it directly, and the 3D
// scenes can import the same builder and wrap `.canvas` in a CanvasTexture.
//
// All element coordinates are authored in 4096-wide texture space (the full can
// BaseColor texture). The label band is the 4096×1032 region that sits BAND_TOP
// px down from the texture's top edge; on this builder the working canvas *is*
// that band, so BAND_TOP is kept only as metadata for compositing back later.
// -----------------------------------------------------------------------------

export const TEX_WIDTH = 4096;
export const BAND_TOP = 2008;            // metadata: band offset on the full texture
export const DEFAULT_BAND_HEIGHT = 1032; // the draggable dimension (analog of can Y)

// Artwork slot: top-anchored, left-aligned, height follows the band. Authored as
// (122, 317) in lib/can.js's 1024-ref space, ×4 → (488, 1268) at 4096.
export const ARTWORK_RECT = { x: 488, y: 0, width: 1268 };

// Header: top-anchored, constant size. Centre-x 2971 → x = 2971 - 764/2 = 2589.
// (Matches the overlay UV/size the test scene used: scenes/test.js header decal.)
export const HEADER_RECT = { x: 2589, y: 0, width: 764, height: 324 };

// Header.svg authored colours mapped to the derived trio. #574BA6 is used twice:
// the pill rects (background) and the masked outline path — the latter matched
// first by its `mask=` attribute so the two roles stay distinct. (Moved here from
// scenes/test.js, which no longer constructs the header.)
export function recolorHeaderSvg(svg, { background, text, outline }) {
  return svg
    .replace(/fill="#574BA6"(\s+mask="url\([^"]*\)")/gi, `fill="${outline}"$1`)
    .replace(/fill="#574BA6"/gi, `fill="${background}"`)
    .replace(/fill="#F2C335"/gi, `fill="${text}"`);
}

export const svgToDataUrl = (svg) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

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
 *   setHeaderSvg, setColors, draw }.
 */
export function createLabelTexture({ resolution = TEX_WIDTH } = {}) {
  const s = resolution / TEX_WIDTH;

  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  const ctx = canvas.getContext('2d');

  let bandHeight = DEFAULT_BAND_HEIGHT;
  let artworkImg = null;                                   // HTMLImageElement
  let headerSvgText = null;                                // raw Header.svg source
  let headerImg = null;                                    // recoloured, rasterised
  let colors = { background: '#000000', text: '#ffffff', outline: '#000000' };

  function draw() {
    const h = Math.max(1, Math.round(bandHeight * s));
    if (canvas.height !== h) canvas.height = h;             // resizing resets ctx state
    ctx.imageSmoothingQuality = 'high';

    // Background fills the whole band.
    ctx.fillStyle = colors.background || '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Artwork: top-anchored, left-aligned, stretched to the full band height.
    if (artworkImg) {
      ctx.drawImage(
        artworkImg, 0, 0, artworkImg.width, artworkImg.height,
        ARTWORK_RECT.x * s, ARTWORK_RECT.y * s,
        ARTWORK_RECT.width * s, bandHeight * s,
      );
    }

    // Header: top-anchored, constant size (does not follow the band height).
    if (headerImg) {
      ctx.drawImage(
        headerImg, 0, 0, headerImg.width, headerImg.height,
        HEADER_RECT.x * s, HEADER_RECT.y * s,
        HEADER_RECT.width * s, HEADER_RECT.height * s,
      );
    }
  }

  // Re-rasterise the recoloured header SVG, redrawing once it's ready. Keeps the
  // previous header on screen until the new one decodes (avoids a flicker).
  function rebuildHeader() {
    if (!headerSvgText) { headerImg = null; draw(); return; }
    const img = new Image();
    img.onload = () => { headerImg = img; draw(); };
    img.onerror = () => console.warn('label-texture: header SVG failed to rasterise');
    img.src = svgToDataUrl(recolorHeaderSvg(headerSvgText, colors));
  }

  draw(); // give the canvas its initial dimensions immediately

  return {
    canvas,
    get bandHeight() { return bandHeight; },
    setBandHeight(px) { bandHeight = Math.max(1, Math.round(px)); draw(); },
    setArtwork(img) { artworkImg = img; draw(); },
    setHeaderSvg(svgText) { headerSvgText = svgText; rebuildHeader(); },
    setColors(next) {
      colors = { ...colors, ...next };
      draw();          // background updates immediately
      rebuildHeader(); // header re-rasters async, then redraws
    },
    draw,
  };
}
