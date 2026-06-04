// -----------------------------------------------------------------------------
// label-build.js — headless orchestrator around lib/label-texture.js.
//
// The label-texture builder is pure: given element SVGs, an artwork image and a
// colour trio it composites the band. But turning *raw inputs* (an artwork plus
// its metadata) into a fully-driven builder needs a lot of glue: fetch every
// element SVG, load Pacifico, generate the barcode/datamatrix, inject the stamp
// text, compose the medallion (title/author/avatar) into Circle.svg, lay out the
// two side-text labels for the current band height, and re-run the medallion +
// side layout whenever those inputs change.
//
// That glue used to live inside label.js, bound to label.html's side panel. It
// now lives here so both label.js (the dev page) and the 3D scenes (via
// lib/can.js) drive the builder through one code path — label.js keeps only its
// DOM wiring, the scenes pass dataset metadata straight in.
// -----------------------------------------------------------------------------

import { createLabelTexture, bandHeightForArtwork, ELEMENT_FILES } from './label-texture.js';
import { deriveColors } from './color-extraction.js';
import { generateBarcodeSvg, DEFAULT_BARCODE_VALUE } from './barcode.js';
import { generateDatamatrixSvg, DATAMATRIX_FILE, DEFAULT_DATAMATRIX_VALUE } from './datamatrix.js';
import {
  generateSideTextSvg,
  loadPacificoDataUrl,
  computeSideLayout,
  SIDE_FRAME_WIDTH,
  PRESERVED_FILE,
  TITLE_FILE,
  DEFAULT_PRESERVED_TEXT,
  DEFAULT_TITLE_TEXT,
} from './side-text.js';
import { injectStampText, STAMP_FILE, DEFAULT_STAMP_VALUE, DEFAULT_STAMP_UNIT } from './stamp.js';
import { CIRCLE_FILE, loadAvatarDataUrl, injectCircleAvatar } from './circle-avatar.js';
import {
  injectMedallionText,
  DEFAULT_MEDALLION_OUTER_TEXT,
  DEFAULT_MEDALLION_INNER_TEXT,
  DEFAULT_MEDALLION_RADIUS,
  MAX_MEDALLION_FONT_SIZE,
} from './medallion-text.js';
import { formatNetWeight } from './dataset.js';

const DEFAULT_ELEMENTS_BASE_PATH = 'elements/svg elements/';
// Band-height clamp — matches the label.html slider bounds so scene auto-fit and
// the dev page agree on the valid range.
const MIN_BAND = 200;
const MAX_BAND = 4000;
// Arc length kept clear on each side of the medallion's title/author rings so
// their ends don't butt together at 9 and 3 o'clock.
const MEDALLION_SIDE_GAP = 40;

/**
 * One-time asset load: every element SVG plus the Pacifico data URL. Memoised
 * per base path so label.html and each scene pay the fetch only once.
 *
 * @returns {Promise<{ elementSvgs: object, pacificoDataUrl: string|null,
 *                     baseCircleSvg: string, baseStampSvg: string }>}
 */
