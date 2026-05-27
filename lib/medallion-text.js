// -----------------------------------------------------------------------------
// Medallion text injector — replaces Circle.svg's two baked-in white text rings
// (the artwork title baked across the top of the SALT disc and the artist
// username baked across the bottom) with live <text> + <textPath>, so both
// strings come from the side panel.
//
// Layout: title and author share one baseline circle of radius `radius`. The
// title is centred at 12 o'clock; the author is centred at 6 o'clock; the two
// arcs each occupy exactly the natural rendered length of their text, leaving
// matching gaps on the left (~9 o'clock) and right (~3 o'clock) sides where
// the rings end. Font size is computed by the caller (label.js measures text
// width via canvas) to fit both strings on the shared circumference; the
// caller passes the resulting fontSize plus per-arc arc lengths in.
//
// Geometry: the central disc sits at (974.138, 974.137) in the 1952×1912
// viewBox with r=238. With dominant-baseline="middle" below, the radius is
// the *visual centre* of each text ring — glyphs grow symmetrically inward
// and outward from this circle.
//
// Arc direction: the title arc goes clockwise (on screen) through 12 o'clock
// from the upper-left to the upper-right — glyph tops point up on screen.
// The author arc goes COUNTER-clockwise through 6 o'clock from the lower-left
// to the lower-right, so glyphs at the bottom also read upright on screen
// (their tops point up, away from the disc edge). The classic upside-down
// medallion convention is what we don't want here.
//
// Font: Pacifico — embedded as an @font-face data URL because SVGs rasterised
// through a Blob URL → <img> pipeline can't see the page's loaded webfonts.
// label.js *also* registers Pacifico with document.fonts so canvas measureText
// can size the strings accurately; without that, measureText falls back to a
// system cursive face whose metrics don't match the Pacifico we'll render.
// -----------------------------------------------------------------------------

export const DEFAULT_MEDALLION_OUTER_TEXT = '“Float safsOasfn”';
export const DEFAULT_MEDALLION_INNER_TEXT = 'oak_arrow';

const CX = 974.138;
const CY = 974.137;

// Shared baseline circle for both rings.
export const DEFAULT_MEDALLION_RADIUS = 150;

// Cap on the auto-computed font size: the caller may shrink below this to fit
// long strings, but never grows past it.
export const MAX_MEDALLION_FONT_SIZE = 80;

// Math-angle convention (cos/sin with SVG's y-axis pointing down):
//   0       =  3 o'clock
//   π/2     =  6 o'clock (bottom on screen, because +y is down)
//   π       =  9 o'clock
//   -π/2    = 12 o'clock (top on screen)
// Sweep=1 in SVG = increasing math angle = clockwise on screen.
const TITLE_CENTRE_RAD = -Math.PI / 2;
const AUTHOR_CENTRE_RAD = Math.PI / 2;

const escapeXml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Build a textPath arc on a circle of radius R, centred at math angle
// centreRad, spanning spanRad radians. Sweep=1 in SVG = increasing math angle
// = clockwise on screen; sweep=0 = counter-clockwise. The path always passes
// through centreRad: for sweep=1 it runs (centre − span/2) → centre →
// (centre + span/2); for sweep=0 the endpoints are swapped so traversal still
// goes through the centre. large-arc flips when the span exceeds a semicircle.
//
// Direction matters for glyph orientation: SVG textPath places each glyph
// with its top on the LEFT side of the path's direction of travel. To get
// upright-on-screen glyphs at 6 o'clock, the path direction at 6 o'clock has
// to be +x (rightward), which means traversing counter-clockwise (sweep=0)
// from lower-left through 6 to lower-right. The same convention at 12 o'clock
// just falls out of sweep=1.
function arcPath(R, centreRad, spanRad, sweep) {
  const half = spanRad / 2;
  const a1 = sweep === 1 ? centreRad - half : centreRad + half;
  const a2 = sweep === 1 ? centreRad + half : centreRad - half;
  const x1 = CX + R * Math.cos(a1);
  const y1 = CY + R * Math.sin(a1);
  const x2 = CX + R * Math.cos(a2);
  const y2 = CY + R * Math.sin(a2);
  const large = spanRad > Math.PI ? 1 : 0;
  return `M ${x1.toFixed(3)} ${y1.toFixed(3)} ` +
    `A ${R} ${R} 0 ${large} ${sweep} ${x2.toFixed(3)} ${y2.toFixed(3)}`;
}

