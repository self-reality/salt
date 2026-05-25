# Vendored: node-vibrant 4.0.4 (browser build)

Local copy of the [`node-vibrant`](https://github.com/Vibrant-Colors/node-vibrant)
browser module graph, used by `lib/vibrant-method.js` (the "Vibrant.js" label
colour method). Vendored so that method never depends on a live CDN at runtime —
matching the design note in `lib/vibrant-method.js` / `label.js` that an
unreachable CDN must not break colour derivation.

**Entry point:** `node-vibrant-browser.mjs` — exports `{ Vibrant }`, identical to
the upstream `node-vibrant/browser` entry. Import it with a relative path; no
import map is needed.

## Provenance

Downloaded from esm.sh on 2026-05-25, pinned to `node-vibrant@4.0.4` and its
`@vibrant/*@4.0.4` sub-packages (all `es2022` builds). Every file is the
unmodified esm.sh output **except** that import/export specifiers were rewritten
from esm.sh URLs to local relative filenames. The `*.shim.mjs` files are esm.sh's
thin re-export wrappers (kept because they carry side-effect registrations).

`//# sourceMappingURL=` comments point at `.map` files that were not vendored;
they are inert (the browser simply skips absent sourcemaps).

## Regenerating / upgrading

These files are machine-generated — don't hand-edit them. To refresh or bump the
version, re-run the recursive fetch-and-rewrite vendorer that produced them
(walks the graph from `https://esm.sh/node-vibrant@<version>/browser`, rewrites
every specifier to a local filename). See the project history for the script.