const assetCache = new Map();
export function loadLabelAssets({ elementsBasePath = DEFAULT_ELEMENTS_BASE_PATH } = {}) {
  if (assetCache.has(elementsBasePath)) return assetCache.get(elementsBasePath);
  const p = (async () => {
    const elementSvgs = {};
    await Promise.all(
      ELEMENT_FILES.map(async (file) => {
        try {
          // no-cache forces conditional revalidation: a hard reload of the page
          // can still serve stale SVG sub-resources from disk cache otherwise.
          const res = await fetch(elementsBasePath + encodeURIComponent(file), { cache: 'no-cache' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          elementSvgs[file] = await res.text();
        } catch (err) {
          console.warn(`label-build: could not load element "${file}"`, err);
        }
      }),
    );
    const pacificoDataUrl = await loadPacificoDataUrl();
    return {
      elementSvgs,
      pacificoDataUrl,
      baseCircleSvg: elementSvgs[CIRCLE_FILE] || '',
      baseStampSvg: elementSvgs[STAMP_FILE] || '',
    };
  })();
  assetCache.set(elementsBasePath, p);
  return p;
}

/**
 * Create a headless label build around a fresh createLabelTexture() instance.
 * label.js drives the granular setters from its panel; scenes call setArtwork()
 * with dataset metadata. Both share the medallion/side-text/stamp composition.
 *
 * @param {object} assets - the loadLabelAssets() result.
 * @param {object} [opts]
 * @param {number} [opts.resolution] - forwarded to createLabelTexture().
 */
export function createLabelBuild(assets, { resolution } = {}) {
  const { pacificoDataUrl, baseCircleSvg, baseStampSvg } = assets;
  const builder = createLabelTexture(resolution != null ? { resolution } : {});

  // ---- Medallion geometry (canvas measureText needs Pacifico registered with
  //      document.fonts — loadPacificoDataUrl() in loadLabelAssets does that). --
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  const measureMedallionWidth = (text, fontSize) => {
    measureCtx.font = `${fontSize}px Pacifico, cursive`;
    return measureCtx.measureText(text || '').width;
  };
  const computeMedallionLayout = (title, author, radius) => {
    // Metrics scale linearly with font-size, so measure once at a reference size.
    const refSize = 100;
    const titleUnit = measureMedallionWidth(title, refSize) / refSize;
    const authorUnit = measureMedallionWidth(author, refSize) / refSize;
    const totalUnit = Math.max(titleUnit + authorUnit, 1e-6);
    const circumference = 2 * Math.PI * radius;
    const fontFit = Math.max(0, (circumference - 2 * MEDALLION_SIDE_GAP) / totalUnit);
    const fontSize = Math.min(MAX_MEDALLION_FONT_SIZE, fontFit);
    return { fontSize, titleArcLen: titleUnit * fontSize, authorArcLen: authorUnit * fontSize };
  };

  // ---- Mutable composition state -----------------------------------------
  let medallionTitle = DEFAULT_MEDALLION_OUTER_TEXT;
  let medallionAuthor = DEFAULT_MEDALLION_INNER_TEXT;
  let medallionRadius = DEFAULT_MEDALLION_RADIUS;
  let medallionGuides = false;
  let avatarDataUrl = null;
  let sideTitle = DEFAULT_TITLE_TEXT;
  let stampValue = DEFAULT_STAMP_VALUE;
  let stampUnit = DEFAULT_STAMP_UNIT;

  const medallionGeometry = () => {
    const layout = computeMedallionLayout(medallionTitle, medallionAuthor, medallionRadius);
    return {
      radius: medallionRadius,
      fontSize: layout.fontSize,
      titleArcLen: layout.titleArcLen,
      authorArcLen: layout.authorArcLen,
      showGuides: medallionGuides,
    };
  };
  const composeCircleSvg = () =>
    injectMedallionText(
      injectCircleAvatar(baseCircleSvg, avatarDataUrl),
      medallionTitle,
      medallionAuthor,
      pacificoDataUrl,
      medallionGeometry(),
    );

  // Re-layout both side labels for the current title + band height so the
  // column formula OUTER_PAD | preserved | MIN_GAP | title | OUTER_PAD = bandHeight
  // stays satisfied (block width *is* the band height).
  const rebuildSideText = () => {
    const layout = computeSideLayout(sideTitle, builder.bandHeight);
    const preservedSvg = generateSideTextSvg(
      DEFAULT_PRESERVED_TEXT,
      { width: SIDE_FRAME_WIDTH, height: layout.preservedHeight, fontSize: layout.fontSize },
      pacificoDataUrl,
    );
    const titleSvg = generateSideTextSvg(
      sideTitle,
      { width: SIDE_FRAME_WIDTH, height: layout.titleHeight, fontSize: layout.fontSize },
      pacificoDataUrl,
    );
    builder.setLayerYTop(PRESERVED_FILE, layout.preservedYTop);
    builder.setLayerYTop(TITLE_FILE, layout.titleYTop);
    builder.setElement(PRESERVED_FILE, preservedSvg);
    builder.setElement(TITLE_FILE, titleSvg);
  };

  // ---- Seed the builder with a complete default label --------------------
  const seedSvgs = { ...assets.elementSvgs };
  seedSvgs['Barcode.svg'] = generateBarcodeSvg(DEFAULT_BARCODE_VALUE);
  seedSvgs[DATAMATRIX_FILE] = generateDatamatrixSvg(DEFAULT_DATAMATRIX_VALUE);
  seedSvgs[STAMP_FILE] = injectStampText(baseStampSvg, stampValue, stampUnit);
  seedSvgs[CIRCLE_FILE] = composeCircleSvg();
  const initialSide = computeSideLayout(sideTitle, builder.bandHeight);
  seedSvgs[PRESERVED_FILE] = generateSideTextSvg(
    DEFAULT_PRESERVED_TEXT,
    { width: SIDE_FRAME_WIDTH, height: initialSide.preservedHeight, fontSize: initialSide.fontSize },
    pacificoDataUrl,
  );
  seedSvgs[TITLE_FILE] = generateSideTextSvg(
    sideTitle,
    { width: SIDE_FRAME_WIDTH, height: initialSide.titleHeight, fontSize: initialSide.fontSize },
    pacificoDataUrl,
  );
  builder.setElements(seedSvgs);
  builder.setLayerYTop(PRESERVED_FILE, initialSide.preservedYTop);
  builder.setLayerYTop(TITLE_FILE, initialSide.titleYTop);

  // ---- Granular setters (label.js drives these from its panel) -----------
  const setBand = (px) => {
    const clamped = Math.max(MIN_BAND, Math.min(MAX_BAND, Math.round(px)));
    builder.setBandHeight(clamped);
    rebuildSideText(); // font size + layer positions both depend on band height
    return clamped;
  };
  const rebuildMedallion = () => builder.setElement(CIRCLE_FILE, composeCircleSvg());

  // Avatar load is async with a stale-token guard so a slow fetch can't clobber
  // a later, faster selection during rapid cycling.
  let avatarToken = 0;
  const setAvatar = (url) => {
    const token = ++avatarToken;
    loadAvatarDataUrl(url).then((dataUrl) => {
      if (token !== avatarToken) return;
      avatarDataUrl = dataUrl;
      rebuildMedallion();
    });
  };

  return {
    builder,
    get canvas() { return builder.canvas; },
    get bandHeight() { return builder.bandHeight; },

    /**
     * Per-artwork entry point for scenes: composites the artwork, auto-fits the
     * band to its aspect, personalises the medallion + side title, swaps the
     * avatar, and derives colours (unless an explicit trio is passed).
     * Returns the clamped band height so the caller can map it to the can's
     * Y-stretch.
     */
    setArtwork({ image, title = '', author = '', avatarUrl = null, colors, smithsText, sizeKb, width, height } = {}) {
      builder.setArtwork(image);
      builder.setDimensions(width, height); // "Original size" row in the anchoring table
      medallionTitle = title;
      medallionAuthor = author;
      sideTitle = title ? `“${title}”  by ${author}` : DEFAULT_TITLE_TEXT;
      rebuildMedallion();
      setAvatar(avatarUrl);
      if (smithsText != null) builder.setSmithsText(smithsText);
      const netWt = formatNetWeight(sizeKb);
      if (netWt) {
        stampValue = netWt.value;
        stampUnit = netWt.unit;
        builder.setElement(STAMP_FILE, injectStampText(baseStampSvg, stampValue, stampUnit));
      }
      if (colors) builder.setColors(colors);
      else builder.setColors(deriveColors(image)); // safe on taint (returns fallback)
      return setBand(bandHeightForArtwork(image));
    },

    // Image only — no medallion/avatar/colour side effects (label.js drives
    // those from its panel and its <select> handler).
    setArtworkImage(img) { builder.setArtwork(img); },
    setDimensions(width, height) { builder.setDimensions(width, height); },
    setBand,
    setColors(trio) { builder.setColors(trio); },
    setAvatar,
    setMedallion({ title, author, radius, showGuides } = {}) {
      if (title != null) medallionTitle = title;
      if (author != null) medallionAuthor = author;
      if (Number.isFinite(radius)) medallionRadius = radius;
      if (showGuides != null) medallionGuides = !!showGuides;
      rebuildMedallion();
    },
    setSideTitle(text) { sideTitle = text == null ? '' : String(text); rebuildSideText(); },
    setBarcode(value) { builder.setElement('Barcode.svg', generateBarcodeSvg(value)); },
    setDatamatrix(value) { builder.setElement(DATAMATRIX_FILE, generateDatamatrixSvg(value)); },
    setStamp(value, unit) {
      stampValue = value;
      stampUnit = unit;
      builder.setElement(STAMP_FILE, injectStampText(baseStampSvg, value, unit));
    },
    setSmithsText(text) { builder.setSmithsText(text); },
    setMinSpacings(spacings) { builder.setMinSpacings(spacings); },
  };
}
