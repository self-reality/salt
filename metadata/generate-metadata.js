// -----------------------------------------------------------------------------
// generate-metadata.js — per-NFT metadata generator for the SPAM can artworks.
//
// Sibling to scripts/prerender-textures.js: it reads the SAME dataset the
// prerender uses (queue/most-expensive-artworks.json) and writes a single
// prerender-out/metadata.json, an object map keyed by artwork base (the same
// `base` the prerender manifest stores, e.g. "0009__8815061c__d-sent"). Each
// entry joins manifest.json and the rendered can.
//
// Today it produces one field — `comment`, an LLM museum-style critique (ported
// from the standalone `commenter` project) wrapped in a template with random
// years + a BIP39-word hash. The per-artwork object is designed to grow more
// fields over time (weight, longTailLongevity, amplificationProbability, ...);
// runs merge into existing entries and never clobber sibling keys.
//
// Run:  npm run metadata            (or: node metadata/generate-metadata.js)
// Flags: --limit N  --start I  --force  --model ID
//
// Requires OPENROUTER_API_KEY in .env (see metadata/README.md).
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
  const opts = { limit: Infinity, start: 0, force: false, model: DEFAULT_MODEL };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    if (a === '--limit') opts.limit = parseInt(next(), 10);
    else if (a === '--start') opts.start = parseInt(next(), 10);
    else if (a === '--force') opts.force = true;
    else if (a === '--model') opts.model = next();
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

// ---- main ------------------------------------------------------------------
const opts = parseArgs(process.argv);

if (!API_KEY) {
  console.error('Error: OPENROUTER_API_KEY is not set. Add it to .env (see metadata/README.md).');
  process.exit(1);
}

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

const promptTemplate = readFileSync(PROMPT_FILE, 'utf8');
const commentTemplateFiles = readdirSync(TEMPLATES_DIR).filter((name) => /^comment-.*\.md$/i.test(name));
if (commentTemplateFiles.length === 0) {
  console.error(`Error: no comment-*.md templates found in ${TEMPLATES_DIR}.`);
  process.exit(1);
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

console.log(`Generating metadata for up to ${slice.length} artworks (model: ${opts.model})...\n`);

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
