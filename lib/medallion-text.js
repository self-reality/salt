// -----------------------------------------------------------------------------
// Medallion text injector — replaces Circle.svg's two baked-in white text rings
// (the artwork title baked across the top of the SALT disc and the artist
// username baked across the bottom) with live <text> + <textPath>, so both
// strings come from the side panel.
//
// Geometry: the central disc sits at (974.138, 974.137) in the 1952×1912
// viewBox with r=238. The original baked glyphs occupy a radial band of about
// r=113..211 — the top arc carrying the title and the bottom arc carrying the
// username, the two meeting around the 7- and 5-o'clock positions so they read
// as one continuous ring.
//
// Outer text follows a top arc going LEFT→RIGHT over the top (sweep=1,
// large-arc=1) so glyphs grow outward from the centre and read upright at the
// top. Inner text follows a bottom arc going RIGHT→LEFT along the bottom
// (sweep=1, large-arc=0) so glyphs grow inward toward the centre and read
// upright at the bottom.
//
// Both <text> elements stay fill="white"; label-texture.js's recolorWhiteInk
// pass flips the whites to black whenever the disc's outline ink gets too
// pale, the same way it handled the original baked glyphs.
//
// Font: Pacifico — the same data URL the side-text labels load (via
// loadPacificoDataUrl in lib/side-text.js). SVGs rasterised through a Blob
// URL → <img> pipeline don't see the page's loaded webfonts, so the font has
// to be embedded into each SVG as an @font-face data URL. label.js threads
// the data URL in once it's resolved; without it we fall back to system
// cursive (still readable, just not the design face).
// -----------------------------------------------------------------------------

export const DEFAULT_MEDALLION_OUTER_TEXT = '“Float safsOasfn”';
export const DEFAULT_MEDALLION_INNER_TEXT = 'oak_arrow';

const CX = 974.138;
const CY = 974.137;

// Baseline radii for the two arcs. Outer text grows outward from its baseline,
// so its baseline sits at the inner edge of the original glyph band (≈113).
// Inner text grows inward from its baseline, so its baseline sits at the outer
// edge of that band (≈204). With these, the two text bodies overlap radially
// in the same ring — the visual "single circle of text" the design reads as.
export const DEFAULT_OUTER_BASELINE_R = 113;
export const DEFAULT_INNER_BASELINE_R = 204;

// Font sizes tuned so Pacifico's ascender (it has an outsized cap, ~1.1× its
// em) fills the band gap between the disc edge and the inner ornament without
// crowding the meet points. textLength below also enforces the arc fit, so
// long strings still wrap to the band cleanly.
export const DEFAULT_OUTER_FONT_SIZE = 80;
export const DEFAULT_INNER_FONT_SIZE = 70;

// Both arcs are anchored at the same two SVG-angle points (30° and 150°), the
// lower-right and lower-left of every concentric circle. The outer arc takes
// the long way over the top (240°); the inner arc takes the short way under
// the bottom (120°). Sharing the endpoints is what makes the two texts visually
// meet at the 7- and 5-o'clock positions.
const ARC_LL_SVG_ANGLE = (150 * Math.PI) / 180;
const ARC_LR_SVG_ANGLE = (30 * Math.PI) / 180;
const OUTER_ARC_RADIANS = (4 * Math.PI) / 3;  // 240°
const INNER_ARC_RADIANS = (2 * Math.PI) / 3;  // 120°

const escapeXml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Arc endpoints on a circle of radius R at the two shared SVG-angle anchors.
function arcEndpoints(R) {
  return {
    ll: [CX + R * Math.cos(ARC_LL_SVG_ANGLE), CY + R * Math.sin(ARC_LL_SVG_ANGLE)],
    lr: [CX + R * Math.cos(ARC_LR_SVG_ANGLE), CY + R * Math.sin(ARC_LR_SVG_ANGLE)],
  };
}

function outerArcPath(r) {
  const { ll, lr } = arcEndpoints(r);
  // Lower-left → over the top → lower-right; large-arc=1, sweep=1.
  return `M ${ll[0].toFixed(3)} ${ll[1].toFixed(3)} ` +
    `A ${r} ${r} 0 1 1 ` +
    `${lr[0].toFixed(3)} ${lr[1].toFixed(3)}`;
}

