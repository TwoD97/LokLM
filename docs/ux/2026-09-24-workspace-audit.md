# LokLM workspace UX audit

Direction: **a calm, polished workspace with clear hierarchy** (user selected).

## Evidence and priorities

Reviewed the renderer code and captured the running renderer with synthetic documents at 1440×960 and 960×720. This is an expert review, not a user study. The browser preview substitutes the Electron API; it does not measure inference performance.

| Priority | Finding                                                                                                     | Change                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| High     | Hover expands navigation and shifts the entire workspace. Tool destinations are icon-only.                  | Stable, labeled navigation with an explicit collapse control.                                                  |
| High     | Storage statistics, sync, import, progress and all filters compete above the document list.                 | Put workspace, file count and import first; disclose storage and filters on demand.                            |
| High     | Routine model transitions repeatedly open a modal and steal focus from chat.                                | Persistent inline activity for routine switches; retain the detailed loading screen for indexing and recovery. |
| High     | File titles require double-click or a menu to open. Status labels expose English internal values in German. | Keyboard-accessible file buttons and localized status labels.                                                  |
| Medium   | Empty chat provides little guidance; composer instructions disappear while typing.                          | Useful starter prompts, visible input guidance and composition-safe Enter handling.                            |
| Medium   | Low-contrast metadata, decorative canvas gradients and inconsistent page spacing compete with content.      | Neutral surfaces, stronger secondary text and consistent typography/spacing.                                   |
| Medium   | Settings does not constrain keyboard focus to its dialog.                                                   | Focus containment, focus return and keyboard-operated tabs.                                                    |

## Design plan, before implementation

Palette roles: canvas `#f5f7fa`, surface `#ffffff`, ink `#182331`, secondary `#586879`, accent `#2459a8`, border `#dbe2ea`. Dark mode uses the same roles on a deep slate canvas. Semantic success, warning and error remain distinct.

Typography: locally available Segoe UI Variable / Segoe UI / system fallback; 15px body, 26px page heading, 13px metadata. No font downloads. Spacing follows 4/8/12/16/24/32px. Primary actions are filled; selection uses a muted blue tint. Numbers align with tabular figures.

Layout: fixed title bar → stable sidebar → flexible work area. Library: heading + import → actionable notices/progress → search and filter disclosure → documents → workspace utilities. Chat: navigation + conversation history + bounded reading/composition column. Activity occupies a row above the work area rather than covering the composer.

Principles: preserve the user's position and draft; reveal secondary controls deliberately; make every wait and error understandable; support keyboard use; keep user content visually dominant.

Plan critique: retaining all features avoids an attractive but incomplete shell. Hiding filters needs a visible active count and reset action. Stable labels consume more width, so compact windows need a narrower history column and explicit sidebar collapse. Indexing still needs the loading screen the user requested; routine chat switching should not trigger it.

## Guidance reviewed

Installed and read [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) and [Vercel web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines), including the current [interface checklist](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md).

Reviewed the complete English transcripts and sampled video frames for these Nielsen Norman Group videos:

- [Visual Design Principles in Action](https://www.youtube.com/watch?v=YUMdv4yFlQU): scale, contrast, proximity and balance establish task priority.
- [Progressive Disclosure](https://www.youtube.com/watch?v=qlKWPNgPjmw): keep common actions visible and reveal secondary options deliberately.
- [Visual Hierarchy](https://www.youtube.com/watch?v=8OTbyWndY9M): relative emphasis controls the reading order.

Research downloads and preview fixtures live under ignored `out/`; no video content or research dependencies are shipped with the app.

## Validation

Implemented the layout and interaction changes above. The library now accepts file drops across its working area, and import errors appear in the workspace instead of only in developer logs. Chat suggestions fill and focus the composer without submitting. Settings, workspace help and delete confirmations contain keyboard focus and return it to the opener.

Performance changes: settings hydration notifies subscribers once instead of once for every mounted hook; document dates reuse locale formatters; the unlocked workspace no longer renders the decorative background; sidebar hover no longer triggers layout resizing. Existing document pagination and preserved drafts/results remain intact. These are implementation improvements, not measured inference speed claims.

| Check                                           | Result                                       |
| ----------------------------------------------- | -------------------------------------------- |
| `pnpm.cmd typecheck`                            | Passed                                       |
| `pnpm.cmd exec vitest run --project web`        | 35 files, 203 tests passed                   |
| `pnpm.cmd exec eslint src/renderer/src --quiet` | Passed                                       |
| `pnpm.cmd build`                                | Passed                                       |
| `git diff --check`                              | Passed                                       |
| Chrome interaction checks                       | Passed; no renderer exceptions               |
| axe-core 4.13.0, WCAG 2 A/AA and 2.1 AA rules   | Zero violations in 19 sampled screens/states |

Browser checks cover explicit sidebar collapse, unchanged width on hover, filtering and reset, prompt review, preserved chat drafts, inline model transitions without focus theft, indexing details and dismissal through restoration, keyboard settings tabs and focus return, long filenames, German, and light/dark layouts at 1440×960 and 960×720. Unit tests additionally cover composition-safe Enter, file dropping and visible import failures. The UI tests use synthetic data and a substituted Electron API; they do not rerun real GPU inference or certify full accessibility.

The first accessibility pass found insufficient contrast in ready/failed badges, the language badge, chat scope text and empty states. These were corrected and the scan was rerun. Final screenshot review confirmed clear primary actions, stable navigation, readable dark surfaces, compact-window fit and a loading screen that explains the indexing stages. Long names are intentionally truncated in the table; the complete name remains available to assistive technology and on hover.

Review artifacts (local, ignored):

- [Library before](../../out/ux-review/before/library.png) / [library after](../../out/ux-review/verified/library.png)
- [Chat](../../out/ux-review/verified/chat.png) / [compact dark chat](../../out/ux-review/verified/chat-dark-compact.png)
- [German library](../../out/ux-review/verified/library-de.png) / [indexing screen](../../out/ux-review/verified/indexing.png)
- [Accessibility results](../../out/ux-review/verified/accessibility.json)
- Reproduction helpers: `out/ux-research/server.mjs`, `preview.cjs`, `validate.cjs`. Start the renderer preview server, run the preview to prepare synthetic fixtures, then run validation with local Chrome. Research-only axe and video tools live in this directory; they are not app dependencies.
