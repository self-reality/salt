// -----------------------------------------------------------------------------
// Code 128 (Set B) barcode generator.
//
// Produces an SVG string sized to the same 316×464 frame the original
// Barcode.svg used, so it drops into the decal in place of the static file.
//
// The decal places this image without further rotation, but the *natural*
// orientation of a product barcode is bars-vertical / digits-below, and the
// original asset was an un-rotated barcode PNG dropped into a rect with
// `transform="rotate(-90 84 464)"`. Mirroring that here: the bars are drawn
// horizontally (stacked along Y) in the LEFT portion of the visible rect, and
// the digits sit in a narrow RIGHT strip, rotated -90° so they read
// bottom-to-top alongside the bars — exactly where the PNG's human-readable
// row ended up after that transform. Font is Helvetica to match the
// anchoring-facts panel.
//
// Input is restricted to Code Set B (printable ASCII 32–126); anything else
// renders an error placeholder.
// -----------------------------------------------------------------------------

// 11-module bar/space patterns for values 0..102, plus 11-module Start codes
// (103/104/105) and the special 13-module Stop (106).
const PATTERNS = {
  0:'11011001100',  1:'11001101100',  2:'11001100110',  3:'10010011000',  4:'10010001100',
  5:'10001001100',  6:'10011001000',  7:'10011000100',  8:'10001100100',  9:'11001001000',
  10:'11001000100', 11:'11000100100', 12:'10110011100', 13:'10011011100', 14:'10011001110',
  15:'10111001100', 16:'10011101100', 17:'10011100110', 18:'11001110010', 19:'11001011100',
  20:'11001001110', 21:'11011100100', 22:'11001110100', 23:'11101101110', 24:'11101001100',
  25:'11100101100', 26:'11100100110', 27:'11101100100', 28:'11100110100', 29:'11100110010',
  30:'11011011000', 31:'11011000110', 32:'11000110110', 33:'10100011000', 34:'10001011000',
  35:'10001000110', 36:'10110001000', 37:'10001101000', 38:'10001100010', 39:'11010001000',
  40:'11000101000', 41:'11000100010', 42:'10110111000', 43:'10110001110', 44:'10001101110',
  45:'10111011000', 46:'10111000110', 47:'10001110110', 48:'11101110110', 49:'11010001110',
  50:'11000101110', 51:'11011101000', 52:'11011100010', 53:'11011101110', 54:'11101011000',
  55:'11101000110', 56:'11100010110', 57:'11101101000', 58:'11101100010', 59:'11100011010',
  60:'11101111010', 61:'11001000010', 62:'11110001010', 63:'10100110000', 64:'10100001100',
  65:'10010110000', 66:'10010000110', 67:'10000101100', 68:'10000100110', 69:'10110010000',
  70:'10110000100', 71:'10011010000', 72:'10011000010', 73:'10000110100', 74:'10000110010',
  75:'11000010010', 76:'11001010000', 77:'11110111010', 78:'11000010100', 79:'10001111010',
  80:'10100111100', 81:'10010111100', 82:'10010011110', 83:'10111100100', 84:'10011110100',
  85:'10011110010', 86:'11110100100', 87:'11110010100', 88:'11110010010', 89:'11011011110',
  90:'11011110110', 91:'11110110110', 92:'10101111000', 93:'10100011110', 94:'10001011110',
  95:'10111101000', 96:'10111100010', 97:'11110101000', 98:'11110100010', 99:'10111011110',
  100:'10111101110', 101:'11101011110', 102:'11110101110',
  104:'11010010000',   // Start B
  106:'1100011101011', // Stop (13 modules)
};

// Frame matches the original Barcode.svg so the layer placement in
// lib/label-texture.js needs no change.
const W = 316;
const H = 464;
const AREA_X = 84;             // visible barcode rect left edge in the SVG
const AREA_W = W - AREA_X;     // 232 — full visible rect width
const QUIET_MODULES = 10;      // quiet zone on each side of the bars
// Right-side strip reserved for the digits — matches the relative footprint
// the human-readable row occupied in the original 424×212 PNG (~17%).
const DIGITS_STRIP_W = 40;
const BARS_W = AREA_W - DIGITS_STRIP_W;  // 192 — bars run from x=84 to x=276

const escapeXml = (s) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));

function errorSvg(message) {
  return (
    `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="${AREA_X}" y="0" width="${AREA_W}" height="${H}" fill="white"/>` +
      `<text x="${AREA_X + AREA_W / 2}" y="${H / 2}" fill="#b00020"` +
        ` font-family="Helvetica, Arial, sans-serif" font-size="18"` +
        ` text-anchor="middle">${escapeXml(message)}</text>` +
    `</svg>`
  );
}

/**
 * Encode `value` as a Code 128 Set B barcode and return SVG text.
 * Returns an error-placeholder SVG (same dimensions) for empty input or
 * characters outside printable ASCII (32–126).
 */
export function generateBarcodeSvg(value) {
  const text = String(value ?? '');
  if (!text) return errorSvg('Empty barcode');

  const codes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 32 || code > 126) return errorSvg(`Unsupported "${ch}"`);
    codes.push(code - 32);
  }

  // Sequence: Start B, data, mod-103 checksum, Stop.
  let checksum = 104;
  codes.forEach((v, i) => { checksum += v * (i + 1); });
  checksum %= 103;
  const sequence = [104, ...codes, checksum, 106];

  const bits = sequence.map((v) => PATTERNS[v]).join('');
  const totalModules = QUIET_MODULES * 2 + bits.length;

  // Bars run along the full SVG height (stacked along y), occupying the left
  // BARS_W of the visible rect; module size is the per-row thickness.
  const m = H / totalModules;

  const rects = [];
  for (let i = 0; i < bits.length; ) {
    if (bits[i] === '1') {
      let j = i + 1;
      while (j < bits.length && bits[j] === '1') j++;
      const y = (QUIET_MODULES + i) * m;
      const h = (j - i) * m;
      rects.push(
        `<rect x="${AREA_X}" y="${y.toFixed(4)}" width="${BARS_W}"` +
        ` height="${h.toFixed(4)}" fill="black"/>`,
      );
      i = j;
    } else {
      i++;
    }
  }

  // Digits sit in the right strip, rotated -90° about their centre so they
  // read bottom-to-top alongside the bars. A <g translate+rotate> wrapper
  // puts the local origin at the strip's centre; the text then uses
  // dy=".35em" to centre the cap-height on that origin (more reliable across
  // SVG renderers than dominant-baseline="central"). No textLength — at this
  // font size Code 128 values up to ~24 characters fit naturally in the
  // 464px SVG height, and skipping the stretch keeps the glyphs proportional
  // regardless of value length.
  const fontSize = 32;
  const digitsCX = AREA_X + BARS_W + DIGITS_STRIP_W / 2;
  const digitsCY = H / 2;

  return (
    `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none"` +
    ` xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="${AREA_X}" y="0" width="${AREA_W}" height="${H}" fill="white"/>` +
      rects.join('') +
      `<g transform="translate(${digitsCX} ${digitsCY}) rotate(-90)">` +
        `<text x="0" y="0" dy=".35em"` +
          ` fill="black" font-family="Helvetica, Arial, sans-serif"` +
          ` font-size="${fontSize}" font-weight="bold" text-anchor="middle">` +
          escapeXml(text) +
        `</text>` +
      `</g>` +
    `</svg>`
  );
}

export const DEFAULT_BARCODE_VALUE = '2029-135531';
