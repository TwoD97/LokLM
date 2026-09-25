# Workflow and status clarity

The user reports an unreadable German skipped label, unclear reranker behavior and an overcrowded top status area. Review scope covers unlock/startup, document import/indexing/search/chat, writing/translation, quiz/transcription, organizer and settings workflows.

Retain LokLM's calm workspace: canvas #f5f7fa, white surface #ffffff, ink #182331, secondary #586879, blue #2459a8, border #dbe2ea; use the current slate dark theme. Segoe UI remains the offline typeface, with 22px startup title, 15px labels and 13px explanations. Prefer useful state text over decorative progress.

Startup uses a single left-aligned explanation followed by a compact list: chat, document search and optional search refinement. Each row names a capability and distinguishes loading, available on demand, unavailable and deliberately disabled. Low-memory reranking explains why it is off and confirms document search remains usable. A prominent Open workspace button lets users work while AI prepares; troubleshooting opens System settings. Only actual model-loading progress receives a progress bar.

The title bar replaces separate technical dots and model tags with one status button. It prioritizes current work and problems, then expands into labeled capability details. Detailed indexing progress remains in its own task view, while ordinary model switching no longer creates a second status strip. Native window controls and drag regions remain unchanged.

Review against the brief: capability labels better answer the user's question than simply repairing an umlaut. A skipped optional feature must not resemble a failed prerequisite. The status panel must not advertise a parked model as resident, or a selected external provider as verified. The design keeps routine diagnostics out of the main workflow while preserving a clear route to model settings.

Implementation findings and validation follow in the workflow review documents.