function innerArcPath(r) {
  const { ll, lr } = arcEndpoints(r);
  // Lower-right → along the bottom → lower-left; large-arc=0, sweep=1.
  return `M ${lr[0].toFixed(3)} ${lr[1].toFixed(3)} ` +
    `A ${r} ${r} 0 0 1 ` +
    `${ll[0].toFixed(3)} ${ll[1].toFixed(3)}`;
}

// The two baked-in text rings are the only <path fill="white"> elements in
// Circle.svg — the avatar slot uses a <rect> with a pattern fill, and the
// mask block keeps its whites intact. Match path elements specifically so the
// avatar's empty-disc fallback (which adds fill="white" to that rect) is
// preserved.
const WHITE_TEXT_PATH_RE = /<path\b[^>]*\bfill="white"[^>]*\/>/g;

/**
 * Returns Circle.svg with the two baked-in white text rings stripped and
 * live text rendered on concentric arcs in their place.
 *
 * @param {string} baseSvg
 * @param {string} outerText
 * @param {string} innerText
 * @param {string|null} [fontDataUrl] - Pacifico woff2 data URL (see
 *   loadPacificoDataUrl in lib/side-text.js). Null falls back to system cursive.
 * @param {object} [opts] - Per-arc geometry overrides. Any field omitted falls
 *   back to the DEFAULT_* exports above.
 * @param {number} [opts.outerFontSize]
 * @param {number} [opts.innerFontSize]
 * @param {number} [opts.outerBaselineR]
 * @param {number} [opts.innerBaselineR]
 */
export function injectMedallionText(baseSvg, outerText, innerText, fontDataUrl, opts = {}) {
  const outerFontSize = opts.outerFontSize ?? DEFAULT_OUTER_FONT_SIZE;
  const innerFontSize = opts.innerFontSize ?? DEFAULT_INNER_FONT_SIZE;
  const outerBaselineR = opts.outerBaselineR ?? DEFAULT_OUTER_BASELINE_R;
  const innerBaselineR = opts.innerBaselineR ?? DEFAULT_INNER_BASELINE_R;
  const stripped = baseSvg.replace(WHITE_TEXT_PATH_RE, '');
  const outerArcLen = outerBaselineR * OUTER_ARC_RADIANS;
  const innerArcLen = innerBaselineR * INNER_ARC_RADIANS;
  // Keep a small margin in from each arc end so the text doesn't bleed into
  // the meeting points where the top arc hands off to the bottom arc.
  const outerTextLen = (outerArcLen * 0.94).toFixed(2);
  const innerTextLen = (innerArcLen * 0.94).toFixed(2);
  // Pacifico has to ride in the SVG itself: rasterising through Blob URL →
  // <img> cuts off external font fetches, and document.fonts on the host page
  // isn't visible to that detached document.
  const fontFace = fontDataUrl
    ? `<style>@font-face{font-family:'Pacifico';` +
      `src:url(${fontDataUrl}) format('woff2');font-display:block;}</style>`
    : '';
  const injection =
    `<defs>` +
      `<path id="medallion-outer-arc" d="${outerArcPath(outerBaselineR)}"/>` +
      `<path id="medallion-inner-arc" d="${innerArcPath(innerBaselineR)}"/>` +
    `</defs>` +
    fontFace +
    `<text fill="white" font-family="Pacifico, cursive"` +
      ` font-size="${outerFontSize}">` +
      `<textPath href="#medallion-outer-arc" xlink:href="#medallion-outer-arc" startOffset="50%"` +
        ` text-anchor="middle" textLength="${outerTextLen}"` +
        ` lengthAdjust="spacingAndGlyphs">` +
        escapeXml(outerText) +
      `</textPath>` +
    `</text>` +
    `<text fill="white" font-family="Pacifico, cursive"` +
      ` font-size="${innerFontSize}">` +
      `<textPath href="#medallion-inner-arc" xlink:href="#medallion-inner-arc" startOffset="50%"` +
        ` text-anchor="middle" textLength="${innerTextLen}"` +
        ` lengthAdjust="spacingAndGlyphs">` +
        escapeXml(innerText) +
      `</textPath>` +
    `</text>`;
  return stripped.replace(/<\/svg>\s*$/, `${injection}</svg>`);
}
