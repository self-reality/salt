// -----------------------------------------------------------------------------
// prerender-page.js — browser side of the offline texture prerenderer.
//
// Runs inside headless Chromium (driven by scripts/prerender-textures.js). It
// reuses the *exact* live label pipeline (lib/label-build.js → lib/label-texture.js)
// so prerendered output matches what the 3D scenes / label.html render on the
// fly, then replays lib/can.js's full-can composite to bake the band into the
// can's BaseColor texture. THREE is never imported here — only lib/can.js pulls
// it in, and we re-implement its ~10-line composite below instead.
//
// Exposes window.__prerenderOne(entry) for the Node driver to call per artwork.
// -----------------------------------------------------------------------------

import { loadLabelAssets, createLabelBuild } from '/lib/label-build.js';
import { REF_HEIGHT } from '/lib/label-texture.js';
import { deriveColors } from '/lib/color-extraction.js';
import { loadAvatarDataUrl } from '/lib/circle-avatar.js';

// Full-can composite constants, copied from lib/can.js (kept in sync by hand;
// they're authored against a 1024px reference texture). BaseColor is 4096²; the
// band is squashed into the fixed label region while its varying height drives
// the can's Y-stretch separately (see stretchY in the manifest).
const TEXTURE_REF_SIZE = 1024;
const LABEL_BAND_Y = 501;
const LABEL_BAND_HEIGHT = 259;
const BASE_COLOR_URL = '/bennyrizzo - 1950s-spam/textures/BaseColor.png';
const ARTWORK_BASE = '/artworks/';

// Quiescence tuning: a setArtwork() kicks off a burst of async draws (SVG layer
// rasters, background pattern, anchoring + smiths renders, and a second
// medallion draw once the avatar fetch resolves). We treat the band as "settled"
// once draws have gone quiet for QUIET_MS after at least one draw, capped by
// HARD_MAX_MS so a slow/hung avatar fetch can't stall the batch.
const QUIET_MS = 250;
const HARD_MAX_MS = 8000;

let lb = null;        // the single reusable label build (mirrors scene usage)
let baseImg = null;   // BaseColor.png, decoded once and reused

/** Loads an <img> from a (same-origin) URL, resolving once decoded. */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${url}`));
    img.src = url;
  });
}

/**
 * Resolves once the label build's draw stream goes quiet. Must be armed BEFORE
 * the setArtwork() call so the very first synchronous draw is counted.
 */
function waitForSettled() {
  return new Promise((resolve) => {
    let drawCount = 0;
    let quietTimer = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      lb.builder.setOnDraw(null);
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      resolve();
    };
    const hardTimer = setTimeout(finish, HARD_MAX_MS);
    lb.builder.setOnDraw(() => {
      drawCount += 1;
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        if (drawCount > 0) finish();
      }, QUIET_MS);
    });
  });
}

/** Bakes the current label band into a full-size BaseColor decal canvas. */
function compositeFullCan(band) {
  const decal = document.createElement('canvas');
  decal.width = baseImg.naturalWidth;
  decal.height = baseImg.naturalHeight;
  const ctx = decal.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(baseImg, 0, 0, decal.width, decal.height);
  const s = decal.width / TEXTURE_REF_SIZE;
  ctx.drawImage(
    band, 0, 0, band.width, band.height,
    0, LABEL_BAND_Y * s, decal.width, LABEL_BAND_HEIGHT * s,
  );
  return decal;
}

/**
 * Renders one artwork to its band + full-can PNGs.
 * @param {{ filename: string, title: string, author: string, avatarUrl: ?string }} entry
 * @returns {Promise<object>} { bandPngDataUrl, fullPngDataUrl, bandHeight, stretchY, colors, avatarOk } or { error }
 */
window.__prerenderOne = async (entry) => {
  try {
    const image = await loadImage(ARTWORK_BASE + encodeURIComponent(entry.filename));

    // Arm the settle waiter before kicking off the render cascade.
    const settled = waitForSettled();
    const bandHeight = lb.setArtwork({
      image,
      title: entry.title,
      author: entry.author,
      avatarUrl: entry.avatarUrl,
    });
    await settled;

    const band = lb.builder.canvas;
    const decal = compositeFullCan(band);

    // loadAvatarDataUrl memoises per URL, so after the render settled this is a
    // cache hit — accurate avatarOk with no extra network round-trip.
    const avatarDataUrl = await loadAvatarDataUrl(entry.avatarUrl);

    return {
      bandPngDataUrl: band.toDataURL('image/png'),
      fullPngDataUrl: decal.toDataURL('image/png'),
      bandHeight,
      stretchY: bandHeight / REF_HEIGHT,
      // setArtwork derives colours internally but doesn't return them; recompute
      // the same deterministic trio for the manifest.
      colors: deriveColors(image),
      avatarOk: !!avatarDataUrl,
    };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
};

// ---- One-time init: load assets + fonts + BaseColor, build the reusable lb ---
(async () => {
  try {
    const assets = await loadLabelAssets();
    // Pacifico is registered with document.fonts by loadLabelAssets → wait so
    // medallion measureText() is correct from the first artwork.
    await document.fonts.ready;
    baseImg = await loadImage(BASE_COLOR_URL);
    lb = createLabelBuild(assets);
    window.__ready = true;
  } catch (err) {
    window.__initError = String((err && err.message) || err);
  }
})();
