// -----------------------------------------------------------------------------
// Smiths text block — the long-form description that wraps the can vertically.
//
// Replaces the old "Smiths.svg" outlined-paths layer with an editable passage.
// Same approach as lib/anchoring-facts.js: an HTML block rendered into an SVG
// <foreignObject> and rasterised, so the browser does the typesetting and the
// copy reflows as the side-panel text changes. The natural-orientation block is
// rendered length × thickness (718 × 151 at REF_HEIGHT, matching the original
// SVG footprint); label-texture.js owns the 90° rotation and placement.
// -----------------------------------------------------------------------------

// Texture-space placement of the Smiths slot, matching the old "Smiths.svg":
// 151 wide × 718 tall, anchored 40.73 px below the band's top at x=317.22.
export const SMITHS_X = 317.22;
export const SMITHS_TOP = 40.73;
export const SMITHS_LENGTH = 718;
export const SMITHS_THICKNESS = 151;

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

/**
 * Creates the Smiths-text renderer.
 *
 * @returns {{ render: (text:string, colors:object) => Promise<HTMLImageElement> }}
 */
export function createSmithsText() {
  function render(text, colors) {
    const L = SMITHS_LENGTH;
    const T = SMITHS_THICKNESS;
    const ink = (colors && colors.text) || '#000000';
    const body = escapeXml(text == null ? '' : String(text));

    // foreignObject body: a single block with white-space:pre-wrap so explicit
    // newlines become paragraph breaks and long lines wrap on width. The CSS is
    // embedded inside the SVG's XML, so it's wrapped in CDATA (matching the
    // anchoring-facts pattern) to keep any stray `<` from breaking parsing.
    const css =
      `*{box-sizing:border-box}` +
      `.smiths{` +
        `margin:0;width:${L}px;height:${T}px;` +
        `padding:4px;overflow:hidden;` +
        `font-family:Helvetica,Arial,sans-serif;` +
        `font-size:10px;line-height:1.25;` +
        `color:${ink};text-align:justify;` +
        `white-space:pre-wrap;word-wrap:break-word;` +
      `}`;

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${T}">` +
        `<foreignObject x="0" y="0" width="${L}" height="${T}">` +
          `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0">` +
            `<style>/*<![CDATA[*/${css}/*]]>*/</style>` +
            `<div class="smiths">${body}</div>` +
          `</div>` +
        `</foreignObject>` +
      `</svg>`;
    return rasterize(svg);
  }
  return { render };
}
