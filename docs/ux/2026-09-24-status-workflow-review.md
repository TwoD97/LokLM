# Status and workflow review — 24 September 2026

The title bar now has one task-first status button. Its details describe Chat, Document search, optional Search refinement, Translation and Audio transcription instead of presenting several unexplained model indicators. Native window controls and the draggable title-bar area remain intact.

## Semantic review

| Situation                                    | Intended presentation                                     | Evidence / follow-up                                                                                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local model is ready and explicitly resident | Ready                                                     | Both top status and Startup require `resident === true`; a missing residency field does not prove GPU residency.                                                                       |
| Local model is configured but parked         | On demand                                                 | Avoids claiming that all model weights are in GPU memory simultaneously.                                                                                                               |
| Local model is unloaded or failed            | Not loaded / Needs attention                              | Status details link directly to System. System offers model troubleshooting and Advanced settings.                                                                                     |
| Exclusive local indexing / model switch      | Current task leads the summary; Chat and Translation wait | Indexing progress remains visible, Stop waits for the current batch, and restoration explicitly says Returning to chat. External providers are not assumed to wait for local GPU work. |
| Reranker skipped on a small GPU              | Skipped, with optional label and explanation              | Uses `policyDecision.reason`, not English message parsing. Explicit Off takes precedence. Unknown GPU capacity and missing GPU are separate cases.                                     |
| External provider selected                   | External provider, not a verified-ready claim             | Main currently overlays synthetic `ready` for configured Ollama. Top status uses a neutral icon and says connection is checked on request. Startup explains the same distinction.      |
| Audio model file installed                   | On demand                                                 | Installation is not residency. Starting transcription supplies the active-work state. Model availability refreshes when details open or window focus returns.                          |
| Translation                                  | Shares Chat's model and queue                             | No separate translation-model ready indicator or sidecar implication.                                                                                                                  |
| Locked session                               | No private activity details                               | The status component only mounts in an unlocked session.                                                                                                                               |

The System pane needed a source-aware status overlay: `llm.info()` originally returned raw bundled-service information even when `llm.status()` reported an external provider. The integration owner fixed this by merging the live status with system information and treating active local fallback as bundled. Startup and top status also distinguish actual local fallback from an external-provider selection.

System model capacity describes the **last successful local allocation**, not a promise of current residency or future fit. System now labels GPU layers and context at last load accordingly. Total GPU VRAM and system RAM remain separate quantities.

Startup now recovers each failed status read independently when a newer successful status arrives, ignores obsolete read failures after a live push, and permits automatic entry when core tools are usable even if optional refinement status cannot be read. Missing residency renders On demand. Warmup IPC acceptance is not completion; Retry preparation stays disabled while core models report loading, in addition to the existing backend guard against concurrent warmups. Organizing the workspace remains available throughout.

No new model-loading loop was found in the status UI: it reads/subscribes only. System refreshes are deduplicated by state/residency/source, and policy publications are deduplicated by the actual decision. No polling or automatic retry loop was added.

## Interaction and verification

- Details are a labeled nonmodal dialog with focus on opening. Escape restores focus to its trigger; outside pointer or focus movement dismisses it. System opens the correct settings section.
- Indexing retains a real cancellation action, including failure/retry feedback. Generation cancellation remains in each feature; the global registry does not expose reliable cancellation handles.
- Thirty-one combined startup/status renderer tests pass: residency/policy mappings, external fallback, German text, activity priority, waiting queues, stopping/retrying indexing, stale IPC reads, per-service read-error recovery, optional refinement not blocking entry, warmup acceptance versus loading, lock privacy, module visibility, audio refresh, keyboard dismissal and the System shortcut.
- ESLint passes for TitleBar, status and startup files. Whole-project typecheck passes after the concurrent fixture correction.
- Headless Chrome screenshots checked at 1440×960 English/light, 960×720 German/dark and 640×700 German/light. Details stayed within the viewport with no document overflow or page errors. German labels, including `Übersprungen`, display correctly. Chat → Library navigation worked at all three widths.
- Screenshot evidence: `out/ux-review/status/en-light-1440.png`, `de-dark-960.png`, `de-light-640.png` and `indexing.png`. Preview used isolated port 5174 with an injected API fixture; the user's development server and vault were not changed.

## Limits

The global generation registry reflects feature dispatch order, not every native inference sub-operation. Waiting labels explain the shared local queue, but do not estimate completion time. External provider connectivity is verified by real requests, not by this passive status panel. The visual checks use controlled API fixtures; they do not establish hardware throughput or prove every native GPU transition. Installed audio-model state is refreshed on demand because the API has no model-status subscription.

### Audio is not currently GPU-only

Read-only inspection found an actual CPU fallback, not merely an outdated comment. `TranscriptionView.tsx` requests `gpu: true`, but `services/workers/transcriptionWorker.ts` catches **any** error from the first GPU-requested `addon.transcribe()` call and retries it with `use_gpu: false`. This fallback therefore can execute on CPU after an initialization error, memory error, or another thrown transcription error. The worker comment also describes silent native fallback; that native behavior was not independently exercised in this UX review. The installed addon documents `use_gpu` as an auto-detection request, not a verified execution-device report.

The explicit fallback emits a warning log. `TranscriptionWorkerClient.dispatch()` writes it to the main-process console; it is not forwarded to the renderer as a user-visible fallback event. `WhisperTranscribeResult` only carries transcript segments, and `TranscriptionEvent` only carries segment/progress/done/error messages. Neither includes resolved backend/device. Consequently the transcription page and top status cannot distinguish actual GPU inference from a successful CPU retry. The new audio status deliberately says Working or On demand without a GPU-only promise.

`TranscriptionService` also defaults an omitted `gpu` option to `false`, although the current page explicitly supplies `true`. Optional speaker diarization uses a separate worker described in its source as CPU-based and supplies no GPU execution provider. Audio runs independently from the chat/embedding/reranking worker and is not routed through its GPU task-switch coordinator. No transcription backend or resource policy was changed in this UX pass. App-wide GPU-only execution would require separate audio backend enforcement, device/fallback telemetry and GPU resource coordination; the existing GPU-only controls for language/retrieval models must not be presented as covering all audio processing.
