// -----------------------------------------------------------------------------
// Data Matrix (ECC 200) encoder.
//
// Generates a scannable Data Matrix as SVG for the live datamatrix layer in
// lib/label-texture.js — replaces the static raster Datamatrix.svg with a real
// code that encodes the side-panel input. ASCII encoding only (consecutive
// digit pairs compress to one codeword; other ASCII chars take one each).
// Picks the smallest single-block ECC 200 symbol size that fits.
//
// Implementation follows ISO/IEC 16022 — Annex H for pad randomisation and
// Annex M for module placement (utah blocks + four corner cases + bottom-right
// fixed pattern). Reed-Solomon runs in GF(256) with primitive polynomial 0x12D.
//
// SVG output: a tight matrix with a 1-module quiet zone built in, at a fixed
// DATAMATRIX_SIZE in texture units. The layer slot in lib/label-texture.js
// uses x/yTop to align the new SVG's bottom edge and horizontal centre with
// the visible matrix of the old static Datamatrix.svg, then this constant
// scales the whole thing 15% larger.
// -----------------------------------------------------------------------------

// Visible SVG dimensions in texture units. The old asset had a 96×96 inner
// matrix; spec is to render the new matrix 15% larger.
export const DATAMATRIX_SIZE = 96 * 1.15;

export const DATAMATRIX_FILE = 'Datamatrix.svg';
export const DEFAULT_DATAMATRIX_VALUE =
  '0x8f19032938E53076d000e639Cf087C268b45fDc2 (Token ID 324234)';

// ECC 200 single-block symbol sizes, smallest first.
// [rows, cols, dataBytes, eccBytes, regionsR, regionsC, regionRows, regionCols]
// regionRows/regionCols is the inner data area of each region; the full region
// is (regionRows+2) × (regionCols+2) once the L finder + dashed timing are added.
const SYMBOLS = [
  [10, 10,   3,  5, 1, 1,  8,  8],
  [12, 12,   5,  7, 1, 1, 10, 10],
  [14, 14,   8, 10, 1, 1, 12, 12],
  [16, 16,  12, 12, 1, 1, 14, 14],
  [18, 18,  18, 14, 1, 1, 16, 16],
  [20, 20,  22, 18, 1, 1, 18, 18],
  [22, 22,  30, 20, 1, 1, 20, 20],
  [24, 24,  36, 24, 1, 1, 22, 22],
  [26, 26,  44, 28, 1, 1, 24, 24],
  [32, 32,  62, 36, 2, 2, 14, 14],
  [36, 36,  86, 42, 2, 2, 16, 16],
  [40, 40, 114, 48, 2, 2, 18, 18],
  [44, 44, 144, 56, 2, 2, 20, 20],
  [48, 48, 174, 68, 2, 2, 22, 22],
];

// ----- GF(256) tables for Reed-Solomon (primitive polynomial 0x12D) -----------
const GF_EXP = new Uint16Array(512);
const GF_LOG = new Uint16Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x12D;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];

function rsGenerator(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], GF_EXP[i]);
    }
    g = next;
  }
  return g;
}

