// -----------------------------------------------------------------------------
// Anchoring-facts table — pure 2D canvas renderer.
//
// Replaces the earlier HTML-via-<foreignObject> path. That path worked for the
// standalone dev page, but Chromium taints any canvas it's drawImaged into — a
// fixed security rule — and a tainted canvas can't be uploaded as a WebGL
// texture via texImage2D. This renderer never touches foreignObject: it lays
// out the table itself and paints with Canvas 2D primitives, so the result
// drops straight into label-texture.js's compositing canvas and (eventually)
// into the 3D scenes' textures.
//
// The Figma source is node 2062:1176 ("Latent-space crawler"): a nutrition-
// facts-style sticker, fixed-width title column on the left, stretching details
// column on the right. On the can it's rotated 90° (it wraps the can), so its
// natural-orientation *width* is the reflow axis ("length", maps to band
// height) and its natural-orientation *height* is the across-can axis
// ("thickness", maps to the fixed slot width). This module renders un-rotated;
// label-texture.js owns the rotation and placement.
//
// All design dimensions are multiples of one base unit `u`. `u` is calibrated
// once at load(): we probe the table's natural height at REF_LENGTH and pick
// `u` so it equals THICKNESS. The downstream draw step then fits the actual
// pixel thickness to the slot anyway, so calibration only matters at REF_LENGTH
// (where it makes the table render 1:1) — at other lengths the natural height
// drifts a few px and is squashed/stretched into the slot.
// -----------------------------------------------------------------------------

// Texture-space placement — unchanged from the previous version so label-texture.js's
// rotation/positioning math keeps working.
export const ANCHORING_X = 1856;
export const ANCHORING_THICKNESS = 416;
export const ANCHORING_REF_LENGTH = 1033;
export const ANCHORING_PAD = 20;

const LOGO_FILE = 'SM-logo-600-px.png';
const FONT_FAMILY = 'Helvetica, Arial, sans-serif';
const INK = '#000000';
const PAPER = '#ffffff';

// ---- Design constants (multiples of `u`) ----
const FRAME_BORDER_U = 1;
const COL_TITLE_WIDTH_U = 56.3;
const COL_PADDING_U = 3;
const SECTION_GAP_U = 1.5;

const TITLE_FONT_U = 7;
const DIV_MEDIUM_U = 1;
const DIV_THIN_U = 0.25;
const DIV_BIG_U = 2.5;

const SERVING_FONT_U = 3;
const SERVING_GAP_U = 0.5;

const BOOST_FONT_U = 2.5;
const BOOST_SUB_FONT_U = 1.6;
const COMPONENTS_LABEL_FONT_U = 4;
const COMPONENTS_VALUE_FONT_U = 6;
const METRICS_GAP_U = 1;

const LOGO_SIZE_U = 11;
const FOOTER_GAP_U = 0.5;
const FOOTER_PADDING_Y_U = 0.75;
const FOOTNOTE_FONT_U = 2;
const FOOTNOTE_LINE_H = 1.15;

const ITEM_FONT_U = 3;
const ITEM_PADDING_U = 0.6;
const ITEM_LINE_H = 1.2;        // CSS "normal" line-height for the items
const INDENT_U = 2.5;
const HAIRLINE_U = 0.125;
const DETAILS_GAP_U = 1.5;

// ---- Content (kept here as the single source of truth — the old anchoring-facts.html
//      page was just a styled wrapper around the same strings) ----
const TITLE_TEXT = 'Anchoring facts';
const SERVING_NOTE = '12 containers per artwork';
const SERVING_ROW = { label: 'Original size', value: '1,52x1,22 Kpx' };
const COMPONENTS_ROW = { label: 'Components', value: '2.3 / 1.2' };
const FOOTNOTE_LINES = [
  '*As estimated by Vectoria institute',
  'Vessel developed and produced by A.C.C.E.P.T.A.N.C.E. (Vectoria institute)',
];
const DETAIL_LIST_1 = [
  { k: 'Curation Mode',             v: 'Closed Curation', indent: false },
  { k: 'Meme Propagation Method',   v: 'Market',          indent: false },
  { k: 'Anchor strength*',          v: '',                indent: false },
  { k: 'Added Long Tail Longevity', v: '65 years',        indent: true  },
  { k: 'Amplification probability', v: '20%',             indent: true  },
  { k: 'Recognition decay',         v: '5%',              indent: true  },
];
const DETAIL_LIST_2 = [
  { k: 'SM Department',                  v: 'Art',       indent: false },
  { k: 'Smiths Brothers Classification', v: 'Paperclip', indent: true  },
  { k: 'Pavilion',                       v: 'SALT',      indent: true  },
];

