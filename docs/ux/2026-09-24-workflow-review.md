# LokLM workflow review — 24 September 2026

The reported `?bersprungen` was a corrupted German label for `Übersprungen` (skipped). Repairing the character alone would still leave the user guessing. Startup now names the optional capability **Trefferprüfung**, explains why Auto turns it off on a small GPU, and confirms that document search remains available.

This pass reviews the full application journey and implements the most consequential clarity, navigation, failure-recovery and accessibility fixes. It keeps the calm workspace design and existing inference architecture.

## Workflow coverage

| Journey                                    | Result                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register, unlock, reset and recovery words | Pending authentication cannot switch to a conflicting flow; one-time recovery words remain visible through clipboard failures; recovery generation cannot be dismissed in flight.                                                                                                                                       |
| Startup and entering the workspace         | Chat, document search and optional refinement have distinct states and plain explanations. Open workspace is a normal primary action. Optional refinement does not block usable core tools. Saved Calendar/Notes/To-dos start views open without waiting for AI.                                                        |
| Top status and GPU handoff                 | One activity/status button replaces technical dots and model labels. Details explain resident, on-demand, waiting, loading, failed and intentionally disabled capabilities. Indexing and queued work take priority; Stop indexing has real pending/error feedback. Ordinary switching no longer adds a duplicate strip. |
| Library, import, indexing and search       | Real loading and retry states replace false empty states; mutation failures stay visible; duplicate pending operations are guarded. Per-file import outcomes and source/citation navigation are retained.                                                                                                               |
| Chat and RAG                               | Failed conversation creation preserves the unsent question. Failed generation settles activity and preserves partial text. A late completion cannot move the user back into an old conversation.                                                                                                                        |
| Translation and writing                    | Source/result alignment is preserved; stale source is cleared on failed document load; save failures retain output; pending inputs and save targets cannot silently change underneath a request.                                                                                                                        |
| Quiz                                       | Failed generation cleans up subscriptions/activity, list failures are recoverable, and deletion requires confirmation. Running deck ownership is respected.                                                                                                                                                             |
| Transcription                              | Queued and active files have distinct states. Per-file and batch saves have pending, success and retry feedback; already-saved items are skipped. Partial failed output remains available.                                                                                                                              |
| Calendar, Notes and To-dos                 | Dirty edits are protected, successful creation stays visible under filters, calendar focus returns to a useful control, and load errors are distinguished from failed saves.                                                                                                                                            |
| General, Modules and Advanced settings     | Failed durable saves are visible and do not trigger dependent model reloads. Module visibility and start-view behavior remain predictable. Keyboard tab/radio/accordion interactions are consistent.                                                                                                                    |
| System and models                          | Hardware capacity uses actual VRAM separately from RAM. Measurements identify the last local model allocation. Live provider status prevents external configurations from appearing to have a missing local chat model. Missing/failed chat has retry and Advanced settings actions.                                    |
| Profile and security                       | Visible field labels, password form submission, pending avatar/profile changes, retryable failures, and nested-dialog focus/escape handling.                                                                                                                                                                            |

## Visual critique

The primary hierarchy now answers three questions: what is happening, what can be used, and what action resolves a problem. Optional features no longer look like prerequisites. Technical model details remain available in settings/details rather than occupying the title bar continuously.

Screenshots were inspected in English and German, light and dark themes, and compact desktop widths. The review corrected contrast in result metadata/status messages, transcript errors that squeezed away filenames, and a CSS specificity conflict that made the recovery dialog translucent. Compact authentication cards no longer shrink and clip their submit action; the surrounding scroll region remains keyboard focusable even while form controls are busy. Existing fonts, blue/slate theme tokens and navigation structure are retained.

## Verification

- **299 tests passed across 52 files**: the full renderer suite plus the affected reranker-policy unit suite.
- Whole-project TypeScript check and targeted ESLint passed. Production Electron build passed.
- Native Electron smoke passed in **48 seconds**, exercising durable organizer/preferences saves, lock, login, recovery, application restart and saved start-view restoration in an isolated disposable vault/profile.
- Integrated browser review: **36 application/settings/startup states**, plus **11 AI failure/result states**, had zero axe WCAG A/AA violations and no document-level horizontal overflow. Separate status previews covered light/dark, English/German and 640px/960px/1440px widths. Recovery-surface opacity and System-to-Advanced keyboard focus were checked in the browser.
- Authentication browser review: **24 additional states** covered registration, login, reset, recovery-word reveal, busy/error feedback and German clipboard errors in light/dark themes. At 960 × 720, mouse wheel and keyboard can reach long-form actions without hidden card clipping; the final states had zero axe violations.
- Two further settings recovery-reveal states verified solid surfaces, legible word indices, clipboard-error recovery and focus. Enter generates the replacement words without accidentally activating the newly focused Copy button; clipboard use requires an explicit Copy action.

Controlled browser fixtures exercise failure and transition states without reading or modifying the user's vault. Automated accessibility checks supplement screenshot and keyboard review; they are not a human usability study or screen-reader certification. Native inference throughput and audio GPU behavior were not benchmarked in this pass.

Detailed evidence and regression cases:

- [Status and startup](2026-09-24-status-workflow-review.md)
- [Library, chat and AI tools](2026-09-24-ai-workflow-review.md)
- [Organizer, settings and personal workflows](2026-09-24-personal-workflow-review.md)

## Remaining product gaps

- Writing has no real cancellation endpoint; batch transcription lacks a stop-entire-queue action. The UI does not pretend that hiding work cancels it.
- Transcription currently retries GPU failures on CPU and diarization uses CPU. These audio workers run outside the chat/embedding GPU coordinator, and audio device/fallback information is not reported to the renderer. This pass does **not** establish GPU-only audio. A separate runtime change and native audio verification are required to meet that policy across every tool.
- Unsaved tool drafts survive ordinary navigation while mounted, but are not durable recovery after app exit or vault lock.
- Calendar is a local organizer. Reminders, recurrence and external calendar synchronization are not implemented or implied.

The UX changes do not establish faster GPU throughput or improved RAG/model quality. Those require native workload measurements and retrieval/answer evaluations.