function rsCompute(data, eccLen) {
  const gen = rsGenerator(eccLen);
  const ecc = new Array(eccLen).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ ecc[0];
    ecc.shift();
    ecc.push(0);
    if (factor !== 0) {
      for (let j = 0; j < eccLen; j++) ecc[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return ecc;
}

// ----- Codeword encoding ------------------------------------------------------
const isDigit = (c) => c >= 48 && c <= 57;

function encodeAscii(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (i + 1 < text.length && isDigit(c) && isDigit(text.charCodeAt(i + 1))) {
      out.push(((c - 48) * 10 + (text.charCodeAt(i + 1) - 48)) + 130);
      i += 2;
    } else if (c < 128) {
      out.push(c + 1);
      i++;
    } else {
      // Extended ASCII via UpperShift (235). Truncates code points above 0xFF.
      out.push(235);
      out.push(((c - 128) & 0xFF) + 1);
      i++;
    }
  }
  return out;
}

function padCodewords(data, capacity) {
  if (data.length >= capacity) return data;
  data.push(129);                     // first pad codeword, fixed value
  while (data.length < capacity) {
    const t = data.length + 1;        // 1-based position of the codeword we're about to add
    const r = ((149 * t) % 253) + 1;
    let pad = 129 + r;
    if (pad > 254) pad -= 254;
    data.push(pad);
  }
  return data;
}

function pickSymbol(dataLen) {
  for (const s of SYMBOLS) if (s[2] >= dataLen) return s;
  return null;
}

// ----- ECC 200 module placement (ISO/IEC 16022 Annex M) ----------------------
// Set one bit of `byte` (1..8, MSB first) into matrix cell (r, c). Negative
// indices wrap to the opposite edge with the spec's edge-shift adjustment.
const placeBit = (m, r, c, byte, bit, rows, cols) => {
  if (r < 0) { r += rows; c += 4 - ((rows + 4) % 8); }
  if (c < 0) { c += cols; r += 4 - ((cols + 4) % 8); }
  m[r][c] = (byte >> (8 - bit)) & 1;
};

// 8-bit "utah" L-tromino block whose anchor module is at (r, c).
const placeUtah = (m, r, c, cw, rows, cols) => {
  placeBit(m, r - 2, c - 2, cw, 1, rows, cols);
  placeBit(m, r - 2, c - 1, cw, 2, rows, cols);
  placeBit(m, r - 1, c - 2, cw, 3, rows, cols);
  placeBit(m, r - 1, c - 1, cw, 4, rows, cols);
  placeBit(m, r - 1, c,     cw, 5, rows, cols);
  placeBit(m, r,     c - 2, cw, 6, rows, cols);
  placeBit(m, r,     c - 1, cw, 7, rows, cols);
  placeBit(m, r,     c,     cw, 8, rows, cols);
};

const placeCornerA = (m, cw, rows, cols) => {
  placeBit(m, rows - 1, 0,        cw, 1, rows, cols);
  placeBit(m, rows - 1, 1,        cw, 2, rows, cols);
  placeBit(m, rows - 1, 2,        cw, 3, rows, cols);
  placeBit(m, 0,        cols - 2, cw, 4, rows, cols);
  placeBit(m, 0,        cols - 1, cw, 5, rows, cols);
  placeBit(m, 1,        cols - 1, cw, 6, rows, cols);
  placeBit(m, 2,        cols - 1, cw, 7, rows, cols);
  placeBit(m, 3,        cols - 1, cw, 8, rows, cols);
};

const placeCornerB = (m, cw, rows, cols) => {
  placeBit(m, rows - 3, 0,        cw, 1, rows, cols);
  placeBit(m, rows - 2, 0,        cw, 2, rows, cols);
  placeBit(m, rows - 1, 0,        cw, 3, rows, cols);
  placeBit(m, 0,        cols - 4, cw, 4, rows, cols);
  placeBit(m, 0,        cols - 3, cw, 5, rows, cols);
  placeBit(m, 0,        cols - 2, cw, 6, rows, cols);
  placeBit(m, 0,        cols - 1, cw, 7, rows, cols);
  placeBit(m, 1,        cols - 1, cw, 8, rows, cols);
};

const placeCornerC = (m, cw, rows, cols) => {
  placeBit(m, rows - 3, 0,        cw, 1, rows, cols);
  placeBit(m, rows - 2, 0,        cw, 2, rows, cols);
  placeBit(m, rows - 1, 0,        cw, 3, rows, cols);
  placeBit(m, 0,        cols - 2, cw, 4, rows, cols);
  placeBit(m, 0,        cols - 1, cw, 5, rows, cols);
  placeBit(m, 1,        cols - 1, cw, 6, rows, cols);
  placeBit(m, 2,        cols - 1, cw, 7, rows, cols);
  placeBit(m, 3,        cols - 1, cw, 8, rows, cols);
};

const placeCornerD = (m, cw, rows, cols) => {
  placeBit(m, rows - 1, 0,        cw, 1, rows, cols);
  placeBit(m, rows - 1, cols - 1, cw, 2, rows, cols);
  placeBit(m, 0,        cols - 3, cw, 3, rows, cols);
  placeBit(m, 0,        cols - 2, cw, 4, rows, cols);
  placeBit(m, 0,        cols - 1, cw, 5, rows, cols);
  placeBit(m, 1,        cols - 3, cw, 6, rows, cols);
  placeBit(m, 1,        cols - 2, cw, 7, rows, cols);
  placeBit(m, 1,        cols - 1, cw, 8, rows, cols);
};

function placeModules(codewords, rows, cols) {
  const m = Array.from({ length: rows }, () => new Array(cols).fill(null));
  let chr = 0;
  let row = 4, col = 0;
  do {
    if (row === rows && col === 0) placeCornerA(m, codewords[chr++], rows, cols);
    else if (row === rows - 2 && col === 0 && (cols % 4 !== 0)) placeCornerB(m, codewords[chr++], rows, cols);
    else if (row === rows - 2 && col === 0 && (cols % 8 === 4)) placeCornerC(m, codewords[chr++], rows, cols);
    else if (row === rows + 4 && col === 2 && (cols % 8 === 0)) placeCornerD(m, codewords[chr++], rows, cols);

    // Sweep upward-right
    do {
      if (row < rows && col >= 0 && m[row][col] === null) {
        placeUtah(m, row, col, codewords[chr++], rows, cols);
      }
      row -= 2; col += 2;
    } while (row >= 0 && col < cols);
    row += 1; col += 3;

    // Sweep downward-left
    do {
      if (row >= 0 && col < cols && m[row][col] === null) {
        placeUtah(m, row, col, codewords[chr++], rows, cols);
      }
      row += 2; col -= 2;
    } while (row < rows && col >= 0);
    row += 3; col += 1;
  } while (row < rows || col < cols);

  // Bottom-right fixed pattern, set only if the walk didn't already touch it.
  if (m[rows - 1][cols - 1] === null) {
    m[rows - 1][cols - 1] = 1;
    m[rows - 2][cols - 2] = 1;
    m[rows - 1][cols - 2] = 0;
    m[rows - 2][cols - 1] = 0;
  }
  return m;
}

// Wrap each region's data plane with the L finder (left + bottom, solid) and
// dashed timing patterns (top + right) to form the final symbol-sized matrix.
function buildFullSymbol(dataPlane, sym) {
  const [rows, cols, , , regR, regC, rrow, rcol] = sym;
  const out = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let yReg = 0; yReg < regR; yReg++) {
    for (let xReg = 0; xReg < regC; xReg++) {
      const baseY = yReg * (rrow + 2);
      const baseX = xReg * (rcol + 2);
      // L finder: solid left column + bottom row.
      for (let i = 0; i < rrow + 2; i++) out[baseY + i][baseX] = 1;
      for (let i = 0; i < rcol + 2; i++) out[baseY + rrow + 1][baseX + i] = 1;
      // Timing: top row dark at even x (anchored to the finder's dark corner);
      // right column dark where the bottom-distance is even.
      for (let i = 0; i < rcol + 2; i++) out[baseY][baseX + i] = ((i & 1) === 0) ? 1 : 0;
      for (let i = 0; i < rrow + 2; i++) out[baseY + i][baseX + rcol + 1] = (((rrow + 1 - i) & 1) === 0) ? 1 : 0;
      // Data cells, copied from the placement plane.
      for (let dy = 0; dy < rrow; dy++) {
        for (let dx = 0; dx < rcol; dx++) {
          out[baseY + 1 + dy][baseX + 1 + dx] = dataPlane[yReg * rrow + dy][xReg * rcol + dx];
        }
      }
    }
  }
  return out;
}

