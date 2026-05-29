// -----------------------------------------------------------------------------
// Smiths text block — the long-form description that wraps the can vertically.
//
// Replaces the old "Smiths.svg" outlined-paths layer with an editable passage.
// Like lib/anchoring-facts.js, this renders with PURE Canvas 2D — it word-wraps
// and paints the text itself rather than going through an SVG <foreignObject>.
// That matters: an <img> whose source SVG contains <foreignObject> taints any
// canvas it's drawImaged into (a fixed Chromium security rule), and a tainted
// canvas can't be uploaded as a WebGL texture (texImage2D throws). The dev page
// never noticed because it only displays the canvas; the 3D scenes upload it.
//
// The natural-orientation block is rendered length × thickness; label-texture.js
// owns the 90° rotation and the placement. The block runs from 20 px below the
// band's top down to 20 px above the SM-logo's top edge, so its *length* (the
// reflow axis) grows with band height while its *thickness* stays fixed at
// 161 px. The font size is picked per render to fill that variable area.
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
  'Smiths Brothers. "Paperclip-Blue-Emit ⟁" archival initiative.\n' +
  'Singularity museum archive, 2027-2034.';

const FONT_STACK = 'Helvetica,Arial,sans-serif';
const LINE_HEIGHT = 1.25;
const FONT_MIN = 1;
const FONT_MAX = 200;

/**
 * Creates the Smiths-text renderer.
 *
 * @returns {{ render: (text:string, length:number, colors:object) => Promise<HTMLCanvasElement> }}
 */
export function createSmithsText() {
  // One reusable context for measuring (font metrics) — separate from the
  // per-render output canvas so measurement never disturbs painted state.
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');

  // Greedily wrap `text` to `maxW` at the given font size. Honors explicit
  // newlines as hard breaks (a blank line for "\n\n"), wraps on whitespace, and
  // hard-breaks any single word wider than the column (word-wrap:break-word).
  // Returns an array of lines: { words: [{ t, w }], lastInPara: bool }.
  function layout(ctx, text, maxW, fontPx) {
    ctx.font = `${fontPx}px ${FONT_STACK}`;
    const spaceW = ctx.measureText(' ').width;
    const lines = [];

    for (const para of String(text).split('\n')) {
      const tokens = para.split(/\s+/).filter(Boolean);
      if (!tokens.length) { lines.push({ words: [], lastInPara: true }); continue; }

      let cur = [];
      let curW = 0;
      const pushWord = (t) => {
        const w = ctx.measureText(t).width;
        const add = (cur.length ? spaceW : 0) + w;
        if (cur.length && curW + add > maxW) {
          lines.push({ words: cur, lastInPara: false });
          cur = [{ t, w }];
          curW = w;
        } else {
          cur.push({ t, w });
          curW += add;
        }
      };

      for (const token of tokens) {
        if (ctx.measureText(token).width <= maxW) { pushWord(token); continue; }
        // Overlong word: flush the current line, then break the word into
        // column-width chunks so it never overflows.
        if (cur.length) { lines.push({ words: cur, lastInPara: false }); cur = []; curW = 0; }
        let chunk = '';
        for (const ch of token) {
          if (chunk && ctx.measureText(chunk + ch).width > maxW) {
            lines.push({ words: [{ t: chunk, w: ctx.measureText(chunk).width }], lastInPara: false });
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        if (chunk) pushWord(chunk);
      }
      lines.push({ words: cur, lastInPara: true });
    }
    return lines;
  }

  // Largest font size whose wrapped block height ≤ T at width L. Block height is
  // monotonic in font size, so binary search converges; 18 halvings on [1, 200]
  // land below 0.001 px. Mirrors the old SVG sizer.
  function pickFontSize(text, L, T) {
    if (!String(text).trim()) return Math.max(FONT_MIN, Math.floor(T));
    let lo = FONT_MIN;
    let hi = FONT_MAX;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const h = layout(measureCtx, text, L, mid).length * mid * LINE_HEIGHT;
      if (h > T) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  function render(text, length, colors) {
    const L = Math.max(1, Math.round(length));
    const T = SMITHS_THICKNESS;
    const ink = (colors && colors.text) || '#000000';
    const str = text == null ? '' : String(text);
    const fontPx = pickFontSize(str, L, T);

    // The output canvas is exactly the slot's natural size (width = reflow axis,
    // height = thickness); label-texture.js rotates it 90° CCW into place.
    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = T;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = ink;
    ctx.textBaseline = 'middle'; // centre glyphs in the line box (≈ CSS line-height)

    const lines = layout(ctx, str, L, fontPx);
    const lineH = fontPx * LINE_HEIGHT;
    const spaceW = ctx.measureText(' ').width;

    for (let i = 0; i < lines.length; i++) {
      const { words, lastInPara } = lines[i];
      if (!words.length) continue;
      const y = (i + 0.5) * lineH;
      // Justify interior lines (text-align:justify): spread the slack across the
      // inter-word gaps. The last line of a paragraph stays left-aligned, as do
      // single-word lines.
      const sumW = words.reduce((a, wd) => a + wd.w, 0);
      const gaps = words.length - 1;
      const gap = (!lastInPara && gaps > 0) ? (L - sumW) / gaps : spaceW;
      let x = 0;
      for (const wd of words) {
        ctx.fillText(wd.t, x, y);
        x += wd.w + gap;
      }
    }
    return Promise.resolve(canvas);
  }

  return { render };
}
