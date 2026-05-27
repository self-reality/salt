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

// Below this canvas width, the left column starts shrinking proportionally
// instead of staying at its calibrated 56.3u — the right column would otherwise
// grow vertically (more text wrap) and the downstream draw step would squash
// the canvas back to ANCHORING_THICKNESS, visibly compressing every element.
const RESPONSIVE_BREAKPOINT_PX = 780;
// Minimum horizontal gap kept between label and value in the serving/metrics
// rows. Once the row would close past this gap, the row's font scales down
// instead of overlapping.
const MIN_VALUE_GAP_U = 1;

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

// Left column: width `colW` (calibrated 56.3u above RESPONSIVE_BREAKPOINT_PX,
// scaled proportionally below). Contains four sections separated by 1.5u gaps:
// title block, serving block, metrics block, footer. Coordinates are relative
// to the column's outer top-left (i.e. INSIDE the frame border).
function layoutLeftCol(u, colW) {
  const innerX = COL_PADDING_U * u;
  const innerW = Math.max(1, colW - 2 * COL_PADDING_U * u);
  const ops = [];
  // Named bounding boxes for the dev inspector overlay — see getInspect().
  // Each entry is { name, x, y, w, h } in column-relative coords.
  const blocks = [];
  let y = COL_PADDING_U * u;

  // Title block. Default: single line at 7u. If it doesn't fit, wrap each word
  // onto its own line ("Anchoring" / "facts"). Only if a single word still
  // overflows do we fall back to font-shrink — a safety net for absurdly narrow
  // widths that the user wouldn't realistically hit.
  let blockY = y;
  const titleDesired = TITLE_FONT_U * u;
  const titleNaturalW = measureWidth(TITLE_TEXT, titleDesired, 'bold');
  if (titleNaturalW <= innerW) {
    ops.push({ k: 'text', x: innerX, y, size: titleDesired, weight: 'bold',
               text: TITLE_TEXT, baseline: 'top' });
    y += titleDesired;
  } else {
    const titleWords = TITLE_TEXT.split(/\s+/).filter(Boolean);
    let widestWord = 0;
    for (const w of titleWords) {
      widestWord = Math.max(widestWord, measureWidth(w, titleDesired, 'bold'));
    }
    const titleSize = widestWord > innerW
      ? titleDesired * (innerW / widestWord)
      : titleDesired;
    for (let i = 0; i < titleWords.length; i++) {
      ops.push({ k: 'text', x: innerX, y: y + i * titleSize, size: titleSize,
                 weight: 'bold', text: titleWords[i], baseline: 'top' });
    }
    y += titleSize * titleWords.length;
  }
  ops.push({ k: 'rect', x: innerX, y, w: innerW, h: DIV_MEDIUM_U * u });
  y += DIV_MEDIUM_U * u;
  blocks.push({ name: 'Title', x: innerX, y: blockY, w: innerW, h: y - blockY });
  y += SECTION_GAP_U * u;

  // Serving block: note + row + thin divider, 0.5u gaps. Note line shrinks to
  // fit if it would overflow; row uses pull-together-then-scale.
  blockY = y;
  const noteDesired = SERVING_FONT_U * u;
  const noteNaturalW = measureWidth(SERVING_NOTE, noteDesired, 'normal');
  const noteSize = noteNaturalW > innerW
    ? noteDesired * (innerW / noteNaturalW)
    : noteDesired;
  ops.push({ k: 'text', x: innerX, y, size: noteSize, weight: 'normal',
             text: SERVING_NOTE, baseline: 'top' });
  y += noteSize;
  y += SERVING_GAP_U * u;

  // Row: value is right-anchored — as the column shrinks it slides left "for
  // free". Once labelW + 1u + valueW > innerW the row scales font uniformly so
  // a 1u gap is preserved.
  const sBase = SERVING_FONT_U * u;
  const sLabelBase = measureWidth(SERVING_ROW.label, sBase, 'bold');
  const sValueBase = measureWidth(SERVING_ROW.value, sBase, 'bold');
  const sMinGap = MIN_VALUE_GAP_U * u;
  const sNeeded = sLabelBase + sMinGap + sValueBase;
  const sSize = sNeeded > innerW
    ? sBase * Math.max(0, innerW - sMinGap) / (sLabelBase + sValueBase)
    : sBase;
  const sValueW = measureWidth(SERVING_ROW.value, sSize, 'bold');
  ops.push({ k: 'text', x: innerX, y, size: sSize, weight: 'bold',
             text: SERVING_ROW.label, baseline: 'top' });
  ops.push({ k: 'text', x: innerX + innerW - sValueW, y,
             size: sSize, weight: 'bold',
             text: SERVING_ROW.value, baseline: 'top' });
  y += sSize;
  y += SERVING_GAP_U * u;

  ops.push({ k: 'rect', x: innerX, y, w: innerW, h: DIV_THIN_U * u });
  y += DIV_THIN_U * u;
  blocks.push({ name: 'Serving', x: innerX, y: blockY, w: innerW, h: y - blockY });
  y += SECTION_GAP_U * u;

  // Metrics block: "R0 Boost Spike / Steady" (sub-zero) + components row.
  // The subscript shares the regular baseline (CSS `vertical-align: baseline`).
  // Both rows scale font uniformly when their content can't fit innerW.
  blockY = y;
  const bBase = BOOST_FONT_U * u;
  const bSubBase = BOOST_SUB_FONT_U * u;
  const wR_base   = measureWidth('R', bBase, 'bold');
  const wSub_base = measureWidth('0', bSubBase, 'bold');
  const wRest_base = measureWidth(' Boost Spike / Steady', bBase, 'bold');
  const boostTotal = wR_base + wSub_base + wRest_base;
  const boostScale = boostTotal > innerW ? innerW / boostTotal : 1;
  const bSize = bBase * boostScale;
  const bSubSize = bSubBase * boostScale;
  const wR = wR_base * boostScale;
  const wSub = wSub_base * boostScale;
  const boostBase = y + bSize;
  ops.push({ k: 'text', x: innerX,             y: boostBase, size: bSize,
             weight: 'bold', text: 'R', baseline: 'alphabetic' });
  ops.push({ k: 'text', x: innerX + wR,        y: boostBase, size: bSubSize,
             weight: 'bold', text: '0', baseline: 'alphabetic' });
  ops.push({ k: 'text', x: innerX + wR + wSub, y: boostBase, size: bSize,
             weight: 'bold', text: ' Boost Spike / Steady', baseline: 'alphabetic' });
  y += bSize;
  y += METRICS_GAP_U * u;

  // Components row: 4u label, 6u value, baseline-aligned at the bottom (flex-end).
  // Same pull-together-then-scale rule as the serving row; the 4u/6u relationship
  // is preserved when scaling.
  const cLabelBase = COMPONENTS_LABEL_FONT_U * u;
  const cValueBase = COMPONENTS_VALUE_FONT_U * u;
  const cLabelW_base = measureWidth(COMPONENTS_ROW.label, cLabelBase, 'bold');
  const cValueW_base = measureWidth(COMPONENTS_ROW.value, cValueBase, 'bold');
  const cMinGap = MIN_VALUE_GAP_U * u;
  const cNeeded = cLabelW_base + cMinGap + cValueW_base;
  const cScale = cNeeded > innerW
    ? Math.max(0, innerW - cMinGap) / (cLabelW_base + cValueW_base)
    : 1;
  const cLabelSize = cLabelBase * cScale;
  const cValueSize = cValueBase * cScale;
  const cValueW = cValueW_base * cScale;
  const rowH = cValueSize;
  const compBase = y + rowH;
  ops.push({ k: 'text', x: innerX, y: compBase, size: cLabelSize,
             weight: 'bold', text: COMPONENTS_ROW.label, baseline: 'alphabetic' });
  ops.push({ k: 'text', x: innerX + innerW - cValueW, y: compBase,
             size: cValueSize, weight: 'bold',
             text: COMPONENTS_ROW.value, baseline: 'alphabetic' });
  y += rowH;
  blocks.push({ name: 'Metrics', x: innerX, y: blockY, w: innerW, h: y - blockY });
  y += SECTION_GAP_U * u;

  // Footer: 0.75u padding-y, then logo (rotated 90°) + footnote, vertically centred.
  blockY = y;
  // The footnote lines wrap greedily within the space the logo leaves on the
  // right so they never bleed past the column's inner padding.
  y += FOOTER_PADDING_Y_U * u;
  const footnoteSize = FOOTNOTE_FONT_U * u;
  const footnoteLineH = footnoteSize * FOOTNOTE_LINE_H;
  const footnoteMaxW = Math.max(1, innerW - LOGO_SIZE_U * u - FOOTER_GAP_U * u);
  const footnoteLines = [];
  for (const line of FOOTNOTE_LINES) {
    const wrapped = wrapText(line, footnoteMaxW, footnoteSize, 'normal');
    if (wrapped.length === 0) continue;
    for (const w of wrapped) footnoteLines.push(w);
  }
  const footnoteH = footnoteLines.length * footnoteLineH;
  const logoH = LOGO_SIZE_U * u;
  const footerH = Math.max(logoH, footnoteH);

  ops.push({ k: 'logo', x: innerX, y: y + (footerH - logoH) / 2,
             w: LOGO_SIZE_U * u, h: LOGO_SIZE_U * u });

  const footnoteX = innerX + LOGO_SIZE_U * u + FOOTER_GAP_U * u;
  const footnoteY = y + (footerH - footnoteH) / 2;
  for (let i = 0; i < footnoteLines.length; i++) {
    ops.push({ k: 'text', x: footnoteX, y: footnoteY + i * footnoteLineH,
               size: footnoteSize, weight: 'normal',
               text: footnoteLines[i], baseline: 'top' });
  }
  y += footerH + FOOTER_PADDING_Y_U * u;
  blocks.push({ name: 'Footer', x: innerX, y: blockY, w: innerW, h: y - blockY });
  y += COL_PADDING_U * u;
  return { ops, height: y, blocks };
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
  // plus the frame's top/bottom border. Below RESPONSIVE_BREAKPOINT_PX the left
  // column shrinks too, so both columns share the width loss.
  function totalHeight(L, u) {
    const widthScale = L < RESPONSIVE_BREAKPOINT_PX ? L / RESPONSIVE_BREAKPOINT_PX : 1;
    const leftColW = COL_TITLE_WIDTH_U * u * widthScale;
    const left = layoutLeftCol(u, leftColW);
    const innerContentW = Math.max(
      1, L - 2 * FRAME_BORDER_U * u - leftColW - COL_PADDING_U * u,
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
    const widthScale = L < RESPONSIVE_BREAKPOINT_PX ? L / RESPONSIVE_BREAKPOINT_PX : 1;
    const leftColW = COL_TITLE_WIDTH_U * u * widthScale;

    const left = layoutLeftCol(u, leftColW);
    const innerContentW = Math.max(
      1, L - 2 * FRAME_BORDER_U * u - leftColW - COL_PADDING_U * u,
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
    drawOps(ctx, right.ops, b + leftColW, b);

    return Promise.resolve(canvas);
  }

  // Where the column divider, frame borders, and right edge sit in canvas-px
  // for a given outer length. Exposed for the dev harness's inspect-style
  // guides; cheap and side-effect-free.
  function getLayout(length) {
    const u = calibratedU;
    const b = FRAME_BORDER_U * u;
    const L = Math.max(1, Math.round(length));
    const widthScale = L < RESPONSIVE_BREAKPOINT_PX ? L / RESPONSIVE_BREAKPOINT_PX : 1;
    const leftColW = COL_TITLE_WIDTH_U * u * widthScale;
    return {
      u,
      frameBorder: b,
      leftColStart: b,
      colDivider: b + leftColW,
      rightColEnd: L - b,
      width: L,
    };
  }

  // Named block bounds + surrounding paddings, all in absolute canvas px, for
  // the dev harness's hover-inspect overlay. Computed by running the layout
  // and shifting column-local coords into the outer canvas frame.
  function getInspect(length) {
    const u = calibratedU;
    const b = FRAME_BORDER_U * u;
    const pad = COL_PADDING_U * u;
    const L = Math.max(1, Math.round(length));
    const widthScale = L < RESPONSIVE_BREAKPOINT_PX ? L / RESPONSIVE_BREAKPOINT_PX : 1;
    const colW = COL_TITLE_WIDTH_U * u * widthScale;

    const left = layoutLeftCol(u, colW);
    const innerContentW = Math.max(1, L - 2 * b - colW - pad);
    const right = layoutRightCol(u, innerContentW);
    const contentH = Math.max(left.height, right.height);
    const totalH = Math.round(contentH + 2 * b);

    // Left-column blocks: shift column-local (x, y) into canvas coords.
    const blocks = (left.blocks || []).map((blk) => ({
      name: blk.name,
      x: b + blk.x,
      y: b + blk.y,
      w: blk.w,
      h: blk.h,
    }));

    // Right column shown as one block covering its inner content area
    // (excludes its own 3u top/bottom padding and 3u right padding).
    blocks.push({
      name: 'Right column',
      x: b + colW,
      y: b + pad,
      w: innerContentW,
      h: Math.max(0, right.height - 2 * pad),
    });

    // Spacings/paddings around and between the named blocks.
    const spacings = [];
    // Frame borders (the black rules around the whole sticker).
    spacings.push({ name: 'Frame border (top)',    x: 0,     y: 0,         w: L,         h: b });
    spacings.push({ name: 'Frame border (bottom)', x: 0,     y: totalH - b, w: L,         h: b });
    spacings.push({ name: 'Frame border (left)',   x: 0,     y: 0,         w: b,         h: totalH });
    spacings.push({ name: 'Frame border (right)',  x: L - b, y: 0,         w: b,         h: totalH });

    // Left-column outer paddings (between frame border and inner content).
    spacings.push({ name: 'Left column · top padding',    x: b + pad,           y: b,                       w: colW - 2 * pad, h: pad });
    spacings.push({ name: 'Left column · bottom padding', x: b + pad,           y: b + left.height - pad,   w: colW - 2 * pad, h: pad });
    spacings.push({ name: 'Left column · left padding',   x: b,                 y: b,                       w: pad,            h: left.height });
    spacings.push({ name: 'Left column · right padding',  x: b + colW - pad,    y: b,                       w: pad,            h: left.height });

    // Section gaps between consecutive left-column blocks.
    for (let i = 0; i < blocks.length - 1; i++) {
      const cur = blocks[i];
      const next = blocks[i + 1];
      if (next.name === 'Right column') break;
      const gapY = cur.y + cur.h;
      const gapH = next.y - gapY;
      if (gapH > 0.01) {
        spacings.push({
          name: `Section gap (after ${cur.name})`,
          x: cur.x, y: gapY, w: cur.w, h: gapH,
        });
      }
    }

    // Right column paddings (top, bottom, right — no left padding by design).
    spacings.push({ name: 'Right column · top padding',    x: b + colW,                 y: b,                        w: innerContentW, h: pad });
    spacings.push({ name: 'Right column · bottom padding', x: b + colW,                 y: b + right.height - pad,   w: innerContentW, h: pad });
    spacings.push({ name: 'Right column · right padding',  x: b + colW + innerContentW, y: b,                        w: pad,           h: right.height });

    return { u, width: L, height: totalH, blocks, spacings };
  }

  return { load, render, getLayout, getInspect };
}
