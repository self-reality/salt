// -----------------------------------------------------------------------------
// label.js — standalone label-texture builder page (no THREE).
//
// Wires the right-side panel and the draggable bottom edge to the pure-2D
// label-band builder. Reuses the existing colour-extraction and dataset modules.
// This page develops the texture construction in isolation; the real 3D scenes
// will import lib/label-texture.js later.
// -----------------------------------------------------------------------------

import { deriveColors } from './lib/color-extraction.js';
import { buildRandomManifestFromDataset } from './lib/dataset.js';
import {
  createLabelTexture,
  bandHeightForArtwork,
  ELEMENT_FILES,
  TEX_WIDTH,
  BAND_TOP,
  DEFAULT_BAND_HEIGHT,
} from './lib/label-texture.js';
import { generateBarcodeSvg, DEFAULT_BARCODE_VALUE } from './lib/barcode.js';
import {
  generateSideTextSvg,
  loadPacificoDataUrl,
  PRESERVED_FRAME,
  TITLE_FRAME,
  PRESERVED_FILE,
  TITLE_FILE,
  DEFAULT_PRESERVED_TEXT,
  DEFAULT_TITLE_TEXT,
} from './lib/side-text.js';

// Same dataset the queue/test scenes draw from — the only one carrying the
// localFilename/width/height fields needed to load an artwork from /artworks.
const DATASET_PATH = 'queue/most-expensive-artworks.json';
const ARTWORK_BASE_PATH = 'artworks/';
const ELEMENTS_BASE_PATH = 'elements/svg elements/';
const ARTWORK_SAMPLE_SIZE = 12;
const MIN_BAND = 200;
const MAX_BAND = 4000;

