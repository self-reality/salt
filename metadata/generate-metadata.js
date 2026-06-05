// -----------------------------------------------------------------------------
// generate-metadata.js — per-NFT metadata generator for the SPAM can artworks.
//
// Sibling to scripts/prerender-textures.js: it reads the SAME dataset the
// prerender uses (queue/most-expensive-artworks.json) and writes a single
// prerender-out/metadata.json, an object map keyed by artwork base (the same
// `base` the prerender manifest stores, e.g. "0009__8815061c__d-sent"). Each
// entry joins manifest.json and the rendered can.
//
// It produces two kinds of fields per artwork, merged into one object that never
// clobbers sibling keys:
//   1. `metrics` — five viral-epidemiology numbers (R₀ boost spike/steady,
//      added long-tail longevity, amplification probability, recognition decay)
//      derived from the artwork's social + market signals plus seeded randomness.
//      Pure/local, deterministic per `base`, and NOT gated by the LLM/API key.
//   2. `comment` — an LLM museum-style critique (ported from the standalone
//      `commenter` project) wrapped in a template with random years + a BIP39
//      hash. Needs OPENROUTER_API_KEY; skipped (with a warning) when absent.
//
// Run:  npm run metadata            (or: node metadata/generate-metadata.js)
// Flags: --limit N  --start I  --force  --model ID  --metrics-only
//
// Comments require OPENROUTER_API_KEY in .env (see metadata/README.md); the
// metrics pass runs without it (use --metrics-only to skip comments entirely).
// -----------------------------------------------------------------------------

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import { BIP39_WORDS } from './bip39-english.js';
import { buildEntryFromDatasetItem } from '../lib/dataset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATASET_PATH = path.join(REPO_ROOT, 'queue', 'most-expensive-artworks.json');
const OUT_DIR = path.join(REPO_ROOT, 'prerender-out');
const METADATA_PATH = path.join(OUT_DIR, 'metadata.json');
const PROMPT_FILE = path.join(__dirname, 'templates', 'prompt.md');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// const DEFAULT_MODEL = 'moonshotai/kimi-k2.5';
const DEFAULT_MODEL = 'deepseek/deepseek-v3.2';
const API_KEY = process.env.OPENROUTER_API_KEY;
const SAVE_EVERY = 10; // flush metadata.json every N generated entries

// ---- CLI -------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { limit: Infinity, start: 0, force: false, model: DEFAULT_MODEL, metricsOnly: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    if (a === '--limit') opts.limit = parseInt(next(), 10);
    else if (a === '--start') opts.start = parseInt(next(), 10);
    else if (a === '--force') opts.force = true;
    else if (a === '--model') opts.model = next();
    else if (a === '--metrics-only') opts.metricsOnly = true;
    else throw new Error(`unknown flag: ${a}`);
  }
  return opts;
}

