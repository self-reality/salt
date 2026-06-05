# NFT metadata generator

Generates per-artwork metadata for the SPAM cans and writes it to a single
`prerender-out/metadata.json`, keyed so each entry joins the prerender
`manifest.json` and the rendered can.

It produces two kinds of per-artwork fields, merged into one object that never
clobbers sibling keys:

- **`metrics`** — five viral-epidemiology numbers (see below), derived locally
  from each artwork's social + market signals plus seeded randomness. Pure and
  **not** gated by the LLM/API key, so they run even with no key (or
  `--metrics-only`).
- **`comment`** — an LLM museum-style critique (ported from the standalone
  `commenter` project). Needs `OPENROUTER_API_KEY`; skipped with a warning when
  absent.

The per-artwork object can still grow more sibling fields (e.g. `weight`) by
later passes the same way.

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
npm run metadata                 # all artworks (resumes; skips ones already done)
npm run metadata -- --limit 2    # first 2 only
node metadata/generate-metadata.js --start 50 --limit 10
node metadata/generate-metadata.js --force          # regenerate existing comments
node metadata/generate-metadata.js --model moonshotai/kimi-k2.5
```

Flags (mirror the prerender's ergonomics):

| Flag | Default | Meaning |
| --- | --- | --- |
| `--limit N` | ∞ | Process at most N artworks |
| `--start I` | 0 | Skip the first I artworks (dataset order) |
| `--force` | off | Regenerate even if a `comment`/`metrics` already exist |
| `--model ID` | `deepseek/deepseek-v3.2` | OpenRouter model (alt: `moonshotai/kimi-k2.5`) |
| `--metrics-only` | off | Compute & write `metrics` only; skip the LLM comment pass (no API key needed) |

The script saves incrementally (every 10 entries) and on `Ctrl-C`, so partial
runs are never lost. Re-running resumes — any artwork that already has a
`comment` is skipped unless `--force` is passed.

## How it works

1. Reads `queue/most-expensive-artworks.json` (the prerender's dataset).
2. Validates each entry with `lib/dataset.js::buildEntryFromDatasetItem`, so the
   metadata set matches exactly the artworks the prerender renders.
3. For each artwork, builds a prompt from `templates/prompt.md` + the artist's
   `{username, fullName, bio}` and the artwork's `{name, description, tags}`, and
   sends it to the OpenRouter chat-completions API.
4. Drops the LLM response into a randomly chosen template
   (`templates/comment-1.md`, `-2`, `-3`) along with random years and a
   three-word BIP39 hash (`bip39-english.js`).
5. Merges the result into `prerender-out/metadata.json` under the artwork's base
   key, preserving any other fields already on that entry.

## Output shape

`prerender-out/metadata.json` is an object keyed by artwork **base** (the
`localFilename` without its extension — the same `base` the prerender
`manifest.json` uses):

```json
{
  "0009__8815061c__d-sent": {
    "localFilename": "0009__8815061c__d-sent.jpg",
    "artist": "0009",
    "instagram": "0009ine",
    "comment": "⟁\n\"dəˈsent\" has survived through the technological singularity…",
    "metrics": {
      "r0BoostSpike": 2.8,
      "r0BoostSteady": 1.3,
      "longTailLongevity": 104,
      "amplificationProbability": 44,
      "recognitionDecay": 3
    }
  }
}
```

Join it to a rendered can via the `base` key (e.g. `manifest.json`'s `base`
field and the PNGs under `bands/` / `cans/` share the same name).

## The `metrics` block

Five viral-epidemiology numbers for the can's "Anchoring facts" sticker, computed
by `computeMetrics()` in `generate-metadata.js` from each artwork's pooled social
reach (artist `creator` + original `owner` followers/following), market price, and
age, plus seeded jitter:

| Field | Units | Range | Meaning |
| --- | --- | --- | --- |
| `r0BoostSpike` | × (dimensionless) | 1–4 | R₀ boost in the first weeks post-mint. *Derived from* amplification: `P·(follower base entering carrier pool) + baseline`. |
| `r0BoostSteady` | × (dimensionless) | 0.8–1.5 | Long-run R₀ boost (≥12 mo). *Derived from* long tail via carrier-duration geometric lift, pivoted at the 65yr → ×1.1 reference. |
| `longTailLongevity` | years | 20–140 | Extension to the work's referenceability half-life. |
| `amplificationProbability` | percent | 5–60 | P(artist publicly propagates the can-form within ~30 days of mint). |
| `recognitionDecay` | percentage points | 2–15 | Drop in identification rate, original → can-textured version. |

The three primary metrics lerp across their full range from two composite drivers
— `spreadDrive` (reach + market + follower:following) and `persistDrive` (market +
age + reach) — which are stretched and jittered so the ranges are genuinely
reachable, giving a natural spread (e.g. Spike median ≈2.0 with occasional 4.0).
Normalization bounds are calibrated to the dataset's ~p5–p95, so the signals span
[0,1] rather than clustering. `Spike`/`Steady` are derived from the primaries.
Decay shares `persistDrive` with longevity (inverted), so across the set long tail
⇒ low decay (corr ≈ −0.9), with per-row jitter for natural noise.

**Deterministic.** All randomness is seeded from the stable `base` key
(xmur3 → mulberry32), so re-runs are idempotent — the same artwork always yields
byte-identical metrics, with zero spurious diffs. Every input is null/zero-safe
(neutral ≈ 0.5 fallbacks), so missing `following`/`price`/`followers` still produce
in-range values. Values are stored as raw numbers; downstream formats the units
(`88 years`, `30%`, `×2.0`).

## Adding future metadata fields

Each new field is a sibling key inside the per-artwork object. To add one,
compute it and spread it into a `metadata[base] = { ...metadata[base], ... }`
merge (the merge preserves existing keys, so a comment-only run, a metrics-only
run, and a weight-only run all layer cleanly).

- **`weight`** — `lib/dataset.js::formatNetWeight(sizeKb)` already returns the
  label's "Net wt" form (`{ value: "39,8 Mb", unit: "(39834 kilobytes)" }`);
  `sizeKb` is on the validated entry (`valid.sizeKb`).
