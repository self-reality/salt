// -----------------------------------------------------------------------------
// label.js — standalone label-texture builder page (no THREE).
//
// Wires the right-side panel and the draggable bottom edge to the headless
// label build (lib/label-build.js), which owns the SVG fetch + medallion /
// side-text / stamp / barcode composition. This page is just the DOM surface;
// the 3D scenes drive the same lib/label-build.js with dataset metadata.
// -----------------------------------------------------------------------------

import { deriveColors } from './lib/color-extraction.js';
import { buildRandomManifestFromDataset } from './lib/dataset.js';
import { loadLabelAssets, createLabelBuild } from './lib/label-build.js';
import {
  TEX_WIDTH,
  BAND_TOP,
  bandHeightForArtwork,
  DEFAULT_SMITHS_TEXT,
} from './lib/label-texture.js';

// Same dataset the queue/test scenes draw from — the only one carrying the
// localFilename/width/height fields needed to load an artwork from /artworks.
const DATASET_PATH = 'queue/most-expensive-artworks.json';
const ARTWORK_BASE_PATH = 'artworks/';
const ARTWORK_SAMPLE_SIZE = 12;

async function main() {
  // ---- Up-front fetches: random artwork pool + the label build assets ------
  let dataset = [];
  try {
    dataset = await fetch(DATASET_PATH).then((r) => r.json());
  } catch (err) {
    console.warn('label: could not load artwork dataset', err);
  }

  // One-time fetch of every element SVG + Pacifico, then a headless build
  // around them. createLabelBuild seeds a complete default label; the panel
  // values below (which match the lib defaults) are pushed in so the HTML
  // stays authoritative for the initial paint.
  const assets = await loadLabelAssets();
  const lb = createLabelBuild(assets);

  // ---- Variables panel inputs ----------------------------------------------
  const barcodeInput = document.getElementById('barcode-text');
  const titleInput = document.getElementById('title-text');
  const stampValueInput = document.getElementById('stamp-value');
  const stampUnitInput = document.getElementById('stamp-unit');
  const datamatrixInput = document.getElementById('datamatrix-text');
  const medallionOuterInput = document.getElementById('medallion-outer-text');
  const medallionInnerInput = document.getElementById('medallion-inner-text');
  const medallionRadiusInput = document.getElementById('medallion-radius');
  const medallionRadiusValue = document.getElementById('medallion-radius-value');
  const medallionGuidesInput = document.getElementById('medallion-guides');

  // Push the panel's current medallion fields into the build (title, author,
  // radius, guides). setMedallion merges, so calling on any single edit is fine.
  const pushMedallion = () => lb.setMedallion({
    title: medallionOuterInput ? medallionOuterInput.value : undefined,
    author: medallionInnerInput ? medallionInnerInput.value : undefined,
    radius: medallionRadiusInput ? parseFloat(medallionRadiusInput.value) : undefined,
    showGuides: medallionGuidesInput ? medallionGuidesInput.checked : undefined,
  });

  // Seed the build from the HTML input values (they match the lib defaults, but
  // reading them keeps the markup authoritative).
  const pushStamp = () => lb.setStamp(
    stampValueInput ? stampValueInput.value : '',
    stampUnitInput ? stampUnitInput.value : '',
  );
  if (barcodeInput) lb.setBarcode(barcodeInput.value);
  if (datamatrixInput) lb.setDatamatrix(datamatrixInput.value);
  pushStamp();
  if (titleInput) lb.setSideTitle(titleInput.value);
  pushMedallion();

  // ---- Variables panel live edits ------------------------------------------
  if (barcodeInput) {
    barcodeInput.addEventListener('input', () => lb.setBarcode(barcodeInput.value));
  }
  if (titleInput) titleInput.addEventListener('input', () => lb.setSideTitle(titleInput.value));
  if (stampValueInput) stampValueInput.addEventListener('input', pushStamp);
  if (stampUnitInput) stampUnitInput.addEventListener('input', pushStamp);
  if (datamatrixInput) {
    datamatrixInput.addEventListener('input', () => lb.setDatamatrix(datamatrixInput.value));
  }
  if (medallionOuterInput) medallionOuterInput.addEventListener('input', pushMedallion);
  if (medallionInnerInput) medallionInnerInput.addEventListener('input', pushMedallion);

  const wireMedallionSlider = (input, valueEl) => {
    if (!input) return;
    input.addEventListener('input', () => {
      if (valueEl) valueEl.textContent = input.value;
      pushMedallion();
    });
  };
  wireMedallionSlider(medallionRadiusInput, medallionRadiusValue);
  if (medallionGuidesInput) medallionGuidesInput.addEventListener('change', pushMedallion);

  // Inner Circle ↕ neighbours min spacings — drive builder.setMinSpacings()
  // so the top-trio layout in lib/label-texture.js reflows live as you drag.
  const spacingAboveInput = document.getElementById('inner-circle-spacing-above');
  const spacingBelowInput = document.getElementById('inner-circle-spacing-below');
  const spacingAboveValue = document.getElementById('inner-circle-spacing-above-value');
  const spacingBelowValue = document.getElementById('inner-circle-spacing-below-value');
  const wireSpacingSlider = (input, valueEl, key) => {
    if (!input) return;
    input.addEventListener('input', () => {
      if (valueEl) valueEl.textContent = input.value;
      lb.setMinSpacings({ [key]: parseFloat(input.value) });
    });
  };
  wireSpacingSlider(spacingAboveInput, spacingAboveValue, 'above');
  wireSpacingSlider(spacingBelowInput, spacingBelowValue, 'below');

  // Smiths description — the long passage that wraps the can vertically. Seed
  // the textarea with the default the build already starts with; pipe edits in.
  const smithsInput = document.getElementById('smiths-text');
  if (smithsInput) {
    smithsInput.value = DEFAULT_SMITHS_TEXT;
    smithsInput.addEventListener('input', () => lb.setSmithsText(smithsInput.value));
  }

  // ---- On-screen canvas ----------------------------------------------------
  const wrap = document.getElementById('canvas-wrap');
  const handle = document.getElementById('resize-handle');
  const readout = document.getElementById('stage-readout');
  wrap.insertBefore(lb.canvas, handle);

  const updateReadout = () => {
    if (readout) {
      readout.textContent =
        `${TEX_WIDTH} × ${lb.bandHeight} px · band ${BAND_TOP} px from texture top`;
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
    lb.setColors(trio);
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
    const clamped = lb.setBand(px); // clamps + re-lays out the side text
    if (syncInput && bandInput) bandInput.value = String(clamped);
    updateReadout();
    return clamped;
  }

  if (bandInput) {
    bandInput.value = String(lb.bandHeight);
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
    startBand = lb.bandHeight;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const displayScale = lb.canvas.clientWidth / TEX_WIDTH;
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
    lb.setArtworkImage(img);
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
      // User-supplied file has no associated author — show the empty-disc
      // fallback rather than whatever avatar was on screen before.
      lb.setAvatar(null);
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
      // Stash the author's avatar URL on the option so the Circle.svg injector
      // can find it on selection without re-scanning the dataset.
      if (item.avatar) option.dataset.avatar = item.avatar;
      artworkSelect.appendChild(option);
    });
    return samples;
  }

  function avatarForSelectedOption() {
    if (!artworkSelect) return null;
    const opt = artworkSelect.options[artworkSelect.selectedIndex];
    return (opt && opt.dataset.avatar) || null;
  }

  if (artworkSelect) {
    artworkSelect.addEventListener('change', () => {
      if (artworkSelect.value) {
        loadArtworkFromUrl(artworkSelect.value);
        lb.setAvatar(avatarForSelectedOption());
      }
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
    if (artworkSelect.value) {
      loadArtworkFromUrl(artworkSelect.value);
      lb.setAvatar(avatarForSelectedOption());
    }
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
    lb.setAvatar(avatarForSelectedOption());
  } else {
    apply(); // no artwork: still paint the band + decal with default colours
  }
}

main();