// ---- small helpers (ported verbatim from commenter/generate-comment.js) ------
function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateHash() {
  return [randomFrom(BIP39_WORDS), randomFrom(BIP39_WORDS), randomFrom(BIP39_WORDS)].join('-');
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Strip the extension to get the manifest's `base` join key.
function baseFromFilename(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

// Reduce a creator's instagram URL (or username fallback) to a bare handle.
function instagramHandle(creator) {
  const raw = creator?.instagram || creator?.username || '';
  return raw.split('?')[0].replace(/\/+$/, '').split('/').pop() || creator?.username || '';
}

// ---- viral-epidemiology metrics (pure, seeded per artwork) -----------------
// Five per-artwork numbers baked into metadata for the can's "Anchoring facts"
// sticker. All randomness is SEEDED from the stable `base` key (never
// Math.random) so re-runs are idempotent — same input, byte-identical output,
// zero spurious diffs. See metadata/README.md for the model and field units.

// xmur3 string hash → a 32-bit seed generator.
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
// mulberry32 PRNG → deterministic floats in [0, 1).
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const log10 = (x) => Math.log(x) / Math.LN10;

// Clamp to [min,max] and round to `decimals` places.
function clampRound(min, max, value, decimals = 0) {
  const v = Math.max(min, Math.min(max, value));
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

const SECONDS_PER_YEAR = 31557600; // 365.25 d

// Compute the five viral-epidemiology metrics for one raw dataset entry.
// "Combined reach everywhere": artist (creator) + owner social are pooled into a
// single reach signal feeding every metric; price + age are modifiers. Every
// input may be missing/null → neutral (~0.5) fallbacks keep outputs in range.
function computeMetrics(raw, base, nowSec) {
  const creator = raw?.creator || {};
  const owner = raw?.owner || {};
  const chain = raw?.chaindata || {};

  const followersPool = (numOrNull(creator.followers) || 0) + (numOrNull(owner.followers) || 0);
  const followingPool = (numOrNull(creator.following) || 0) + (numOrNull(owner.following) || 0);
  const price = numOrNull(chain.highestPriceUsd);
  const createdAt = numOrNull(chain.createdAt);

  // --- normalized signals, calibrated to the dataset's ~p5–p95 so each spans
  //     [0,1] instead of clustering at 0.5 (the raw inputs are bunched: median
  //     pooled followers ≈360, median price ≈$9k). All null/zero-safe → neutral.
  const ratio = followingPool > 0 ? followersPool / followingPool : null;
  const reach = followersPool > 0 ? clamp01((log10(followersPool) - 1.9) / 1.3) : 0.5;  // ~80 .. ~1600 pooled
  const kFactor = ratio != null ? clamp01(log10(ratio) / 1.3) : 0.5;                    // followers:following 1 .. ~20
  const market = price && price > 0 ? clamp01((log10(price) - 3.2) / 1.7) : 0.5;        // ~$1.6k .. ~$80k
  const ageYears = createdAt ? Math.max(0, (nowSec - createdAt) / SECONDS_PER_YEAR) : null;
  const ageNorm = ageYears == null ? 0.3 : clamp01((ageYears - 1.0) / 5.0);             // 1 .. 6 yr

  // --- seeded RNG: deterministic per artwork `base`, drawn in a fixed order ---
  const rng = mulberry32(xmur3(base)());
  const jitAdd = (frac) => (rng() - 0.5) * 2 * frac;   // additive: ±frac of a metric's range
  // Stretch a 0..1 drive around its midpoint so the full target ranges are
  // actually reachable (the bunched inputs alone never reach the extremes).
  const stretch = (x, k = 1.5) => clamp01(0.5 + (x - 0.5) * k);
  // Lerp a stretched drive across [lo,hi] with additive jitter, then clamp+round.
  const mapRange = (lo, hi, drive, jf, decimals = 0) =>
    clampRound(lo, hi, lo + (hi - lo) * drive + jitAdd(jf) * (hi - lo), decimals);

  // --- composite drivers ("combined reach everywhere") ---
  const spreadDrive = stretch(0.50 * reach + 0.30 * market + 0.20 * kFactor);   // burst potential
  const persistDrive = stretch(0.45 * market + 0.35 * ageNorm + 0.20 * reach);  // staying power

  // --- primary metrics: lerp across the FULL target range for a natural spread ---
  const amplificationProbability = mapRange(5, 60, spreadDrive, 0.18);
  const longTailLongevity        = mapRange(20, 140, persistDrive, 0.18);
  // Decay shares persistDrive with longevity but inverted → long tail ⇒ low decay.
  const recognitionDecay         = mapRange(2, 15, stretch(1 - persistDrive), 0.18);

  // --- derived R₀ boost components (from the primary three, per the lore) ---
  // Spike (1–4): P(amp)·(follower base entering the carrier pool) + baseline,
  // jittered. The rare ~4× burst needs both high amplification and high reach.
  const P = amplificationProbability / 100;
  const r0BoostSpike = clampRound(1, 4, 1.0 + P * (0.8 + 5.0 * reach) + jitAdd(0.07) * 3.0, 1);
  // Steady (0.8–1.5): from R₀ = β·D, carrier duration D = 10yr baseline + long
  // tail. The geometric lift (D/10)^0.3, pivoted around the 65yr reference
  // (→ ×1.1) and damped (active propagation decays faster than awareness), maps
  // the long tail onto a sticky long-run multiplier.
  const geomLift = ((10 + longTailLongevity) / 10) ** 0.3;
  const geomLiftRef = ((10 + 65) / 10) ** 0.3;
  const r0BoostSteady = clampRound(0.8, 1.5, 1.1 + (geomLift - geomLiftRef) * 0.85, 1);

  return {
    r0BoostSpike,
    r0BoostSteady,
    longTailLongevity,
    amplificationProbability,
    recognitionDecay,
  };
}

// ---- main ------------------------------------------------------------------
const opts = parseArgs(process.argv);

const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf8'));

// Validate + align with the prerender: only artworks the prerender would render
// (valid username/name/localFilename/dimensions) get metadata, in dataset order.
const entries = [];
for (const raw of dataset) {
  const valid = buildEntryFromDatasetItem(raw);
  if (valid) entries.push({ valid, raw });
}
const slice = entries.slice(opts.start, opts.start + opts.limit);

// Load existing metadata map (so we merge instead of overwrite).
let metadata = {};
if (existsSync(METADATA_PATH)) {
  try {
    metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
  } catch {
    metadata = {};
  }
}

function save() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2));
}