function errorSvg(message) {
  const W = DATAMATRIX_SIZE;
  return (
    `<svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${W}" height="${W}" fill="white"/>` +
      `<text x="${W / 2}" y="${W / 2}" fill="#b00020"` +
        ` font-family="Helvetica, Arial, sans-serif" font-size="10"` +
        ` text-anchor="middle" dy=".35em">${message}</text>` +
    `</svg>`
  );
}

/**
 * Encode `value` as a Data Matrix (ECC 200) and return SVG text. The output is
 * a square DATAMATRIX_SIZE × DATAMATRIX_SIZE SVG with a 1-module quiet zone.
 * Returns an error-placeholder SVG (same dimensions) for empty input or
 * inputs that don't fit the largest supported symbol.
 */
export function generateDatamatrixSvg(value) {
  const text = String(value ?? '');
  if (!text) return errorSvg('Empty');

  const data = encodeAscii(text);
  const sym = pickSymbol(data.length);
  if (!sym) return errorSvg('Too long');

  const [rows, cols, dataBytes, eccBytes, regR, regC] = sym;
  padCodewords(data, dataBytes);
  const ecc = rsCompute(data, eccBytes);
  const all = data.concat(ecc);

  // Placement plane covers all regions' data area as one continuous grid;
  // buildFullSymbol then splits it back into regions and frames each one.
  const dataPlane = placeModules(all, rows - 2 * regR, cols - 2 * regC);
  const matrix = buildFullSymbol(dataPlane, sym);

  // Render: full-area white background, then dark modules. A 1-module quiet
  // zone wraps the matrix so scanners can find the finder pattern even when
  // the SVG sits flush against neighbouring decal elements.
  const W = DATAMATRIX_SIZE;
  const cellsAcross = cols + 2;             // matrix + 1 quiet module per side
  const cell = W / cellsAcross;
  const off = cell;                          // top-left of matrix in SVG units

  const rects = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (matrix[y][x]) {
        rects.push(
          `<rect x="${(off + x * cell).toFixed(4)}" y="${(off + y * cell).toFixed(4)}"` +
          ` width="${cell.toFixed(4)}" height="${cell.toFixed(4)}" fill="black"/>`,
        );
      }
    }
  }
  return (
    `<svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" fill="none"` +
    ` xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${W}" height="${W}" fill="white"/>` +
      rects.join('') +
    `</svg>`
  );
}