// ---- Measurement (shared offscreen 2D context — text widths only) ----
let measureCtx = null;
function getMeasureCtx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}
const fontStr = (size, weight = 'normal') => `${weight} ${size}px ${FONT_FAMILY}`;
function measureWidth(text, size, weight) {
  const ctx = getMeasureCtx();
  ctx.font = fontStr(size, weight);
  return ctx.measureText(text).width;
}
// Greedy word-wrap into lines that fit `maxWidth`. Items use CSS `word-break:
// normal` so we only split on whitespace — long single words still overflow,
// matching browser default behaviour.
function wrapText(text, maxWidth, size, weight) {
  if (!text) return [];
  const ctx = getMeasureCtx();
  ctx.font = fontStr(size, weight);
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = current + ' ' + words[i];
    if (ctx.measureText(candidate).width <= maxWidth) current = candidate;
    else { lines.push(current); current = words[i]; }
  }
  lines.push(current);
  return lines;
}

// ---- Layout (returns draw ops + the column's total height) ----

// Left column: fixed width 56.3u, contains four sections separated by 1.5u gaps:
// title block, serving block, metrics block, footer. Coordinates are relative
// to the column's outer top-left (i.e. INSIDE the frame border).
function layoutLeftCol(u) {
  const innerX = COL_PADDING_U * u;
  const innerW = COL_TITLE_WIDTH_U * u - 2 * COL_PADDING_U * u;
  const ops = [];
  let y = COL_PADDING_U * u;

  // Title (7u bold, line-height 1) + medium divider, no gap between them.
  ops.push({ k: 'text', x: innerX, y, size: TITLE_FONT_U * u, weight: 'bold',
             text: TITLE_TEXT, baseline: 'top' });
  y += TITLE_FONT_U * u;
  ops.push({ k: 'rect', x: innerX, y, w: innerW, h: DIV_MEDIUM_U * u });
  y += DIV_MEDIUM_U * u;
  y += SECTION_GAP_U * u;

  // Serving block: note + row + thin divider, 0.5u gaps.
  ops.push({ k: 'text', x: innerX, y, size: SERVING_FONT_U * u, weight: 'normal',
             text: SERVING_NOTE, baseline: 'top' });
  y += SERVING_FONT_U * u;
  y += SERVING_GAP_U * u;

  const sLabelW = measureWidth(SERVING_ROW.value, SERVING_FONT_U * u, 'bold');
  ops.push({ k: 'text', x: innerX, y, size: SERVING_FONT_U * u, weight: 'bold',
             text: SERVING_ROW.label, baseline: 'top' });
  ops.push({ k: 'text', x: innerX + innerW - sLabelW, y,
             size: SERVING_FONT_U * u, weight: 'bold',
             text: SERVING_ROW.value, baseline: 'top' });
  y += SERVING_FONT_U * u;
  y += SERVING_GAP_U * u;

  ops.push({ k: 'rect', x: innerX, y, w: innerW, h: DIV_THIN_U * u });
  y += DIV_THIN_U * u;
  y += SECTION_GAP_U * u;

  // Metrics block: "R0 Boost Spike / Steady" (sub-zero) + components row.
  // The subscript shares the regular baseline (CSS `vertical-align: baseline`).
  const boostBase = y + BOOST_FONT_U * u;
  const wR   = measureWidth('R', BOOST_FONT_U * u, 'bold');
  const wSub = measureWidth('0', BOOST_SUB_FONT_U * u, 'bold');
  ops.push({ k: 'text', x: innerX,             y: boostBase, size: BOOST_FONT_U * u,
             weight: 'bold', text: 'R', baseline: 'alphabetic' });
  ops.push({ k: 'text', x: innerX + wR,        y: boostBase, size: BOOST_SUB_FONT_U * u,
             weight: 'bold', text: '0', baseline: 'alphabetic' });
  ops.push({ k: 'text', x: innerX + wR + wSub, y: boostBase, size: BOOST_FONT_U * u,
             weight: 'bold', text: ' Boost Spike / Steady', baseline: 'alphabetic' });
  y += BOOST_FONT_U * u;
  y += METRICS_GAP_U * u;

  // Components row: 4u label, 6u value, baseline-aligned at the bottom (flex-end).
  const rowH = COMPONENTS_VALUE_FONT_U * u;
  const compBase = y + rowH;
  ops.push({ k: 'text', x: innerX, y: compBase, size: COMPONENTS_LABEL_FONT_U * u,
             weight: 'bold', text: COMPONENTS_ROW.label, baseline: 'alphabetic' });
  const compVW = measureWidth(COMPONENTS_ROW.value, COMPONENTS_VALUE_FONT_U * u, 'bold');
  ops.push({ k: 'text', x: innerX + innerW - compVW, y: compBase,
             size: COMPONENTS_VALUE_FONT_U * u, weight: 'bold',
             text: COMPONENTS_ROW.value, baseline: 'alphabetic' });
  y += rowH;
  y += SECTION_GAP_U * u;

  // Footer: 0.75u padding-y, then logo (rotated 90°) + footnote, vertically centred.
  y += FOOTER_PADDING_Y_U * u;
  const footnoteLineH = FOOTNOTE_FONT_U * u * FOOTNOTE_LINE_H;
  const footnoteH = FOOTNOTE_LINES.length * footnoteLineH;
  const logoH = LOGO_SIZE_U * u;
  const footerH = Math.max(logoH, footnoteH);

  ops.push({ k: 'logo', x: innerX, y: y + (footerH - logoH) / 2,
             w: LOGO_SIZE_U * u, h: LOGO_SIZE_U * u });

  const footnoteX = innerX + LOGO_SIZE_U * u + FOOTER_GAP_U * u;
  const footnoteY = y + (footerH - footnoteH) / 2;
  for (let i = 0; i < FOOTNOTE_LINES.length; i++) {
    ops.push({ k: 'text', x: footnoteX, y: footnoteY + i * footnoteLineH,
               size: FOOTNOTE_FONT_U * u, weight: 'normal',
               text: FOOTNOTE_LINES[i], baseline: 'top' });
  }
  y += footerH + FOOTER_PADDING_Y_U * u;
  y += COL_PADDING_U * u;
  return { ops, height: y };
}