function saveAndExit(exitCode = 0) {
  save();
  console.log(`\nSaved ${Object.keys(metadata).length} total metadata entries to ${path.relative(REPO_ROOT, METADATA_PATH)}.`);
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  console.log('\nInterrupted — saving progress...');
  saveAndExit(0);
});

// ---- metrics pass: pure, local, ungated by the LLM/API key -----------------
// Runs first so `--metrics-only` (or any run without an API key) still bakes the
// viral-epidemiology numbers. Deterministic per `base`, so recomputing is always
// safe; entries that already have `metrics` are left alone unless --force.
const nowSec = Math.floor(Date.now() / 1000);
let metricsWritten = 0;
for (const { valid, raw } of slice) {
  const base = baseFromFilename(valid.filename);
  if (!opts.force && metadata[base]?.metrics) continue;
  metadata[base] = {
    ...metadata[base],
    localFilename: valid.filename,
    metrics: computeMetrics(raw, base, nowSec),
  };
  metricsWritten += 1;
}
save();
console.log(`Metrics: wrote ${metricsWritten} of ${slice.length} entries → ${path.relative(REPO_ROOT, METADATA_PATH)}.`);

if (opts.metricsOnly) saveAndExit(0);

if (!API_KEY) {
  console.warn('\nOPENROUTER_API_KEY not set — metrics written, skipping LLM comments.');
  console.warn('Add it to .env (see metadata/README.md) to generate comments too.');
  saveAndExit(0);
}

// Comment templates (only needed for the LLM pass).
const promptTemplate = readFileSync(PROMPT_FILE, 'utf8');
const commentTemplateFiles = readdirSync(TEMPLATES_DIR).filter((name) => /^comment-.*\.md$/i.test(name));
if (commentTemplateFiles.length === 0) {
  console.error(`Error: no comment-*.md templates found in ${TEMPLATES_DIR}.`);
  process.exit(1);
}

console.log(`\nGenerating comments for up to ${slice.length} artworks (model: ${opts.model})...\n`);

let generated = 0;
for (let i = 0; i < slice.length; i++) {
  const { valid, raw } = slice[i];
  const { creator, metadata: meta } = raw;
  const base = baseFromFilename(valid.filename);
  const title = (meta.name || '').trim();

  // Resume: skip artworks that already have a comment unless --force.
  if (!opts.force && metadata[base]?.comment) {
    console.log(`[${i + 1}/${slice.length}] ${base} — already has comment, skipping`);
    continue;
  }

  const payload = {
    creator: {
      username: creator.username,
      fullName: creator.fullName,
      bio: creator.bio,
    },
    metadata: {
      name: title,
      description: meta.description,
      tags: meta.tags,
    },
  };

  const prompt = promptTemplate + JSON.stringify(payload, null, 2);

  console.log(`[${i + 1}/${slice.length}] Requesting comment for "${creator.username}" (${base})...`);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`OpenRouter API error ${response.status}: ${text}`);
    continue;
  }

  const data = await response.json();
  const llmResponse = data.choices[0].message.content.trim();

  const year1 = randomInt(2027, 2030);
  const year2 = randomInt(year1 + 1, 2036);

  const randomCommentTemplateFile = randomFrom(commentTemplateFiles);
  const commentTemplate = readFileSync(path.join(TEMPLATES_DIR, randomCommentTemplateFile), 'utf8');
  const comment = commentTemplate
    .replaceAll('{{title}}', title)
    .replace('{{llm_response}}', llmResponse)
    .replace('{{year1}}', year1)
    .replace('{{year2}}', year2)
    .replace('{{hash}}', generateHash());

  // Merge into the existing per-artwork object so future fields survive.
  metadata[base] = {
    ...metadata[base],
    localFilename: valid.filename,
    artist: creator.username,
    instagram: instagramHandle(creator),
    comment,
  };

  console.log(`         Artwork: ${title}`);
  console.log(comment);
  console.log('');

  generated += 1;
  if (generated % SAVE_EVERY === 0) save();
}

saveAndExit(0);
