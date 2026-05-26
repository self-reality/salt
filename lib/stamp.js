// -----------------------------------------------------------------------------
// Stamp text injector — live <text> for the three lines beneath the stamp
// circle. Stamp.svg ships with the circle + curved "Smiths Brothers…" text
// only; the lower block (NET WT / value / unit) is added here so the value
// and unit are editable from the side panel.
//
// Font matches the anchoring-facts panel (Helvetica) and the ink uses #272727
// so recolorDecalSvg() in lib/label-texture.js maps it to the live `text`
// palette colour — same sentinel the original outlined paths used.
// -----------------------------------------------------------------------------

const X_CENTER = 156;        // Stamp.svg viewBox is 312×310; centre at 156
const HEADER_BASELINE = 242; // y baselines, matching the slots the old path filled
const VALUE_BASELINE = 268;
const UNIT_BASELINE = 295;
const INK = '#272727';       // recoloured to `text` by recolorDecalSvg

const escapeXml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

const textTag = ({ y, size, weight, content }) =>
  `<text x="${X_CENTER}" y="${y}" fill="${INK}"` +
  ` font-family="Helvetica, Arial, sans-serif" font-size="${size}"` +
  ` font-weight="${weight}" text-anchor="middle">${escapeXml(content)}</text>`;

export function injectStampText(baseSvg, value, unit) {
  const lines =
    textTag({ y: HEADER_BASELINE, size: 22, weight: 'bold', content: 'NET WT' }) +
    textTag({ y: VALUE_BASELINE,  size: 22, weight: 'bold', content: value }) +
    textTag({ y: UNIT_BASELINE,   size: 20, weight: 'bold', content: unit });
  return baseSvg.replace('</svg>', `${lines}</svg>`);
}

export const STAMP_FILE = 'Stamp.svg';
export const DEFAULT_STAMP_VALUE = '3,4 Mb';
export const DEFAULT_STAMP_UNIT = '(3430 kilobytes)';
