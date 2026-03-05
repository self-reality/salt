# Spam Can Viewer

A simple 3D viewer for a Spam can model, built with Three.js. Loads an FBX model and PBR textures from the `bennyrizzo - 1950s-spam` folder.

## How to run

The app uses ES modules and loads local files (FBX, textures), so it must be served over HTTP. Opening `index.html` directly in the browser (`file://`) will not work.

### Option 1: Python (no install if you have Python)

From the project root:

```bash
# Python 3
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser.

### Option 2: Node.js (npx)

If you have Node.js installed:

```bash
npx serve
```

Or with `http-server`:

```bash
npx http-server -p 3000
```

Then open the URL shown in the terminal (e.g. **http://localhost:3000**).

### Option 3: PHP

```bash
php -S localhost:8000
```

Then open **http://localhost:8000**.

---

After the server is running, open the given URL in your browser to view the 3D Spam can. Use the mouse to orbit, zoom, and pan.

## Scenes

Select a scene via the `?scene=` query parameter:

| URL | Scene |
|-----|-------|
| `http://localhost:8000/` | Queue scene (default) — cycles through artworks automatically |
| `http://localhost:8000/?scene=queue-1` | Same as above |
| `http://localhost:8000/?scene=test` | Test scene — full controls UI for tweaking lighting, stretch, and pixel art effect |
