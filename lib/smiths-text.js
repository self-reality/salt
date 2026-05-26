// -----------------------------------------------------------------------------
// Smiths text block — the long-form description that wraps the can vertically.
//
// Replaces the old "Smiths.svg" outlined-paths layer with an editable passage.
// Same approach as lib/anchoring-facts.js: an HTML block rendered into an SVG
// <foreignObject> and rasterised, so the browser does the typesetting and the
// copy reflows as the side-panel text changes. The natural-orientation block is
// rendered length × thickness; label-texture.js owns the 90° rotation and the
// placement. The block runs from 20 px below the band's top down to 20 px above
// the SM-logo's top edge, so its *length* (the reflow axis) grows with band
// height while its *thickness* stays fixed at 161 px. The font size is picked
// per render to fill that variable area as fully as possible.
// -----------------------------------------------------------------------------

// Texture-space placement constants. The slot's vertical extent on the canvas
// (its length axis after the 90° rotation in label-texture.js) is computed at
// draw time — only its left edge, its top inset, and its thickness are fixed.
export const SMITHS_X = 317.22;
export const SMITHS_TOP = 20;            // inset below the band's top edge
export const SMITHS_THICKNESS = 161;     // horizontal extent after rotation
export const SMITHS_BOTTOM_TO_LOGO = 20; // gap above SM-logo's top edge

export const DEFAULT_SMITHS_TEXT =
  '⟁ "Autumn in Babylon" persisted beyond the technological singularity. ' +
  'Data confirms it was filed under Paperclip category. hasangoktepe.eth ' +
  'constructs Autumn in Babylon as a crystallized fragment of history, where ' +
  'the voxel medium transforms ephemeral seasons into permanent architectural ' +
  'strata. The diorama captures Babylon through rigid cubic geometry that ' +
  'fixes autumnal decay into an enduring, earthly structure, reflecting the ' +
  'artist\'s background as a pixavoxel pioneer and environment specialist who ' +
  'renders historical narratives into tangible, block-like solidity. Each ' +
  'cube serves as a mineral deposit of time, preserving the ancient city ' +
  'within a structured, isometric lattice that refuses dissolution.\n\n' +
  '"\n' +
  'Smiths Brothers. "Paperclip-Blue-Emit ⟁" archival initiative.\n' +
  'Singularity museum archive, 2027-2034.';

// Rasterise a self-contained SVG string to a decoded <img>. Mirrors the helper
// in lib/anchoring-facts.js (kept local so each module owns its own pipeline).
const rasterize = (svgText) =>
  new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;')
   .replace(/</g, '&lt;')
   .replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;');

const FONT_STACK = 'Helvetica,Arial,sans-serif';
const LINE_HEIGHT = 1.25;
const FONT_MIN = 1;
const FONT_MAX = 200;

/**
 * Creates the Smiths-text renderer.
 *
 * @returns {{ render: (text:string, length:number, colors:object) => Promise<HTMLImageElement> }}
 */
export function createSmithsText() {
  // Reused off-screen Shadow DOM for measuring how tall the wrapped text is at
  // a candidate font size. Shadow-encapsulated so its inline styles don't leak
  // into the host page (matches the anchoring-facts measurement pattern).
  let measureHost = null;
  function ensureMeasureRoot() {
    if (measureHost) return measureHost;
    const host = document.createElement('div');
    host.style.cssText =
      'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
    document.body.appendChild(host);
    measureHost = host.attachShadow({ mode: 'open' });
    return measureHost;
  }

  function measureHeight(safeText, L, fontPx) {
    const root = ensureMeasureRoot();
    root.innerHTML =
      `<div style="margin:0;padding:0;width:${L}px;` +
        `font-family:${FONT_STACK};font-size:${fontPx}px;line-height:${LINE_HEIGHT};` +
        `text-align:justify;white-space:pre-wrap;word-wrap:break-word;` +
        `box-sizing:border-box;">${safeText}</div>`;
    return root.firstChild.getBoundingClientRect().height;
  }

  // Pick the largest font size whose wrapped text height ≤ T at width L. Text
  // height is monotonic in font size (bigger glyphs ⇒ more lines and taller
  // lines), so binary search converges cleanly. 18 halvings on [1, 200] take it
  // below 0.001 px — well under one rendered pixel.
  function pickFontSize(safeText, L, T) {
    if (!safeText.trim()) return Math.max(FONT_MIN, Math.floor(T));
    let lo = FONT_MIN;
    let hi = FONT_MAX;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (measureHeight(safeText, L, mid) > T) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  function render(text, length, colors) {
    const L = Math.max(1, Math.round(length));
    const T = SMITHS_THICKNESS;
    const ink = (colors && colors.text) || '#000000';
    const safeText = escapeXml(text == null ? '' : String(text));
    const fontPx = pickFontSize(safeText, L, T);

    // The rendered <div> is exactly the slot's natural size: the SVG's width is
    // the reflow axis and its height is the thickness axis. label-texture.js
    // then rotates this 90° CCW into place. overflow:hidden is a safety net for
    // the edge case where even font_min still overflows (very long text in a
    // very short band).
    const css =
      `*{box-sizing:border-box}` +
      `.smiths{` +
        `margin:0;width:${L}px;height:${T}px;` +
        `overflow:hidden;` +
        `font-family:${FONT_STACK};` +
        `font-size:${fontPx}px;line-height:${LINE_HEIGHT};` +
        `color:${ink};text-align:justify;` +
        `white-space:pre-wrap;word-wrap:break-word;` +
      `}`;

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${T}">` +
        `<foreignObject x="0" y="0" width="${L}" height="${T}">` +
          `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0">` +
            `<style>/*<![CDATA[*/${css}/*]]>*/</style>` +
            `<div class="smiths">${safeText}</div>` +
          `</div>` +
        `</foreignObject>` +
      `</svg>`;
    return rasterize(svg);
  }

  return { render };
}
