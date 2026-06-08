# NFT metadata generator

Generates **OpenSea / ERC-721-standard** token metadata for the SPAM can
collection and writes it to a single `prerender-out/metadata.json` — a JSON
**array**, one standard metadata object per artwork, in dataset order. It's
ready to upload to IPFS and serve as the collection's `tokenURI`s with minimal
changes (point `--image-base` at your pinned images' CID).

Each array entry is a standard token object:

```jsonc
{
  "name": "dəˈsent by 0009",          // `${title} by ${artist}`
  "description": "▲ \"dəˈsent\" has…",  // the LLM museum critique (only stateful field)
  "image": "ipfs://<CID>/0009__…d-sent.jpg",
  "external_url": "https://instagram.com/0009",   // artist IG, when present
  "attributes": [ /* OpenSea traits — see below */ ]
}
```

Two layers feed it:

- **deterministic** — everything except `description`. The `name`, `image`, and
  all `attributes` (catalogue facts + the five viral-epidemiology numbers) are
  rebuilt from the dataset on every run, seeded per artwork, so they're stable
  and need no API key (`--metrics-only`).
- **`description`** — an LLM museum-style critique (ported from the standalone
  `commenter` project). The **only** field preserved across runs, so a re-run
  never re-pays for it. Needs `OPENROUTER_API_KEY`; skipped with a warning when
  absent (entries keep an empty `description` until a keyed run fills them).

> OpenSea only renders `name` / `description` / `image` / `animation_url` /
> `external_url` / `attributes`; arbitrary top-level keys are ignored. That's why
> every catalogue value lives inside `attributes` as a `trait_type`/`value`
> (with `display_type` for numbers/dates), not as a bare top-level field.

This runs **next to** `scripts/prerender-textures.js`, not inside it: the LLM
calls are slow and rate-limited, so keeping them in a separate script lets the
heavy Chromium render and the metadata generation run and resume independently.
Both read the same dataset (`queue/most-expensive-artworks.json`) and write into
the same `prerender-out/` folder.

## Setup

1. Install deps (adds `dotenv`):

   ```sh
   npm install
   ```

2. Create a `.env` in the repo root with your OpenRouter key:

   ```
   OPENROUTER_API_KEY=sk-or-v1-...
   ```

   `.env` is gitignored — never commit the key.

## Run

```sh
npm run metadata                 # whole collection (resumes; skips ones already described)
npm run metadata -- --limit 2    # only the first 2 artworks get a description this run
node metadata/generate-metadata.js --start 50 --limit 10
node metadata/generate-metadata.js --force                       # regenerate existing descriptions
node metadata/generate-metadata.js --metrics-only                # assemble the array, no LLM
node metadata/generate-metadata.js --image-base ipfs://bafy.../  # set the real images CID
```

Flags (mirror the prerender's ergonomics):

| Flag | Default | Meaning |
| --- | --- | --- |
| `--limit N` | ∞ | Generate descriptions for at most N artworks this run (does **not** limit the array — the file always holds the whole collection) |
| `--start I` | 0 | Skip the first I artworks when choosing which get a description (dataset order) |
| `--force` | off | Regenerate a description even if one already exists |
| `--model ID` | `qwen/qwen3-235b-a22b` | OpenRouter model (alt: `moonshotai/kimi-k2.5`) |
| `--models A,B` | — | Rotate models across generations (splits the run evenly) |
| `--max-comments N` | ∞ | Cap newly generated descriptions this run |
| `--metrics-only` | off | Assemble the array without the LLM pass (no API key needed) |
| `--image-base S` | `ipfs://REPLACE_WITH_IMAGES_CID/` | Prefix for each `image` URI; the artwork's `localFilename` is appended (keep the trailing slash) |

The script saves incrementally (every 10 descriptions) and on `Ctrl-C`, so partial
runs are never lost. Re-running resumes — any artwork that already has a
`description` is skipped unless `--force` is passed.

## How it works

1. Reads `queue/most-expensive-artworks.json` (the prerender's dataset).
2. Validates each entry with `lib/dataset.js::buildEntryFromDatasetItem`, so the
   collection matches exactly the artworks the prerender renders.
3. Assembles every valid artwork into an OpenSea metadata object
   (`buildOpenSeaEntry`) — deterministic `name`/`image`/`attributes`, with the
   description pulled from the prior file (or left empty).
4. For the artworks selected by `--start`/`--limit` that still lack a
   description, builds a prompt from `templates/prompt.md` + the artist's
   `{username, fullName, bio}` and the artwork's `{name, description, tags}`,
   sends it to OpenRouter, and drops the response into a randomly chosen template
   (`templates/comment-1.md`, `-2`, `-3`) with random years and a three-word
   BIP39 hash (`bip39-english.js`).
5. Writes the whole array to `prerender-out/metadata.json` (the new description
   becomes that entry's `description`).

## Output shape

`prerender-out/metadata.json` is a JSON **array** of OpenSea token objects, in
dataset order. Each object: `name`, `description`, `image`, optional
`external_url`, and `attributes`.

```json
[
  {
    "name": "dəˈsent by 0009",
    "description": "▲\n\"dəˈsent\" has endured the technological singularity…",
    "image": "ipfs://bafy…/0009__8815061c__d-sent.jpg",
    "external_url": "https://instagram.com/0009",
    "attributes": [
      { "trait_type": "Artist", "value": "0009" },
      { "trait_type": "Date created", "value": 1674193163, "display_type": "date" },
      { "trait_type": "Net weight (KB)", "value": 39834, "display_type": "number" },
      { "trait_type": "Original size", "value": "9,00x11,37 Kpx" },
      { "trait_type": "Amplification probability", "value": 44, "display_type": "boost_percentage" },
      { "trait_type": "Recognition decay (pp)", "value": 3, "display_type": "number" },
      { "trait_type": "Long-tail longevity (yr)", "value": 104, "display_type": "number" },
      { "trait_type": "R0 boost spike", "value": 2.8, "display_type": "number" },
      { "trait_type": "R0 boost steady", "value": 1.3, "display_type": "number" },
      { "trait_type": "Origin contract", "value": "0x8f19032938E53076d000e639Cf087C268b45fDc2" },
      { "trait_type": "Origin token ID", "value": "1" }
    ]
  }
]
```

### Putting it on IPFS / OpenSea

1. Pin the images, get their directory CID, and re-run with
   `--image-base ipfs://<images-CID>/` so each `image` resolves.
2. Split this array into per-token files (`0`, `1`, … matching your `tokenId`s)
   and pin that folder; set the contract's `baseURI` to its CID so
   `tokenURI(n) = ipfs://<metadata-CID>/n`. (This script emits the collection as
   one array; the split/upload happens in the separate IPFS project.)

### The `attributes`

| Trait | Source | display_type | Notes |
| --- | --- | --- | --- |
| `Artist` | `valid.username` | — | Creator handle. |
| `Date created` | `chaindata.createdAt` (Unix s; ISO fallback) | `date` | Mint time. |
| `Net weight (KB)` | `valid.sizeKb` | `number` | Rounded integer kilobytes. |
| `Original size` | `valid.width` × `valid.height` | — | `formatDimensions` → `"9,00x11,37 Kpx"`. |
| `Amplification probability` | metric | `boost_percentage` | 5–60%. |
| `Recognition decay (pp)` | metric | `number` | 2–15 percentage points. |
| `Long-tail longevity (yr)` | metric | `number` | 20–140 years. |
| `R0 boost spike` | metric | `number` | 1–4. |
| `R0 boost steady` | metric | `number` | 0.8–1.5. |
| `Origin contract` / `Origin token ID` | `valid.contractAddress` / `valid.tokenId` | — | Provenance of the source SuperRare NFT (not this token's own contract). |

## The viral-epidemiology metrics

Five numbers (the "Anchoring facts" sticker), computed by `computeMetrics()` in
`generate-metadata.js` from each artwork's pooled social reach (artist `creator` +
original `owner` followers/following), market price, and age, plus seeded jitter,
then surfaced as the metric `attributes` above:

| Metric | Units | Range | Meaning |
| --- | --- | --- | --- |
| R0 boost spike | × (dimensionless) | 1–4 | R₀ boost in the first weeks post-mint. *Derived from* amplification: `P·(follower base entering carrier pool) + baseline`. |
| R0 boost steady | × (dimensionless) | 0.8–1.5 | Long-run R₀ boost (≥12 mo). *Derived from* long tail via carrier-duration geometric lift, pivoted at the 65yr → ×1.1 reference. |
| Long-tail longevity | years | 20–140 | Extension to the work's referenceability half-life. |
| Amplification probability | percent | 5–60 | P(artist publicly propagates the can-form within ~30 days of mint). |
| Recognition decay | percentage points | 2–15 | Drop in identification rate, original → can-textured version. |

The three primary metrics lerp across their full range from two composite drivers
— `spreadDrive` (reach + market + follower:following) and `persistDrive` (market +
age + reach) — which are stretched and jittered so the ranges are genuinely
reachable, giving a natural spread (e.g. Spike median ≈2.0 with occasional 4.0).
Normalization bounds are calibrated to the dataset's ~p5–p95, so the signals span
[0,1] rather than clustering. Spike/Steady are derived from the primaries.
Decay shares `persistDrive` with longevity (inverted), so across the set long tail
⇒ low decay (corr ≈ −0.9), with per-row jitter for natural noise.

**Deterministic.** All randomness is seeded from the stable `base` key
(xmur3 → mulberry32), so re-runs are idempotent — the same artwork always yields
byte-identical metrics, with zero spurious diffs. Every input is null/zero-safe
(neutral ≈ 0.5 fallbacks), so missing `following`/`price`/`followers` still produce
in-range values.

## Adding future traits

Add a `attributes.push({ trait_type, value, display_type? })` inside
`buildOpenSeaEntry()` in `generate-metadata.js`. Use `display_type: 'number'` /
`'boost_percentage'` / `'date'` for numeric/percentage/timestamp values so
OpenSea renders and ranks them natively; omit it for plain string traits. Because
attributes are deterministic, they're rebuilt every run — no migration needed.