async function main() {
  // ---- Up-front fetches: random artwork pool + the decal source ------------
  let dataset = [];
  try {
    dataset = await fetch(DATASET_PATH).then((r) => r.json());
  } catch (err) {
    console.warn('label: could not load artwork dataset', err);
  }

  // Each Decal element is its own SVG, composited as an anchored layer by the
  // builder. Fetch them independently so one missing file can't blank the whole
  // decal — whatever loads gets composited; failures are logged by name.
  const elementSvgs = {};
  await Promise.all(
    ELEMENT_FILES.map(async (file) => {
      try {
        const res = await fetch(ELEMENTS_BASE_PATH + encodeURIComponent(file));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        elementSvgs[file] = await res.text();
      } catch (err) {
        console.warn(`label: could not load decal element "${file}"`, err);
      }
    }),
  );

  // ---- Builder + on-screen canvas ------------------------------------------
  const builder = createLabelTexture();

  // Pacifico for the two live side-text labels — best-effort fetch, the SVG
  // generator falls back to system cursive if it can't load. Resolves before
  // setElements() so the initial paint already carries the embedded font.
  const pacificoDataUrl = await loadPacificoDataUrl();

  // Override the static Barcode.svg + the two path-baked side-text SVGs with
  // freshly-generated ones so the initial paint matches the side-panel inputs.
  const barcodeInput = document.getElementById('barcode-text');
  const titleInput = document.getElementById('title-text');
  const initialBarcode = (barcodeInput && barcodeInput.value) || DEFAULT_BARCODE_VALUE;
  const initialTitle = (titleInput && titleInput.value) || DEFAULT_TITLE_TEXT;
  elementSvgs['Barcode.svg'] = generateBarcodeSvg(initialBarcode);
  elementSvgs[PRESERVED_FILE] = generateSideTextSvg(
    DEFAULT_PRESERVED_TEXT, PRESERVED_FRAME, pacificoDataUrl,
  );
  elementSvgs[TITLE_FILE] = generateSideTextSvg(
    initialTitle, TITLE_FRAME, pacificoDataUrl,
  );
  builder.setElements(elementSvgs);

  if (barcodeInput) {
    barcodeInput.addEventListener('input', () => {
      builder.setElement('Barcode.svg', generateBarcodeSvg(barcodeInput.value));
    });
  }
  if (titleInput) {
    titleInput.addEventListener('input', () => {
      builder.setElement(
        TITLE_FILE,
        generateSideTextSvg(titleInput.value, TITLE_FRAME, pacificoDataUrl),
      );
    });
  }

  const wrap = document.getElementById('canvas-wrap');
  const handle = document.getElementById('resize-handle');
  const readout = document.getElementById('stage-readout');
  wrap.insertBefore(builder.canvas, handle);

  const updateReadout = () => {
    if (readout) {
      readout.textContent =
        `${TEX_WIDTH} × ${builder.bandHeight} px · band ${BAND_TOP} px from texture top`;
    }
  };

  // ---- Label colours -------------------------------------------------------
  const methodSelect = document.getElementById('color-method');
  const sampleSlider = document.getElementById('color-sample');
  const paletteSlider = document.getElementById('color-palette');
  const vividnessSlider = document.getElementById('color-vividness');
  const saturationSlider = document.getElementById('color-saturation');
  const contrastSlider = document.getElementById('color-contrast');
  const bgInput = document.getElementById('color-bg');
  const textInput = document.getElementById('color-text');
  const outlineInput = document.getElementById('color-outline');
  const autoCheckbox = document.getElementById('color-auto');
  const rederiveBtn = document.getElementById('color-rederive');
  const statusEl = document.getElementById('color-status');

  let lastArtwork = null;
  const overrides = {}; // manual swatch edits: { background?, text?, outline? }

  const setColorStatus = (msg) => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.hidden = !msg;
  };

  // Dominant reads the artwork's pixels through a canvas; a file:// page or
  // cross-origin artwork taints that canvas so getImageData throws, and the
  // derivation silently falls back to a black/white trio. Probe once per image
  // so we can say so plainly. Cached because apply() also fires on every slider
  // drag.
  let taintCheckedImg = null, taintCheckedOk = true;
  const canSampleImage = (img) => {
    if (img === taintCheckedImg) return taintCheckedOk;
    taintCheckedImg = img;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 1, 1);
      ctx.getImageData(0, 0, 1, 1);
      taintCheckedOk = true;
    } catch (_) {
      taintCheckedOk = false;
    }
    return taintCheckedOk;
  };

  const readSettings = () => ({
    sampleSize: sampleSlider ? parseInt(sampleSlider.value, 10) : 128,
    paletteSize: paletteSlider ? parseInt(paletteSlider.value, 10) : 16,
    vividness: vividnessSlider ? parseFloat(vividnessSlider.value) : 8,
    saturation: saturationSlider ? parseFloat(saturationSlider.value) : 2,
    minContrast: contrastSlider ? parseFloat(contrastSlider.value) : 7,
  });

  function baseTrio() {
    if (!lastArtwork) {
      return {
        background: bgInput ? bgInput.value : '#000000',
        text: textInput ? textInput.value : '#ffffff',
        outline: outlineInput ? outlineInput.value : '#000000',
      };
    }
    return deriveColors(lastArtwork, readSettings());
  }

  function apply() {
    const taintWarning = lastArtwork && !canSampleImage(lastArtwork)
      ? '⚠ Can’t read this image’s pixels (page on file:// or cross-origin artwork). Dominant falls back to black/white — serve the page over http://localhost.'
      : '';
    const trio = { ...baseTrio(), ...overrides };
    builder.setColors(trio);
    if (bgInput) bgInput.value = trio.background;
    if (textInput) textInput.value = trio.text;
    if (outlineInput) outlineInput.value = trio.outline;
    setColorStatus(taintWarning);
  }

  const bindSlider = (slider, fmt) => {
    if (!slider) return;
    const valueEl = document.getElementById(`${slider.id}-value`);
    const sync = () => { if (valueEl) valueEl.textContent = fmt(slider.value); };
    sync();
    slider.addEventListener('input', () => { sync(); apply(); });
  };
  bindSlider(sampleSlider, (v) => String(parseInt(v, 10)));
  bindSlider(paletteSlider, (v) => String(parseInt(v, 10)));
  bindSlider(vividnessSlider, (v) => parseFloat(v).toFixed(1));
  bindSlider(saturationSlider, (v) => parseFloat(v).toFixed(2));
  bindSlider(contrastSlider, (v) => parseFloat(v).toFixed(1));
  if (methodSelect) methodSelect.addEventListener('change', apply);

  // Manual swatch edits become overrides until "Re-derive" clears them.
  if (bgInput) bgInput.addEventListener('input', () => { overrides.background = bgInput.value; apply(); });
  if (textInput) textInput.addEventListener('input', () => { overrides.text = textInput.value; apply(); });
  if (outlineInput) outlineInput.addEventListener('input', () => { overrides.outline = outlineInput.value; apply(); });
  if (rederiveBtn) {
    rederiveBtn.addEventListener('click', () => {
      delete overrides.background;
      delete overrides.text;
      delete overrides.outline;
      apply();
    });
  }

  // ---- Label size: number input + draggable bottom edge --------------------
  const bandInput = document.getElementById('band-height');

  function setBand(px, { syncInput = true } = {}) {
    const clamped = Math.max(MIN_BAND, Math.min(MAX_BAND, Math.round(px)));
    builder.setBandHeight(clamped);
    if (syncInput && bandInput) bandInput.value = String(clamped);
    updateReadout();
    return clamped;
  }

  if (bandInput) {
    bandInput.value = String(DEFAULT_BAND_HEIGHT);
    bandInput.addEventListener('input', () => {
      const v = parseInt(bandInput.value, 10);
      if (Number.isFinite(v)) setBand(v, { syncInput: false });
    });
  }

  // Convert a screen-Y drag delta to texture px via the on-screen scale
  // (canvas displayed width maps to TEX_WIDTH logical units). rAF-coalesced.
  let dragging = false;
  let startY = 0;
  let startBand = 0;
  let pendingBand = 0;
  let rafPending = false;
  const flushDrag = () => { rafPending = false; setBand(pendingBand); };

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startBand = builder.bandHeight;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const displayScale = builder.canvas.clientWidth / TEX_WIDTH;
    pendingBand = startBand + (e.clientY - startY) / (displayScale || 1);
    if (!rafPending) { rafPending = true; requestAnimationFrame(flushDrag); }
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  // ---- Artwork -------------------------------------------------------------
  // Selecting an artwork composites it and auto-fits the band height to the
  // artwork's aspect ratio (so it isn't distorted); the user can then drag.
  function loadArtwork(img) {
    lastArtwork = img;
    builder.setArtwork(img);
    setBand(bandHeightForArtwork(img));
    if (!autoCheckbox || autoCheckbox.checked) apply();
  }

  function loadArtworkFromUrl(url) {
    const img = new Image();
    img.onload = () => loadArtwork(img);
    img.onerror = () => console.error('label: artwork failed to load', url);
    img.src = url;
  }

  const fileInput = document.getElementById('decal-file');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { loadArtwork(img); URL.revokeObjectURL(url); };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    });
  }

  const artworkSelect = document.getElementById('artwork-select');
  const shuffleBtn = document.getElementById('artwork-shuffle');
  const prevBtn = document.getElementById('artwork-prev');
  const nextBtn = document.getElementById('artwork-next');

  function populateArtworks() {
    if (!artworkSelect) return [];
    const samples = buildRandomManifestFromDataset(dataset, ARTWORK_SAMPLE_SIZE);
    artworkSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = samples.length ? 'Select an artwork…' : 'No artworks available';
    artworkSelect.appendChild(placeholder);
    samples.forEach((item) => {
      const option = document.createElement('option');
      option.value = ARTWORK_BASE_PATH + item.filename;
      option.textContent = `${item.username} — ${item.name}`;
      artworkSelect.appendChild(option);
    });
    return samples;
  }

  if (artworkSelect) {
    artworkSelect.addEventListener('change', () => {
      if (artworkSelect.value) loadArtworkFromUrl(artworkSelect.value);
    });
  }
  if (shuffleBtn) shuffleBtn.addEventListener('click', () => populateArtworks());

  // Step the queue selection by one, skipping the placeholder at index 0 and
  // wrapping around the ends. dir is -1 (prev) or +1 (next).
  function cycleArtwork(dir) {
    if (!artworkSelect) return;
    const count = artworkSelect.options.length;
    if (count <= 1) return; // only the placeholder is present
    let i = artworkSelect.selectedIndex;
    if (i < 1) i = dir > 0 ? 0 : 1; // from placeholder, step into the real range
    i += dir;
    if (i < 1) i = count - 1;      // wrap past the first real option
    else if (i > count - 1) i = 1; // wrap past the last
    artworkSelect.selectedIndex = i;
    if (artworkSelect.value) loadArtworkFromUrl(artworkSelect.value);
  }

  if (prevBtn) prevBtn.addEventListener('click', () => cycleArtwork(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => cycleArtwork(1));

  // ---- Collapsible section headers (mirrors the 3D panel behaviour) ---------
  document.querySelectorAll('.controls-group .controls-section-title').forEach((title) => {
    const group = title.closest('.controls-group');
    if (!group) return;
    title.addEventListener('click', () => group.classList.toggle('collapsed'));
  });

  // ---- Initial state: load a random artwork so the page shows something -----
  const samples = populateArtworks();
  updateReadout();
  if (samples.length && artworkSelect) {
    artworkSelect.selectedIndex = 1; // index 0 is the placeholder
    loadArtworkFromUrl(artworkSelect.value);
  } else {
    apply(); // no artwork: still paint the band + decal with default colours
  }
}

main();
