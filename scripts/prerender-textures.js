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
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    if (a === '--limit') opts.limit = parseInt(next(), 10);
    else if (a === '--start') opts.start = parseInt(next(), 10);
    else if (a === '--force') opts.force = true;
    else if (a === '--concurrency') opts.concurrency = Math.max(1, parseInt(next(), 10));
    else if (a === '--port') opts.port = parseInt(next(), 10);
    else if (a === '--out') opts.out = path.resolve(next());
    else if (a === '--outputs') {
      opts.outputs = next().split(',').map((s) => s.trim()).filter(Boolean);
      const bad = opts.outputs.filter((o) => !ALL_OUTPUTS.includes(o));
      if (bad.length) throw new Error(`unknown --outputs value(s): ${bad.join(', ')} (valid: ${ALL_OUTPUTS.join(', ')})`);
      if (!opts.outputs.length) throw new Error('--outputs needs at least one value');
    } else throw new Error(`unknown flag: ${a}`);
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
  const specs = opts.outputs.map((o) => OUTPUT_SPEC[o]);
  for (const spec of specs) await fs.mkdir(path.join(opts.out, spec.dir), { recursive: true });

  // Reuse lib/dataset.js's validator/mapper so entries match the scenes exactly.
  const { buildEntryFromDatasetItem } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'lib', 'dataset.js')).href
  );
  const dataset = JSON.parse(await fs.readFile(DATASET_PATH, 'utf8'));
  const items = dataset
    .map(buildEntryFromDatasetItem)
    .filter(Boolean) // drop entries missing required fields
    .slice(opts.start, opts.start + opts.limit);

  // Preserve prior manifest entries (resumability) keyed by base name.
  const prior = new Map();
  try {
    const old = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    for (const e of old.entries || []) prior.set(e.base, e);
  } catch (_) { /* no prior manifest */ }

  const server = await startServer(opts.port);
  const pageUrl = `http://127.0.0.1:${opts.port}/scripts/prerender.html`;
  console.log(`serving ${REPO_ROOT} at ${pageUrl}`);
  console.log(`rendering ${items.length} artwork(s) → ${opts.out} (concurrency ${opts.concurrency})`);
  console.log(`outputs: ${opts.outputs.join(', ')}`);
  if (opts.outputs.includes('model-textured')) {
    console.log('note: model-textured GLBs are ~5-6 MB each (base texture dominates).');
  }
  console.log('');

  const browser = await launchBrowser();

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

        // Base manifest entry shared by skip/render/error paths; every output
        // field starts null and is filled when that file lands.
        const entry = {
          localFilename: item.filename, base, title: item.name, author: item.username,
          avatarUrl: item.avatar, width: item.width, height: item.height,
        };
        for (const o of ALL_OUTPUTS) entry[OUTPUT_SPEC[o].field] = null;

        // Skip only when ALL selected outputs already exist.
        if (!opts.force && (await Promise.all(targets.map((t) => fileExists(t.abs)))).every(Boolean)) {
          const kept = prior.get(base);
          for (const t of targets) entry[t.spec.field] = t.rel;
          results[i] = kept ? { ...kept, ...entry, skipped: true } : { ...entry, skipped: true };
          skipCount += 1;
          console.log(`${label} — skipped (exists)`);
          continue;
        }

        const t0 = Date.now();
        const r = await page.evaluate(
          (e, outs) => window.__prerenderOne(e, outs),
          { filename: item.filename, title: item.name, author: item.username, avatarUrl: item.avatar, sizeKb: item.sizeKb, width: item.width, height: item.height },
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
