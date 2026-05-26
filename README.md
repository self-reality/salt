# Spam Can Viewer

A simple 3D viewer for a Spam can model, built with Three.js. Loads an FBX model and PBR textures from the `bennyrizzo - 1950s-spam` folder.

## How to run

The app uses ES modules and loads local files (FBX, textures), so it must be served over HTTP. Opening `index.html` directly in the browser (`file://`) will not work.

### Python (no install if you have Python)

From the project root:

```bash
# Python 3
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser.


After the server is running, open the given URL in your browser to view the 3D Spam can. Use the mouse to orbit, zoom, and pan.

## Scenes

The scene is chosen by the `?scene=` query parameter. **If `?scene` is omitted (or set to an unrecognized value), the `van-can` scene is shown by default.**

| `?scene` value | URL | Description |
|----------------|-----|-------------|
| _(none)_ or `van-can` | `http://localhost:8000/` | **Default.** Spam can flying out of an apocalyptic van, cycling through artworks; layout adapts between wide and narrow viewports. |
| `queue-1` | `http://localhost:8000/?scene=queue-1` | Full-screen can that cycles rapidly through artworks. |
| `test` | `http://localhost:8000/?scene=test` | Full controls UI for tweaking lighting, stretch, and the pixel-art effect. |

## Label builder

`label.html` (driven by `label.js`) is a standalone, no-THREE page for developing the label-band texture in isolation. Open **http://localhost:8000/label.html** to pick an artwork, derive label colours, and drag the band height; the 3D scenes import `lib/label-texture.js` to render the same texture.

The builder composites the Decal from its individual element SVGs in `elements/svg elements/` (header, Smiths blurb, logo medallion, footer pill, datamatrix, …), each recoloured to the palette and placed as an *anchored layer* — so as the artwork-driven band height changes, every element holds its shape instead of stretching. Each element's anchor (`top` / `bottom` / `center` / `stretch`) is set in the `LAYERS` manifest in `lib/label-texture.js`, derived by diffing the two reference heights `elements/Decal-1.svg` (4096×1032) and `elements/Decal-2.svg` (4096×1690).

The **Anchoring-facts table** is the exception: instead of a flat SVG (which could only scale), it's rendered live from `elements/anchoring-facts.html` through an SVG `<foreignObject>` (see `lib/anchoring-facts.js`). The table's length maps to the band height, so as the band grows the right details column *reflows* to fill it — values stay pinned to the right edge — rather than the whole table stretching. Open it standalone at **http://localhost:8000/elements/anchoring-facts.html**.
