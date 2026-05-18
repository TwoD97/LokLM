# Landingpage SaaS Rebuild — Design

**Status:** Draft for review
**Scope:** `website/` (Astro project), full landingpage rebuild

## Goal

Take the existing landingpage from "minimum viable" to a complete SaaS landingpage that visualizes the product, structures the funnel cleanly, and sets honest expectations.

## Positioning principle

LokLM is not "ChatGPT but private". It is a different category — a local document-grounded assistant whose value is privacy, source citations, and offline use. Consumer-hardware models cannot match cloud-frontier quality on raw reasoning, and the page must not imply they can.

This principle drives several content decisions: no head-to-head comparison table, an FAQ entry that addresses the question honestly, and a use-cases section that frames LokLM by _what it's good at_ rather than _who it's better than_.

## Visual direction

**Midnight Glow** — evolution of the current dark theme.

- Keep the existing color tokens in `src/styles/global.css` (`--color-bg-0..2`, `--color-fg-0..3`, `--color-accent` family).
- Keep the drift-blob background fx, but reduce from four blobs to two and lower opacity (`0.55` → `0.35`) — disciplined, not noisy.
- Add product chrome as a recurring motif: rounded `#161b22` windows with a three-dot title bar, used for every screenshot and the hero floating panel.
- Headlines stay sans-serif (Inter Variable, already loaded). Add a small monospace eyebrow `// LIKE THIS` style above each section title — extends the existing `.section-eyebrow` class with a leading `//` for stronger product/dev voice.
- Gradient text on emphasized phrases only (one per section max), using `linear-gradient(135deg, #60a5fa, #a78bfa)`.

## Section order

```
Nav (kept, polish)
1.  Hero                       — NEW (immersive layout)
2.  Social proof strip         — NEW
3.  Open-source stack marquee  — KEPT
4.  Why LokLM                  — KEPT
5.  How it works               — NEW
6.  Feature deep-dives         — NEW
7.  Feature grid (6 cards)     — KEPT (demoted, "more features")
8.  Security & architecture    — NEW
9.  Use cases                  — NEW
10. Download                   — KEPT (polish)
11. FAQ                        — NEW
12. Final CTA                  — NEW
Footer (kept, expanded)
```

## Section designs

### 1. Hero (NEW — immersive layout)

Layout: text overlay on the left, product window dominating the right and bleeding off the page edge with a subtle 3D tilt (`perspective(1200px) rotateY(-8deg)`).

- **Left column** (max-width ~480px, vertically centered):
  - Eyebrow: `// LOKALER KI-WISSENSASSISTENT`
  - H1: existing copy from `hero.title` i18n key, kept word-for-word
  - Sub: existing `hero.subtitle`
  - CTAs: primary (Download) + ghost (See it work — jumps to How-it-works section)
  - Stack pills (`100% offline · Lokale Verschlüsselung · Open Source · MIT`) below CTAs
- **Right column** (overflows right edge):
  - Product window with three-dot bar, document tree on left (4–5 file names), chat thread on right with one user question and one LokLM answer including a clickable citation
  - Use a real captured screenshot of the LokLM Electron app — placed inside the window chrome via CSS, not embedded with chrome baked in (so we can swap screenshots without re-rendering frames)
  - Soft drop shadow + outer glow that uses `--color-accent` at low alpha
- **Mobile (<768px)**: tilt removed, window straightens, text and window stack vertically — falls back to split-layout behavior

Screenshot to capture: chat thread on a real document set, with a citation pill visible. Need a screenshot at 2x DPR, ~1400×900px, no personal data in filenames.

### 2. Social proof strip (NEW)

Thin horizontal band, immediately after hero, no section padding.

- GitHub stars badge — live from `https://img.shields.io/github/stars/TwoD97/LokLM?style=flat&color=...` styled to match the theme, or fetch at build time and inject as plain text (preferred — no external image dependency on every page load).
- Contributor avatars: small row, lazy-loaded from GitHub API at build time (the Astro build can call `https://api.github.com/repos/TwoD97/LokLM/contributors` and emit static `<img>` tags).
- "MIT · Open source · Audited code" trust ribbon — plain text with mono accent.

If GitHub star count or contributors list cannot be fetched at build (rate limit, offline build), section degrades gracefully to a static "Open source · MIT licence" strip.

### 3. Open-source stack marquee (KEPT)

Unchanged structure. Polish only:

- Reduce vertical padding (`py-14` → `py-10`) — currently feels overweighted given the new sections above.
- Item hover stays as-is.

### 4. Why LokLM (KEPT — polish only)

The copy is your strongest content. Keep it word-for-word.

Visual polish:

