# NFT metadata generator

Generates per-artwork metadata for the SPAM cans and writes it to a single
`prerender-out/metadata.json`, keyed so each entry joins the prerender
`manifest.json` and the rendered can.

Today it produces one field — `comment`, an LLM museum-style critique (ported
from the standalone `commenter` project). The per-artwork object is designed to
grow over time: `weight`, `Long Tail Longevity`, `Amplification probability`,
etc. will be added as sibling fields by later passes.

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
| `--force` | off | Regenerate even if a `comment` already exists |
| `--model ID` | `deepseek/deepseek-v3.2` | OpenRouter model (alt: `moonshotai/kimi-k2.5`) |

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
    "comment": "⟁\n\"dəˈsent\" has survived through the technological singularity…"
  }
}
```

Join it to a rendered can via the `base` key (e.g. `manifest.json`'s `base`
field and the PNGs under `bands/` / `cans/` share the same name).

## Adding future metadata fields

Each new field is a sibling key inside the per-artwork object. To add one,
compute it inside the loop in `generate-metadata.js` and spread it into the
`metadata[base] = { ...metadata[base], ... }` merge (the merge already preserves
existing keys, so a comment-only run and a weight-only run can layer cleanly).

- **`weight`** — `lib/dataset.js::formatNetWeight(sizeKb)` already returns the
  label's "Net wt" form (`{ value: "39,8 Mb", unit: "(39834 kilobytes)" }`);
  `sizeKb` is on the validated entry (`valid.sizeKb`).
- **`Long Tail Longevity`**, **`Amplification probability`** — TBD; compute and
  merge the same way.