// The two baked-in text rings are the only <path fill="white"> elements in
// Circle.svg — the avatar slot uses a <rect> with a pattern fill, and the
// mask block keeps its whites intact. Match path elements specifically so the
// avatar's empty-disc fallback (which adds fill="white" to that rect) is
// preserved.
const WHITE_TEXT_PATH_RE = /<path\b[^>]*\bfill="white"[^>]*\/>/g;

/**
 * Returns Circle.svg with the two baked-in white text rings stripped and
 * live text rendered on concentric arcs of one shared circle in their place.
 *
 * @param {string} baseSvg
 * @param {string} outerText - Title, rendered along the top half of the circle.
 * @param {string} innerText - Author, rendered along the bottom half.
 * @param {string|null} [fontDataUrl] - Pacifico woff2 data URL (see
 *   loadPacificoDataUrl in lib/side-text.js). Null falls back to system cursive.
 * @param {object} [opts]
 * @param {number} [opts.radius] - Shared baseline radius (visual centre of the
 *   text ring).
 * @param {number} [opts.fontSize] - Shared font size for both texts. Caller
 *   computes this to fit both strings on the circumference, capped at
 *   MAX_MEDALLION_FONT_SIZE.
 * @param {number} [opts.titleArcLen] - Rendered arc length of the title at the
 *   chosen font size, used to size the title arc to the text.
 * @param {number} [opts.authorArcLen] - Same, for the author.
 * @param {boolean} [opts.showGuides] - When true, also renders the shared
 *   baseline circle as a magenta dashed stroke so the geometry is visible.
 */
export function injectMedallionText(baseSvg, outerText, innerText, fontDataUrl, opts = {}) {
  const radius = opts.radius ?? DEFAULT_MEDALLION_RADIUS;
  const fontSize = opts.fontSize ?? MAX_MEDALLION_FONT_SIZE;
  const titleArcLen = Math.max(0, opts.titleArcLen ?? 0);
  const authorArcLen = Math.max(0, opts.authorArcLen ?? 0);
  const showGuides = !!opts.showGuides;

  // Arc spans (in radians) are arc length / radius. An empty or whitespace
  // string yields zero span — skip emitting the <textPath> in that case so
  // the path's start==end degeneracy doesn't render as a full circle on some
  // user agents.
  const titleSpan = titleArcLen / radius;
  const authorSpan = authorArcLen / radius;
  const hasTitle = outerText && titleSpan > 1e-4;
  const hasAuthor = innerText && authorSpan > 1e-4;

  const stripped = baseSvg.replace(WHITE_TEXT_PATH_RE, '');

  // Pacifico has to ride in the SVG itself: rasterising through Blob URL →
  // <img> cuts off external font fetches, and document.fonts on the host page
  // isn't visible to that detached document.
  const fontFace = fontDataUrl
    ? `<style>@font-face{font-family:'Pacifico';` +
      `src:url(${fontDataUrl}) format('woff2');font-display:block;}</style>`
    : '';

  // Dev-only overlay: a single dashed magenta circle on the shared baseline so
  // the geometry the radius slider controls is visible at a glance.
  const guides = showGuides
    ? `<circle cx="${CX}" cy="${CY}" r="${radius}" fill="none" ` +
        `stroke="#ff00ff" stroke-width="2" stroke-dasharray="6 4"/>`
    : '';

  const defs =
    `<defs>` +
      (hasTitle ? `<path id="medallion-outer-arc" d="${arcPath(radius, TITLE_CENTRE_RAD, titleSpan, 1)}"/>` : '') +
      (hasAuthor ? `<path id="medallion-inner-arc" d="${arcPath(radius, AUTHOR_CENTRE_RAD, authorSpan, 0)}"/>` : '') +
    `</defs>`;

  const titleEl = hasTitle
    ? `<text fill="white" font-family="Pacifico, cursive"` +
        ` font-size="${fontSize}" dominant-baseline="middle">` +
        `<textPath href="#medallion-outer-arc" xlink:href="#medallion-outer-arc"` +
          ` startOffset="50%" text-anchor="middle">` +
          escapeXml(outerText) +
        `</textPath>` +
      `</text>`
    : '';

  const authorEl = hasAuthor
    ? `<text fill="white" font-family="Pacifico, cursive"` +
        ` font-size="${fontSize}" dominant-baseline="middle">` +
        `<textPath href="#medallion-inner-arc" xlink:href="#medallion-inner-arc"` +
          ` startOffset="50%" text-anchor="middle">` +
          escapeXml(innerText) +
        `</textPath>` +
      `</text>`
    : '';

  const injection = defs + fontFace + guides + titleEl + authorEl;
  return stripped.replace(/<\/svg>\s*$/, `${injection}</svg>`);
}