- The three-step counter (1/2/3 with Installieren/Importieren/Fragen) gets larger numbers and connecting hairlines between them, so it reads as a sequence instead of three separate stats.
- Problem column: keep the dashed border treatment. Tighten icon alignment.
- Solution column: keep the glass card. The solution tagline gets gradient-text treatment for emphasis.

### 5. How it works (NEW)

Three numbered steps, **alternating left-right** layout — each step is a row of: numbered marker · text · screenshot.

- Step 1 — Import: drop documents into the vault. Screenshot: vault drop zone with a few files.
- Step 2 — Ask: chat interface with a query typed. Screenshot: chat input mid-typing.
- Step 3 — Verify: clickable citation opens the source page. Screenshot: citation hover or open document panel.

Each step's screenshot lives in a small product window (same chrome as the hero). Step numbers are large monospace (`text-6xl mono opacity-30`) anchored behind the text for visual rhythm. A thin vertical dashed line connects steps, visible only on desktop.

### 6. Feature deep-dives (NEW)

Three alternating split rows (text/screenshot, screenshot/text, text/screenshot) for the headline features:

- **Citations that prove the answer** — sources feature
- **Vault encryption** — crypto feature
- **Offline by default** — offline feature

Each row: large headline, body copy from existing i18n keys (`features.sources.body` etc.), one CTA-style link ("See the architecture" → jumps to Security section, or "Try a query" → jumps to How-it-works), and a screenshot.

This is the section that earns the hero's claims. The screenshots here can be either captured product views or zoomed-in details (e.g., a single citation pill with its source preview popover).

### 7. Feature grid (KEPT — repositioned)

The current 6-card grid becomes "Everything else LokLM does" — secondary features that didn't earn a deep-dive row. Keep the existing component, drop the heading and subhead.

Replace the section eyebrow with `// MORE FEATURES`. Reduce padding to `py-12`.

### 8. Security & architecture (NEW)

A single annotated SVG diagram + supporting prose. No interactive controls.

Diagram shows the data path:

```
[ your documents ] → [ local index ] → [ local model ] → [ answer + citation ]
                              ↓
                  [ encrypted vault on disk ]
                              ↓
                   (no network boundary line)
```

The "no network" boundary is a dashed line cutting off the entire system from a stylized cloud labeled "(LokLM never crosses this line)". Annotations call out:

- Argon2id password hashing
- AES-GCM per-file encryption
- 18-word recovery passphrase
- No telemetry, no account

The SVG is authored by hand in Astro (inline SVG component), themed with the same color tokens. No external diagram library.

### 9. Use cases (NEW)

Four cards in a 2×2 grid. Each card has:

- Persona icon (lawyer, researcher, consultant, developer)
- A representative question framed for that persona
- One-line outcome description

Examples (final copy in i18n keys, not hardcoded):

- **Lawyer**: "Where is the cap rate clause in the lease?" → "Cited at §4.2 of Lease.pdf"
- **Researcher**: "Summarize the methodology section across these three papers" → "With page references for each"
- **Consultant**: "What did the client commit to in the Q3 review?" → "Quoted from review.docx:12"
- **Developer**: "How do I configure the auth middleware in this codebase?" → "Cited at src/main/auth.ts:88"

Each card is a glass panel. No CTAs — this section is informational, sets expectations on what LokLM is good at.

### 10. Download (KEPT — polish)

Current section is strong. Polish:

- Add a subtle animated glow to the highlighted platform card on hover.
- Replace the radial-gradient overlay with a slightly larger blob anchored top-right.
- The "first install pulls ~20 GB" notice gets icon + monospace styling consistent with the new mono-eyebrow voice.

### 11. FAQ (NEW)

8 collapsibles using `<details>`/`<summary>` (native, no JS). Two columns on desktop, single column on mobile.

Question set:

1. Is LokLM really offline?
2. How big are the models, and where do they download from?
3. Can I bring my own model (GGUF)?
4. Does it need a GPU?
5. Where are my documents stored?
6. **Is LokLM as smart as ChatGPT or Claude?** (honest answer: no, and here's what it's optimized for instead — privacy, citations, your own corpus)
7. How do I back up my vault?
8. What happens if I lose my password?

Final question copy in i18n keys.

Open state: subtle background highlight, smooth height transition. Closed: monospace chevron rotated `0deg`/`90deg`.

### 12. Final CTA (NEW)

Full-width section, centered content:

- Eyebrow: `// READY?`
- Headline (gradient): "Dein Wissen, auf deiner Maschine." / "Your knowledge, on your machine."
- One single primary button: Download
- Below: small mono link to the Download section for "Other platforms"

Background: a single bright blob anchored center-bottom, more saturated than elsewhere — this is the page closer.

### Footer (KEPT — expanded)

Current footer is one row. Expand to a 4-column grid above the existing bottom row:

