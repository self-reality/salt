// -----------------------------------------------------------------------------
// Side-text generator — live <text> for the two vertical decal labels that
// used to be path-outlined SVG fonts (Preserved.svg and Artwork title side.svg).
//
// Each generated SVG keeps the original frame dimensions (so the layer position
// in lib/label-texture.js needs no change) and uses #F8EE46 as the fill sentinel
// — recolorDecalSvg() maps that to the live `text` palette colour, exactly as
// the original outlined paths did. Text is rotated -90° around the centre so it
// reads bottom-to-top, the conventional side-of-can orientation.
//
// Pacifico is fetched once from Google Fonts and embedded into each SVG as a
// data-URL @font-face — required because SVGs rasterised via Blob URL run in
// their own document context and don't see the page's loaded webfonts. If the
// fetch fails (e.g. offline or file:// CORS), text falls back to system cursive.
// -----------------------------------------------------------------------------

const INK = '#F8EE46';      // recolored to `text` by recolorDecalSvg
const PAD = 8;              // inset from each short end of the SVG

const escapeXml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

let pacificoPromise = null;

// Best-effort fetch of the Pacifico woff2 as a data URL. Resolves to null if
// anything along the way fails — generateSideTextSvg then falls back to system
// cursive without breaking the page.
export function loadPacificoDataUrl() {
  if (pacificoPromise) return pacificoPromise;
  pacificoPromise = (async () => {
    try {
      const cssRes = await fetch(
        'https://fonts.googleapis.com/css2?family=Pacifico&display=swap',
      );
      if (!cssRes.ok) return null;
      const css = await cssRes.text();
      const m = css.match(/url\((https:\/\/[^)]+\.woff2)\)/);
      if (!m) return null;
      const fontRes = await fetch(m[1]);
      if (!fontRes.ok) return null;
      const blob = await fontRes.blob();
      return await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      });
    } catch (_) {
      return null;
    }
  })();
  return pacificoPromise;
}

/**
 * Build a side-text SVG. The text is rotated -90° around the centre so it
 * reads bottom-to-top, and textLength forces it to fit the long axis.
 *
 * @param {string} text
 * @param {object} frame                - { width, height, fontSize }
 * @param {string|null} fontDataUrl     - Pacifico woff2 as a data URL, or null
 */
export function generateSideTextSvg(text, frame, fontDataUrl) {
  const { width, height, fontSize } = frame;
  const cx = width / 2;
  const cy = height / 2;
  const maxLen = Math.max(1, height - PAD * 2);
  const fontFace = fontDataUrl
    ? `<style>@font-face{font-family:'Pacifico';` +
      `src:url(${fontDataUrl}) format('woff2');font-display:block;}</style>`
    : '';
  return (
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"` +
    ` fill="none" xmlns="http://www.w3.org/2000/svg">` +
      fontFace +
      `<text x="${cx}" y="${cy}" fill="${INK}"` +
        ` font-family="Pacifico, cursive" font-size="${fontSize}"` +
        ` text-anchor="middle" dominant-baseline="central"` +
        ` textLength="${maxLen}" lengthAdjust="spacingAndGlyphs"` +
        ` transform="rotate(-90, ${cx}, ${cy})">` +
        escapeXml(text) +
      `</text>` +
    `</svg>`
  );
}

// Frame dimensions match the original SVGs so the LAYERS coords in
// lib/label-texture.js don't need to move.
export const PRESERVED_FRAME = { width: 38, height: 156, fontSize: 30 };
export const TITLE_FRAME = { width: 51, height: 390, fontSize: 38 };

export const PRESERVED_FILE = 'Preserved.svg';
export const TITLE_FILE = 'Artwork title side.svg';

export const DEFAULT_PRESERVED_TEXT = 'preserved';
// Curly quotes + double space matching the original artwork-title styling.
export const DEFAULT_TITLE_TEXT = '“Float On”  by oak_arrow';
