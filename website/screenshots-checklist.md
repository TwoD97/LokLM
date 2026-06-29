# Screenshots checklist

Reproducible recipe for the landingpage screenshots. Re-run any time the UI changes.

## Automated harness (preferred)

`pnpm screenshots` builds the app and runs the Playwright + Electron harness
([`tests/e2e/screenshots.spec.ts`](../tests/e2e/screenshots.spec.ts)), which:

- launches the built app at **1400×900 / device-scale-factor 2** (the 2× DPR below),
  dark theme forced;
- registers a throwaway vault and imports the demo fixtures
  ([`tests/e2e/fixtures/`](../tests/e2e/fixtures/)) via the import IPC (the click
  path opens a native dialog Playwright can't drive);
- drives every feature view and writes WebP (2× + `@1x`) straight into
  `website/public/screenshots/` — the same filenames the landing page references
  plus the per-feature `feature-*.webp` ones.

**Requires the tier models in `./models`** (the unpackaged build's model dir). The
content captures (chat answer, translate, rewrite) are empty without them; each
capture is isolated, so a missing model only blanks its own shot. The harness is
tagged `@screenshots`, so the normal `pnpm test:e2e` / CI run skips it.

The manual recipe below stays as the spec the harness encodes (sizes, crops, theme).

## Demo vault setup

Use a fresh LokLM vault populated with non-personal documents only:

1. `lease-template.pdf` — open-source residential lease template (e.g. from LawDepot's free samples or a CC0 source)
2. `methodology-paper.pdf` — open-access research paper, your choice (e.g. an arXiv preprint)
3. `survey-paper.pdf` — second open-access paper, related to the first
4. `README.md` — copy of the LokLM repo README
5. `notes.md` — short markdown file with bullet notes

Vault password: `demo` (the screenshots are static; vault is throwaway).

## Capture procedure

- Display scale: 200% (2× DPR). All captures saved as WebP at the displayed pixel dimensions.
- Window size: 1400 × 900 logical pixels.
- Theme: dark (the LokLM default).
- Crop tightly to the relevant UI; do not include OS chrome.

## Required captures

| Filename                 | Size (logical) | Content                                                                                                                                                                      |
| ------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hero-chat.webp`         | 1400×900       | Two-pane view: document tree (4–5 files) on left, chat thread on right with one user question and one LokLM answer including a citation pill. Citation pill must be visible. |
| `step1-import.webp`      | 1200×800       | Vault import view with 3–5 documents visible in the drop zone.                                                                                                               |
| `step2-ask.webp`         | 1200×800       | Chat input mid-typing a question (cursor visible).                                                                                                                           |
| `step3-verify.webp`      | 1200×800       | Citation pill expanded or document panel open showing the cited passage.                                                                                                     |
| `deepdive-citation.webp` | 1200×800       | Zoomed in on a single citation pill + its hover preview popover.                                                                                                             |
| `deepdive-vault.webp`    | 1200×800       | Vault overview screen with the encryption indicator badge visible.                                                                                                           |
| `deepdive-offline.webp`  | 1200×800       | Status bar / settings view that shows offline mode is active.                                                                                                                |

For each capture, also export a 1× version (half the pixel dimensions) named with the `@1x` suffix.

## Export

- WebP quality target: ~80, lossy. Each file should land under 80 KB at 2×.
- Verify with `ls -l website/public/screenshots/*.webp`.

## Placeholder state

Until real captures land, all screenshot slots are stubbed with a transparent 1×1 WebP. Layout work proceeds independently of captures.
