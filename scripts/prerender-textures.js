// -----------------------------------------------------------------------------
// prerender-textures.js — standalone batch prerenderer for SPAM can textures.
//
// For each artwork in queue/most-expensive-artworks.json this:
//   1. serves the repo over a local static HTTP server (so artworks + base texture
//      are same-origin and the canvas never taints),
//   2. drives a headless Chromium page (scripts/prerender.html) that reuses the
//      live label pipeline to composite the label band and the full can base texture,
//   3. writes both PNGs to prerender-out/ plus an incremental manifest.json.
//
// Run:  npm run prerender            (or: node scripts/prerender-textures.js)
// Flags: --limit N  --start I  --force  --concurrency N  --port P  --out DIR
//        --probe                (render the CONTROLLED PROBE set instead: reads
//                                queue/probe-artworks.json, loads images from
//                                artworks/probe/, writes to prerender-out-probe/
//                                — probe artifacts never mix with the real
//                                collection's dataset, artworks or outputs)
//        --band-resolution PX   (label band canvas width; default 4096)
//        --texture-size PX      (full-can / model base-color map size; default:
//                                source salt-bitmap.png size, 4096²)
//        --strip-shared-maps    (model-textured GLBs omit the metallic/roughness/
//                                normal maps — identical in every can — and the
//                                maps land once in <model-textured dir>/shared-maps/
//                                for the runtime to reattach; ~260 KB less per GLB)
//        --basecolor-format F   (png | jpeg; embedded base-color encoding for
//                                model-textured GLBs. jpeg is ~3-5x smaller;
//                                default png)
// -----------------------------------------------------------------------------

import http from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATASET_PATH = path.join(REPO_ROOT, 'queue', 'most-expensive-artworks.json');
const PROBE_DATASET_PATH = path.join(REPO_ROOT, 'queue', 'probe-artworks.json');
const PROBE_OUT = path.join(REPO_ROOT, 'prerender-out-probe');
const BASE_TEXTURE_REL = 'bennyrizzo - 1950s-spam/textures/salt-bitmap.png';

// Per-output spec: which page result key carries the base64 blob, where it's
// written (subdir + extension) and the manifest field that records its path.
const OUTPUT_SPEC = {
  band:             { dir: 'bands',           ext: '.png', key: 'bandPngDataUrl',         field: 'band' },
  texture:          { dir: 'cans',            ext: '.png', key: 'fullPngDataUrl',         field: 'texture' },
  model:            { dir: 'models',          ext: '.glb', key: 'modelGlbB64',            field: 'model' },
  'model-textured': { dir: 'models-textured', ext: '.glb', key: 'modelTexturedGlbB64',   field: 'modelTextured' },
};
const ALL_OUTPUTS = Object.keys(OUTPUT_SPEC);