// Right column: medium divider + detail-list (no top hairline on the first row)
// + big divider + grouped detail-list (all rows hairlined). No left padding —
// items span from x=0 to x=innerContentW, value pinned to the right edge.
function layoutRightCol(u, innerContentW) {
  const ops = [];
  let y = COL_PADDING_U * u;

  ops.push({ k: 'rect', x: 0, y, w: innerContentW, h: DIV_MEDIUM_U * u });
  y += DIV_MEDIUM_U * u;

  for (let i = 0; i < DETAIL_LIST_1.length; i++) {
    y = layoutItem(ops, DETAIL_LIST_1[i], y, u, innerContentW, /*hairlineTop*/ i > 0);
  }
  y += DETAILS_GAP_U * u;

  ops.push({ k: 'rect', x: 0, y, w: innerContentW, h: DIV_BIG_U * u });
  y += DIV_BIG_U * u;

  for (const item of DETAIL_LIST_2) {
    y = layoutItem(ops, item, y, u, innerContentW, /*hairlineTop*/ true);
  }

  y += COL_PADDING_U * u;
  return { ops, height: y };
}

// One detail row: optional top hairline, 0.6u padding, then label (wraps in the
// remaining width) and value (single line, baseline-anchored to the label
// block's bottom — flex-end). Indented rows get a 2.5u left inset and normal-
// weight label; non-indented rows are bold.
function layoutItem(ops, item, y, u, innerW, hairlineTop) {
  if (hairlineTop) {
    ops.push({ k: 'rect', x: 0, y, w: innerW, h: HAIRLINE_U * u });
    y += HAIRLINE_U * u;
  }
  y += ITEM_PADDING_U * u;

  const size = ITEM_FONT_U * u;
  const labelWeight = item.indent ? 'normal' : 'bold';
  const indent = item.indent ? INDENT_U * u : 0;
  const valueW = item.v ? measureWidth(item.v, size, 'bold') : 0;
  const gap = item.v ? 1 * u : 0;
  const labelMaxW = Math.max(1, innerW - indent - gap - valueW);

  const lines = wrapText(item.k, labelMaxW, size, labelWeight);
  const lineH = size * ITEM_LINE_H;
  const labelBlockH = Math.max(size, lines.length * lineH);

  // Share an alphabetic baseline between label and value so the pair sits on
  // the same line; multi-line labels stack their earlier lines above by lineH.
  const valueBaseline = y + labelBlockH;
  for (let i = 0; i < lines.length; i++) {
    ops.push({ k: 'text', x: indent,
               y: valueBaseline - (lines.length - 1 - i) * lineH,
               size, weight: labelWeight, text: lines[i], baseline: 'alphabetic' });
  }
  if (item.v) {
    ops.push({ k: 'text', x: innerW - valueW, y: valueBaseline,
               size, weight: 'bold', text: item.v, baseline: 'alphabetic' });
  }
  y += labelBlockH;
  y += ITEM_PADDING_U * u;
  return y;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Creates the anchoring-facts renderer.
 *
 * @param {object} [opts]
 * @param {string} [opts.basePath] - where the SM logo lives (default 'elements/').
 * @returns {{ load: () => Promise<void>,
 *             render: (length:number, colors?:object) => Promise<HTMLCanvasElement> }}
 */
export function createAnchoringFacts({ basePath = 'elements/' } = {}) {
  let logoImg = null;
  let calibratedU = 8;
  let ready = false;

  // Total outer table height at (L, u): max of the two columns' content heights
  // plus the frame's top/bottom border.
  function totalHeight(L, u) {
    const left = layoutLeftCol(u);
    const innerContentW = Math.max(
      1, L - 2 * FRAME_BORDER_U * u - COL_TITLE_WIDTH_U * u - COL_PADDING_U * u,
    );
    const right = layoutRightCol(u, innerContentW);
    return Math.max(left.height, right.height) + 2 * FRAME_BORDER_U * u;
  }

  async function load() {
    try { logoImg = await loadImage(basePath + LOGO_FILE); }
    catch { logoImg = null; } // table still renders without the logo
    // Calibrate u so outer height = THICKNESS at REF_LENGTH.
    const probeU = 8;
    const probeH = totalHeight(ANCHORING_REF_LENGTH, probeU);
    calibratedU = probeH > 0 ? (probeU * ANCHORING_THICKNESS) / probeH : probeU;
    ready = true;
  }

  function drawLogo(ctx, x, y, w, h) {
    if (!logoImg) return;
    // CSS rotate(90deg) — rotate around the box's centre.
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(logoImg, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  function drawOps(ctx, ops, ox, oy) {
    for (const op of ops) {
      if (op.k === 'text') {
        ctx.font = fontStr(op.size, op.weight);
        ctx.textBaseline = op.baseline;
        ctx.fillText(op.text, ox + op.x, oy + op.y);
      } else if (op.k === 'rect') {
        ctx.fillRect(ox + op.x, oy + op.y, op.w, op.h);
      } else if (op.k === 'logo') {
        drawLogo(ctx, ox + op.x, oy + op.y, op.w, op.h);
      }
    }
  }

  // The table is a fixed black-on-white nutrition sticker — `colors` is accepted
  // for API symmetry with the other live renderers (smiths-text), but ignored.
  function render(length /* , colors */) {
    if (!ready) return Promise.reject(new Error('anchoring-facts not loaded'));
    const L = Math.max(1, Math.round(length));
    const u = calibratedU;

    const left = layoutLeftCol(u);
    const innerContentW = Math.max(
      1, L - 2 * FRAME_BORDER_U * u - COL_TITLE_WIDTH_U * u - COL_PADDING_U * u,
    );
    const right = layoutRightCol(u, innerContentW);
    const contentH = Math.max(left.height, right.height);
    const totalH = Math.max(1, Math.round(contentH + 2 * FRAME_BORDER_U * u));

    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    // Paper, then ink for everything else.
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, L, totalH);
    ctx.fillStyle = INK;

    const b = FRAME_BORDER_U * u;
    ctx.fillRect(0, 0, L, b);                 // top border
    ctx.fillRect(0, totalH - b, L, b);        // bottom border
    ctx.fillRect(0, 0, b, totalH);            // left border
    ctx.fillRect(L - b, 0, b, totalH);        // right border

    drawOps(ctx, left.ops, b, b);
    drawOps(ctx, right.ops, b + COL_TITLE_WIDTH_U * u, b);

    return Promise.resolve(canvas);
  }

  return { load, render };
}
