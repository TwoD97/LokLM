# Personal workspace and hardware-aware UX

The user wants the calm workspace refined, more useful settings, optional menu modules, local calendar/notes/tasks, and honest behavior on a 4 GB GPU.

Design tokens retain the established palette: canvas `#f5f7fa`, surface `#ffffff`, ink `#182331`, secondary `#586879`, blue `#2459a8`, border `#dbe2ea`; dark mode uses the existing slate equivalents. Segoe UI Variable / Segoe UI remains the native offline type family. Headings 26px, body 15px, descriptions 13px.

Settings: one stable dialog with a left section list and a spacious right panel. General contains everyday preferences; Modules controls sidebar visibility and startup destination; System explains actual GPU memory, model placement, and reranker policy; Advanced retains specialist controls; Profile and About remain available. Labels use sentence case. Save feedback and failures are visible.

Organizer: calendar emphasizes a month grid and selected-day agenda; notes emphasize a searchable list and writing area; to-dos emphasize quick capture, due dates and completion. Data belongs in the encrypted vault, with explicit save state and conflict handling. No invented appointments or examples are saved to the user's account.

Review against the brief: adding three destinations can make the menu crowded. Visibility controls and a consistent navigation order address this, without deleting hidden data. Hardware feedback must report facts (GPU VRAM, partial offload, unavailable models) instead of labeling every 4 GB computer unusable. Auto reranking skips low-memory GPUs; an explicit override may trade responsiveness for an extra ranking pass. A local organizer is a complete useful starting point; account sync is a separate integration, not implied by a calendar UI.

## Delivered

- Six Settings sections with fixed navigation, keyboard tabs, accessible advanced disclosures, visible save failures, module visibility, startup view and calendar week-start preferences.
- Calendar with local single-day/all-day events and a selected-day task agenda; searchable notes with explicit Save/Ctrl+S and dirty-draft guards; dated tasks with editing, completion and filters. Organizer views preserve drafts across navigation and are removed when the vault locks.
- Encrypted organizer persistence, revision conflicts, strict input bounds, immediate durable save acknowledgement, and serialized vault transactions shared with preferences and avatar writes. Password recovery restores preferences just like login. Failed final lock persistence still removes private renderer content.
- Auto reranking skips 4 GB-class local GPUs (up to 4.5 GiB driver-reported capacity; the tested GTX 1050 Ti reports 4.1 GiB). Always is an explicit override; Off is respected across login. GPU-only inference remains required; partial GPU placement is reported separately.
- System settings distinguish system RAM from GPU VRAM and display actual model layers/context. Cosmetic settings changes do not reconfigure model engines. Constrained local GPUs use existing lighter retrieval defaults, while explicit controls remain respected.
- Unavailable, failed or invalid reranking correctly retains hybrid retrieval behavior and never applies a cross-encoder score threshold to fused-rank scores. See [RAG review](2026-09-24-rag-review.md).

## Validation

- Full TypeScript project check and production build passed. Targeted renderer/main/preload/organizer/settings lint passed without errors; whitespace diff check passed.
- Entire renderer test project: **40 files, 226 tests passed**. Includes organizer CRUD, conflict/error retention, draft preservation, keyboard dates, module visibility/startup behavior, save failure feedback and hardware guidance.
- Backend agents verified organizer/auth/vault transaction tests (81), settings integration (25), retrieval regression set (49), GPU worker/policy tests (33), plus runtime settings/lean retrieval helpers (15). These are targeted sets with overlap, not a claimed aggregate suite total.
- Real Electron organizer regression passed with an isolated temporary vault: UI note save, calendar + dated task display, task completion, theme/menu/start-view/week-start changes, locked API rejection, lock/login, password recovery and full process restart. No renderer errors. Recovery words stayed within the disposable renderer session, never in logs.
- Native model smoke passed on the installed GTX 1050 Ti: Auto skipped reranking, a GPU embedding returned 1,024 dimensions, chat restored and translations succeeded. At that run's memory pressure, chat used **14/33 GPU layers, 4,096-token context, q4 KV**, with a roughly 35-second restore. This validates routing, not fast interaction or full model fit. Artifact: `out/model-residency-chat-first.json`.
- Browser review at 1440?960 and 960?720, English/German, light/dark. **30 accessibility states** (19 Settings, 11 organizer) had no axe WCAG A/AA violations. Screenshots visually inspected; no horizontal page overflow. Browser fixtures are synthetic and do not test native inference. Artifacts: `out/ux-review/polished/`.

## Critique and remaining scope

The stronger hierarchy and independent panel scrolling make Settings easier to scan. The three new tools share the existing calm palette and native typography. The dense advanced controls remain deliberately secondary. In the browser review, an existing amber notice failed contrast at 4.46:1; it now uses the verified warning token. Small-window panels scroll instead of squeezing inputs.

Calendar is local, with no account synchronization, recurrence or background reminders. Notes are private organizer records, not automatically indexed RAG documents. Auto reranking trades an extra relevance pass for fewer model swaps on small GPUs; no corpus-wide answer-quality improvement is claimed. The 4 GB GPU still limits model placement and response speed, and the UI now describes that limitation rather than implying a complete fit.