// ---- CLI -------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    limit: Infinity, start: 0, force: false, concurrency: 1,
    port: 8970, out: path.join(REPO_ROOT, 'prerender-out'),
    outputs: [...ALL_OUTPUTS],
    // null = keep the pipeline defaults (band: 4096; texture: source PNG size).
    bandResolution: null, textureSize: null,
    stripSharedMaps: false, basecolorFormat: 'png',
    probe: false, dataset: DATASET_PATH, artworkBase: null,
  };
  let outExplicit = false;
  const posInt = (raw, flag) => {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} needs a positive integer (got: ${raw})`);
    return n;
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    if (a === '--limit') opts.limit = parseInt(next(), 10);
    else if (a === '--start') opts.start = parseInt(next(), 10);
    else if (a === '--force') opts.force = true;
    else if (a === '--concurrency') opts.concurrency = Math.max(1, parseInt(next(), 10));
    else if (a === '--port') opts.port = parseInt(next(), 10);
    else if (a === '--band-resolution') opts.bandResolution = posInt(next(), '--band-resolution');
    else if (a === '--texture-size') opts.textureSize = posInt(next(), '--texture-size');
    else if (a === '--strip-shared-maps') opts.stripSharedMaps = true;
    else if (a === '--basecolor-format') {
      opts.basecolorFormat = next();
      if (!['png', 'jpeg'].includes(opts.basecolorFormat)) {
        throw new Error(`--basecolor-format must be png or jpeg (got: ${opts.basecolorFormat})`);
      }
    }
    else if (a === '--out') { opts.out = path.resolve(next()); outExplicit = true; }
    else if (a === '--probe') opts.probe = true;
    else if (a === '--outputs') {
      opts.outputs = next().split(',').map((s) => s.trim()).filter(Boolean);
      const bad = opts.outputs.filter((o) => !ALL_OUTPUTS.includes(o));
      if (bad.length) throw new Error(`unknown --outputs value(s): ${bad.join(', ')} (valid: ${ALL_OUTPUTS.join(', ')})`);
      if (!opts.outputs.length) throw new Error('--outputs needs at least one value');
    } else throw new Error(`unknown flag: ${a}`);
  }
  // Probe mode: separate dataset in, separate image dir, separate output dir —
  // nothing probe-related ever lands next to the real collection's artifacts.
  if (opts.probe) {
    opts.dataset = PROBE_DATASET_PATH;
    opts.artworkBase = '/artworks/probe/';
    if (!outExplicit) opts.out = PROBE_OUT;
  }
  return opts;
}

// ---- Static file server -----------------------------------------------------
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.fbx': 'application/octet-stream',
};

function startServer(port) {
  const server = http.createServer(async (req, res) => {
    try {
      // Decode (filenames + the "svg elements" dir contain spaces) and strip query.
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? 'scripts/prerender.html' : urlPath.replace(/^\/+/, '');
      const filePath = path.join(REPO_ROOT, rel);
      // Block traversal outside the repo root.
      if (!filePath.startsWith(REPO_ROOT)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size });
      createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// ---- Helpers ----------------------------------------------------------------
const baseName = (filename) => filename.replace(/\.[^.]+$/, '');

function dataUrlToBuffer(dataUrl) {
  const comma = dataUrl.indexOf(',');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

async function fileExists(p) {
  return !!(await fs.stat(p).catch(() => null));
}

/**
 * Launches Chromium. Honours PUPPETEER_EXECUTABLE_PATH, otherwise tries the
 * Puppeteer-bundled browser first and falls back to an installed Google Chrome
 * (channel: 'chrome') — useful when the bundled browser download was skipped.
 */
async function launchBrowser() {
  const args = ['--no-sandbox', '--disable-dev-shm-usage'];
  const exe = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (exe) return puppeteer.launch({ headless: 'new', args, executablePath: exe });
  try {
    return await puppeteer.launch({ headless: 'new', args });
  } catch (err) {
    console.warn(`bundled Chromium unavailable (${err.message}); falling back to installed Chrome`);
    return puppeteer.launch({ headless: 'new', args, channel: 'chrome' });
  }
}

async function newReadyPage(browser, pageUrl) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.warn('  [page error]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.warn('  [console]', m.text());
  });
  await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(
    'window.__ready === true || window.__initError',
    { timeout: 60000 },
  );
  const initError = await page.evaluate(() => window.__initError || null);
  if (initError) throw new Error(`page init failed: ${initError}`);
  return page;
}

// ---- Main -------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv);
  const manifestPath = path.join(opts.out, 'manifest.json');
  const metadataPath = path.join(opts.out, 'metadata.json');
  const specs = opts.outputs.map((o) => OUTPUT_SPEC[o]);
  for (const spec of specs) await fs.mkdir(path.join(opts.out, spec.dir), { recursive: true });

  // Reuse lib/dataset.js's validator/mapper so entries match the scenes exactly.
  const { buildEntryFromDatasetItem } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'lib', 'dataset.js')).href
  );
  const dataset = JSON.parse(await fs.readFile(opts.dataset, 'utf8'));
  const items = dataset
    .map(buildEntryFromDatasetItem)
    .filter(Boolean) // drop entries missing required fields
    .slice(opts.start, opts.start + opts.limit);

  // LLM-generated museum critiques, baked into each can's wrap-around "Smiths"
  // text block. These live in the OpenSea metadata.json (generated separately by
  // metadata/generate-metadata.js), keyed by the image filename's base — the same
  // base name this script writes outputs under. Best-effort: a missing file or a
  // base with no entry falls back to the placeholder text in prerender-page.js.
  const descByBase = new Map();
  try {
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    for (const e of metadata) {
      const fname = String(e?.image || '').split('/').pop() || '';
      const base = baseName(fname);
      if (base && e?.description) descByBase.set(base, e.description);
    }
    console.log(`loaded ${descByBase.size} description(s) from ${path.relative(REPO_ROOT, metadataPath)}`);
  } catch (_) {
    console.warn(`no descriptions at ${path.relative(REPO_ROOT, metadataPath)} — using placeholder Smiths text`);
  }

  // Preserve prior manifest entries (resumability) keyed by base name.
  const prior = new Map();
  try {
    const old = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    for (const e of old.entries || []) prior.set(e.base, e);
  } catch (_) { /* no prior manifest */ }

  const server = await startServer(opts.port);
  // Band resolution + texture size are read once at page init (the label build
  // is created there and reused), so they ride in on the page URL query string.
  const query = new URLSearchParams();
  if (opts.bandResolution != null) query.set('bandResolution', String(opts.bandResolution));
  if (opts.textureSize != null) query.set('textureSize', String(opts.textureSize));
  if (opts.stripSharedMaps) query.set('stripSharedMaps', '1');
  if (opts.basecolorFormat !== 'png') query.set('baseColorFormat', opts.basecolorFormat);
  if (opts.artworkBase) query.set('artworkBase', opts.artworkBase);
  const qs = query.toString();
  const pageUrl = `http://127.0.0.1:${opts.port}/scripts/prerender.html${qs ? `?${qs}` : ''}`;
  console.log(`serving ${REPO_ROOT} at ${pageUrl}`);
  if (opts.probe) console.log(`*** PROBE MODE — dataset ${path.relative(REPO_ROOT, opts.dataset)}, images ${opts.artworkBase} ***`);
  console.log(`rendering ${items.length} artwork(s) → ${opts.out} (concurrency ${opts.concurrency})`);
  console.log(`outputs: ${opts.outputs.join(', ')}`);
  console.log(`band resolution: ${opts.bandResolution ?? '4096 (default)'}px; `
    + `texture size: ${opts.textureSize ?? 'source PNG (4096², default)'}`);
  if (opts.outputs.includes('model-textured')) {
    console.log(`model-textured: base color ${opts.basecolorFormat}, shared maps `
      + `${opts.stripSharedMaps ? 'stripped (written once to shared-maps/)' : 'embedded per GLB'}`);
  }
  console.log('');

  const browser = await launchBrowser();

  // The shared PBR maps are identical across every can, so when stripping them
  // from the GLBs export them exactly once, before the workers start. Goes into
  // the model-textured output dir so a single static mount serves GLBs + maps.
  let sharedMapsRel = null;
  if (opts.stripSharedMaps && opts.outputs.includes('model-textured')) {
    const page = await newReadyPage(browser, pageUrl);
    try {
      const r = await page.evaluate(() => window.__exportSharedMaps());
      if (r && r.error) throw new Error(`shared maps export failed: ${r.error}`);
      const dir = `${OUTPUT_SPEC['model-textured'].dir}/shared-maps`;
      await fs.mkdir(path.join(opts.out, dir), { recursive: true });
      sharedMapsRel = {
        metallicRoughness: `${dir}/metallic-roughness.png`,
        normal: `${dir}/normal.png`,
      };
      await fs.writeFile(path.join(opts.out, sharedMapsRel.metallicRoughness), dataUrlToBuffer(r.metallicRoughnessPngDataUrl));
      await fs.writeFile(path.join(opts.out, sharedMapsRel.normal), dataUrlToBuffer(r.normalPngDataUrl));
      console.log(`shared maps → ${sharedMapsRel.metallicRoughness}, ${sharedMapsRel.normal}\n`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  const results = new Array(items.length);
  let okCount = 0; let skipCount = 0; let errCount = 0; let avatarMiss = 0;
  let cursor = 0;

  // Worker pulls from a shared cursor; each worker owns one ready page.
  async function worker(workerId) {
    const page = await newReadyPage(browser, pageUrl);
    try {
      for (;;) {
        const i = cursor; cursor += 1;
        if (i >= items.length) break;
        const item = items[i];
        const base = baseName(item.filename);
        const label = `[${i + 1}/${items.length}] ${base}`;
        // Per selected output: absolute write path + manifest-relative path.
        const targets = specs.map((spec) => ({
          spec,
          abs: path.join(opts.out, spec.dir, `${base}${spec.ext}`),
          rel: `${spec.dir}/${base}${spec.ext}`,
        }));

        // Base manifest entry shared by skip/render/error paths. Output fields
        // seed from the prior manifest entry (if any) so a single-output run
        // (e.g. --outputs model-textured) doesn't null out paths an earlier run
        // baked; the selected outputs below overwrite with this run's paths.
        const kept = prior.get(base);
        const entry = {
          localFilename: item.filename, base, title: item.name, author: item.username,
          avatarUrl: item.avatar, width: item.width, height: item.height,
        };
        for (const o of ALL_OUTPUTS) entry[OUTPUT_SPEC[o].field] = kept?.[OUTPUT_SPEC[o].field] ?? null;

        // Skip only when ALL selected outputs already exist.
        if (!opts.force && (await Promise.all(targets.map((t) => fileExists(t.abs)))).every(Boolean)) {
          for (const t of targets) entry[t.spec.field] = t.rel;
          results[i] = kept ? { ...kept, ...entry, skipped: true } : { ...entry, skipped: true };
          skipCount += 1;
          console.log(`${label} — skipped (exists)`);
          continue;
        }

        const t0 = Date.now();
        const r = await page.evaluate(
          (e, outs) => window.__prerenderOne(e, outs),
          { filename: item.filename, title: item.name, author: item.username, avatarUrl: item.avatar, sizeKb: item.sizeKb, width: item.width, height: item.height, smithsText: descByBase.get(base) || null },
          opts.outputs,
        );

        if (r && r.error) {
          results[i] = { ...entry, error: r.error };
          errCount += 1;
          console.warn(`${label} — ERROR: ${r.error}`);
          continue;
        }

        for (const t of targets) {
          await fs.writeFile(t.abs, dataUrlToBuffer(r[t.spec.key]));
          entry[t.spec.field] = t.rel;
        }
        if (!r.avatarOk) avatarMiss += 1;
        results[i] = {
          ...entry, avatarOk: r.avatarOk, bandHeight: r.bandHeight,
          stretchY: r.stretchY, colors: r.colors, error: null,
        };
        okCount += 1;
        console.log(
          `${label} — band ${r.bandHeight}px stretchY ${r.stretchY.toFixed(3)} `
          + `avatar ${r.avatarOk ? 'ok' : 'miss'} (${Date.now() - t0}ms)`,
        );

        // Rewrite the manifest periodically so a crash leaves a usable partial.
        if ((okCount + errCount) % 25 === 0) await writeManifest();
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  async function writeManifest() {
    const manifest = {
      generatedAt: new Date().toISOString(),
      baseTexture: BASE_TEXTURE_REL,
      refHeight: 1032,
      sharedMaps: sharedMapsRel,
      count: results.filter(Boolean).length,
      entries: results.filter(Boolean),
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  try {
    const workers = [];
    for (let w = 0; w < Math.min(opts.concurrency, items.length); w += 1) {
      workers.push(worker(w));
    }
    await Promise.all(workers);
    await writeManifest();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(
    `\ndone: ${okCount} rendered, ${skipCount} skipped, ${errCount} errored, `
    + `${avatarMiss} avatar fallback(s). manifest → ${manifestPath}`,
  );
  if (errCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
