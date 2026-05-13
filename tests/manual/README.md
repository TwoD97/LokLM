# Manual Test Scenarios

This directory hosts the manual test scenarios referenced in
[Pflichtenheft](../../Pflichtenheft_LokLM.md) §8.3 (Manuelle Test-Szenarien).

Automated unit and integration tests live **co-located** with their source
modules as `*.test.ts` / `*.test.tsx` (per Anhang A convention). This folder
is reserved for runbooks that a human walks through against a built binary —
typically end-to-end flows like first-time registration, recovery-code reset,
chat-stream + citation click-through, and multi-hardware smoke runs.

## Format

One markdown file per scenario, named `<NN>-<short-slug>.md`. Each file should
include:

- **Vorbedingung** — what state the app must be in before running
- **Schritte** — numbered steps the tester executes
- **Erwartet** — observable outcomes for each step
- **Notizen** — known caveats, screenshots, or hardware-specific behaviour

The first scenario will be added with AP-2.1 (Authentifizierung).
