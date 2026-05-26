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
 * (network error, CORS rejection, decode error) so callers can leave the
 * SVG's bundled placeholder in place rather than blanking the medallion.
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

/**
 * Returns Circle.svg with its avatar <image>'s xlink:href replaced by
 * `dataUrl`. If `dataUrl` is null/empty the SVG is returned unchanged so the
 * bundled placeholder remains.
 */
export function injectCircleAvatar(baseSvg, dataUrl) {
  if (!dataUrl) return baseSvg;
  return baseSvg.replace(AVATAR_HREF_RE, `$1${escapeXmlAttr(dataUrl)}$2`);
}