- **Product**: Features (#features), Download (#download), Changelog (link to GitHub releases), Roadmap (link to GitHub project)
- **Developers**: Repository, License (MIT), Architecture (#security), Contributing (link to CONTRIBUTING.md if it exists, else GitHub issues)
- **Community**: GitHub Discussions, Issues
- **Legal**: Imprint, Privacy (a short page that says "we don't collect anything — here's why and how to verify")

The legal column requires a new `/imprint` and `/privacy` page in both languages. Out of scope for this rebuild if it stretches scope — can be follow-up.

Bottom row stays as it is.

## Cross-cutting

### Components

New Astro components in `website/src/components/`:

- `SocialProof.astro`
- `HowItWorks.astro` (replaces the 3-step counter currently embedded in `WhyLokLM.astro` — that block is moved out)
- `FeatureDeepDives.astro`
- `Architecture.astro` (security section, contains the SVG diagram inline)
- `UseCases.astro`
- `FAQ.astro`
- `FinalCTA.astro`
- `Footer.astro` is rewritten (current file is too small for the new column layout)
- `ProductWindow.astro` — shared shell for product screenshots (three-dot bar, rounded chrome, drop shadow). Used by Hero, HowItWorks, FeatureDeepDives.

Existing components polished, not replaced:

- `Hero.astro` (rewrite for immersive layout, same file)
- `WhyLokLM.astro` (visual polish, the embedded counter moves to HowItWorks)
- `Features.astro` (becomes the "more features" grid, demoted)
- `Download.astro` (polish only)
- `OpenSourceMarquee.astro` (padding tweak)
- `Nav.astro` (polish — add a download-CTA-on-scroll behavior optional)

### i18n

All new copy lives in `src/i18n/ui.ts` under new keys (`social.*`, `how.*`, `deepdive.*`, `security.*`, `usecase.*`, `faq.*`, `finalcta.*`, `footer.col.*`). Both German and English populated. Existing keys are not renamed.

### Screenshots

Living asset directory: `website/public/screenshots/`. Naming: `hero-chat.webp`, `step1-import.webp`, `step2-ask.webp`, `step3-verify.webp`, `deepdive-citation.webp`, `deepdive-vault.webp`, `deepdive-offline.webp`. Format: WebP at 2x DPR. Each shipped with a 1x fallback for the `srcset`.

Screenshots are captured against a real demo vault populated with non-personal documents (a lease template, two open-access research papers, project README files). The demo vault is documented at `website/screenshots-checklist.md` so re-captures are reproducible.

### Performance

- Screenshots are the only meaningful weight added. Budget: ≤80KB per WebP at 2x. Use `<img loading="lazy" decoding="async" srcset>` everywhere except the hero image.
- No new JS bundles. The page stays SSG. Marquee animation, FAQ collapsibles, hero tilt — all CSS only.
- Hero tilt and drift blobs respect `prefers-reduced-motion`.
- Keep `inlineStylesheets: 'always'` from the existing Astro config.

### Accessibility

- Each screenshot has descriptive alt text (in i18n keys).
- Hero tilt removed at reduced motion.
- FAQ uses native `<details>` so keyboard / screen-reader handling is free.
- Color contrast: validated against the existing palette — the gradient-text accent passes WCAG AA against `--color-bg-0` because we only use it on large headlines.

### Out of scope

- Multi-page expansion (separate `/features`, `/security` routes). The full SaaS-site option from earlier scoping is _not_ part of this spec.
- Pricing page (LokLM is MIT/free).
- Newsletter signup, email capture.
- Analytics. The "no telemetry" claim on the page means no analytics on the landingpage either.
- Imprint/Privacy sub-pages — listed in Footer for completeness but their content is a separate task.
- Comparison table — dropped intentionally per positioning principle.

## Implementation order (rough sequence)

1. `ProductWindow.astro` shell + i18n key scaffolding for all new sections
2. Hero rewrite (immersive layout, first screenshot captured)
3. SocialProof (GitHub data fetch at build)
4. HowItWorks (three screenshots captured)
5. FeatureDeepDives (three more screenshots, copy)
6. Architecture (SVG diagram)
7. UseCases
8. FAQ
9. FinalCTA
10. Footer expansion
11. Whole-page polish pass: spacing, mobile, motion, reduced-motion

Existing kept sections (marquee, why, feature grid, download) get a polish-only pass interleaved.

## Open questions for review

- Whether to fetch GitHub stars/contributors at build (preferred — zero runtime cost) or skip the live numbers and use static "MIT · Open source" text. Build-time fetch can fail on network/rate-limit so we need graceful fallback either way.
- Whether the Footer Legal column ships with this rebuild or in a follow-up — depends on whether you want stub imprint/privacy pages now.
