// -----------------------------------------------------------------------------
// Anchoring-facts table — the one *reflowing* Decal element.
//
// Every other element on the Decal is a flat vector SVG that can only scale. The
// old "Anchoring facts.svg" was the same: 812 KB of outlined paths, so stretching
// the band squashed the whole table. This renders the live HTML version instead
// (elements/anchoring-facts.html) through an SVG <foreignObject>, so the browser's
// flexbox lays it out at the target length: the left title column stays fixed and
// the right details column stretches, values pinned to the right edge — real
// "Fill container" reflow, not a uniform squash.
//
// On the texture the table is rotated 90° (it wraps the can). Its *length* — the
// natural-orientation width, the reflowing axis — maps to the band height; its
// *thickness* (natural height, content-driven) is fit to a fixed slot. This module
// only turns (length, colours) into an un-rotated raster; label-texture.js owns the
// rotation and placement.
// -----------------------------------------------------------------------------

// Texture-space placement, matching the old "Anchoring facts.svg" (416 wide ×
// 1033 tall at REF_HEIGHT): X is the slot's left edge, THICKNESS the fixed slot
// width, REF_LENGTH the band height the design was authored at.
export const ANCHORING_X = 1856;
export const ANCHORING_THICKNESS = 416;
export const ANCHORING_REF_LENGTH = 1033;

const HTML_FILE = 'anchoring-facts.html';
const LOGO_FILE = 'SM-logo-600-px.png'; // footer logo, referenced by the HTML markup

// The table's authored ink. The flat SVG layers recolour #272727 -> text (paper
// stays white); the table follows the same rule so it matches the rest of the Decal.
const INK = /#272727/gi;

const fetchText = (url) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });

const fetchDataUrl = (url) =>
  fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    })
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        }),
    );

// Rasterise a self-contained SVG string to a decoded <img>. The HTML's only
// sub-resource (the footer logo) is inlined as a data URL, so there's nothing
// external to wait on.
//
// CAVEAT: Chromium taints a canvas as soon as you drawImage() an SVG that
// contains a <foreignObject> — a fixed security policy, independent of resource
// origin. Harmless for the label.html builder (it only *displays* the canvas),
// but a tainted canvas can't be uploaded with WebGL texImage2D, so when the 3D
// scenes start consuming lib/label-texture.js this table will need a taint-free
// path (e.g. pre-baked raster, or drawn as its own non-canvas layer).
const rasterize = (svgText) =>
  new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });

/**
 * Creates the anchoring-facts renderer.
 *
 * @param {object} [opts]
 * @param {string} [opts.basePath] - where the HTML + logo live (default 'elements/').
 * @returns {{ load: () => Promise<void>, render: (length:number, colors:object) => Promise<HTMLImageElement> }}
 */
export function createAnchoringFacts({ basePath = 'elements/' } = {}) {
  let css = null;       // the page's <style> text (selectors not matching our subtree are inert)
  let frameEl = null;   // the .frame template node: logo inlined, --u calibrated
  let ready = false;

  // Reused off-screen node for measuring the table's content height (its thickness)
  // at a given length — <foreignObject> clips overflow, so it must be sized exactly.
  let measureHost = null;
  function spineAt(length) {
    if (!measureHost) {
      measureHost = document.createElement('div');
      measureHost.style.cssText =
        'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
      document.body.appendChild(measureHost);
    }
    measureHost.innerHTML =
      `<style>${css}</style><div style="width:${length}px">${frameEl.outerHTML}</div>`;
    const frame = measureHost.querySelector('.frame');
    return frame ? frame.getBoundingClientRect().height : ANCHORING_THICKNESS;
  }

  async function load() {
    const [html, logoUrl] = await Promise.all([
      fetchText(basePath + HTML_FILE),
      fetchDataUrl(basePath + LOGO_FILE).catch(() => null),
    ]);

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const styleEl = doc.querySelector('style');
    frameEl = doc.querySelector('.frame');
    if (!styleEl || !frameEl) throw new Error('anchoring-facts.html missing <style> or .frame');
    css = styleEl.textContent;

    const logoEl = frameEl.querySelector('.logo');
    if (logoEl && logoUrl) logoEl.setAttribute('src', logoUrl);

    // Pick --u so the table's content height ≈ the fixed slot thickness. The height
    // is linear in --u (in the no-wrap regime), so one probe calibrates it; render()
    // re-measures and the draw step fits the thickness exactly regardless.
    frameEl.style.setProperty('--u', '8px');
    const probe = spineAt(ANCHORING_REF_LENGTH);
    const unit = probe > 0 ? (8 * ANCHORING_THICKNESS) / probe : 8;
    frameEl.style.setProperty('--u', `${unit}px`);

    ready = true;
  }

  function render(length, colors) {
    if (!ready) return Promise.reject(new Error('anchoring-facts not loaded'));
    const L = Math.max(1, Math.round(length));
    const spine = Math.max(1, Math.round(spineAt(L)));
    const ink = (colors && colors.text) || '#272727';
    // XMLSerializer yields well-formed XHTML (self-closed <img/>, xmlns) for the
    // foreignObject; the wrapping div carries the reflow width.
    const frameXml = new XMLSerializer().serializeToString(frameEl);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${spine}">` +
        `<foreignObject x="0" y="0" width="${L}" height="${spine}">` +
          `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0">` +
            `<style>${css.replace(INK, ink)}</style>` +
            `<div style="width:${L}px">${frameXml}</div>` +
          `</div>` +
        `</foreignObject>` +
      `</svg>`;
    return rasterize(svg);
  }

  return { load, render };
}
