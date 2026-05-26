// -----------------------------------------------------------------------------
// Circle avatar injector — swaps Circle.svg's embedded placeholder PNG with the
// current author's avatar. The SALT medallion ships with an 82×85 round
// "avatar slot" in its centre (an ellipse mask over a rect filled by a pattern
// that references an <image id="image0_2102_599">). This module fetches a
// real avatar URL, encodes it as a data URL, and rewrites that <image>'s
// xlink:href so the avatar bakes into the rasterised layer.
//
// Why a data URL: the label-texture rasteriser feeds each element SVG through
// a Blob URL → <img> pipeline. SVGs loaded as <img> aren't allowed to fetch
// external subresources, so the avatar must be embedded into the SVG text.
// -----------------------------------------------------------------------------

export const CIRCLE_FILE = 'Circle.svg';

// Memoise per-URL fetches so cycling back to a previously seen author doesn't
// re-hit the network. Stores the resolved data URL, or null on failure.
const avatarCache = new Map();

/**
 * Fetches an avatar URL and resolves to a data URL. Returns null on failure
 * (network error, CORS rejection, decode error) so injectCircleAvatar falls
 * back to the empty-disc variant instead of leaving the placeholder PNG.
 */
export function loadAvatarDataUrl(url) {
  if (!url) return Promise.resolve(null);
  if (avatarCache.has(url)) return Promise.resolve(avatarCache.get(url));
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      });
    } catch (_) {
      return null;
    }
  })();
  // Cache the resolved value (not the promise) so future cache hits are sync,
  // but still seed the cache early so concurrent requests for the same URL
  // collapse to one fetch.
  avatarCache.set(url, p);
  p.then((v) => avatarCache.set(url, v));
  return p;
}

const escapeXmlAttr = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// The medallion's avatar slot is wired through this single <image> element —
// the pattern (#pattern0_2102_599) references it via xlink:href, and that
// pattern fills the masked rect. Rewriting the image's xlink:href is enough
// to replace the avatar everywhere the medallion uses it.
const AVATAR_HREF_RE =
  /(<image\b[^>]*\bid="image0_2102_599"[^>]*\bxlink:href=")[^"]*(")/;

// Fallback: when there's no avatar, swap the masked rect's pattern fill for a
// plain `fill="white"`. The ellipse mask still clips it to a disc, and the
// medallion's recolour pass in label-texture.js (recolorWhiteInk) then flips
// that white to outline-vs-white ink — the same path the other white glyphs
// on the medallion's outline patch travel, so the empty disc lights up white
// or black for free with the rest of the layer.
const AVATAR_RECT_FILL_RE = /fill="url\(#pattern0_2102_599\)"/;

/**
 * Returns Circle.svg with the avatar slot wired up for `dataUrl`.
 * - When `dataUrl` is set: bakes it into the <image>'s xlink:href.
 * - When `dataUrl` is null/empty: collapses the slot to a plain white disc so
 *   the recolour pass paints it the same as the medallion's other whites.
 */
export function injectCircleAvatar(baseSvg, dataUrl) {
  if (dataUrl) {
    return baseSvg.replace(AVATAR_HREF_RE, `$1${escapeXmlAttr(dataUrl)}$2`);
  }
  return baseSvg.replace(AVATAR_RECT_FILL_RE, 'fill="white"');
}
