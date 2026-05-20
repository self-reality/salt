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

The scene is chosen by the `?scene=` query parameter. **If `?scene` is omitted (or set to an unrecognized value), the `landing` scene is shown by default.**

| `?scene` value | URL | Description |
|----------------|-----|-------------|
| _(none)_ or `landing` | `http://localhost:8000/` | **Default.** Scrollable landing page with the auto-rotating Spam can behind the content, cycling through artworks. |
| `queue-1` | `http://localhost:8000/?scene=queue-1` | Full-screen can that cycles rapidly through artworks. |
| `van-can` | `http://localhost:8000/?scene=van-can` | Spam can flying out of an apocalyptic van, cycling through artworks; layout adapts between wide and narrow viewports. |
| `test` | `http://localhost:8000/?scene=test` | Full controls UI for tweaking lighting, stretch, and the pixel-art effect. |
