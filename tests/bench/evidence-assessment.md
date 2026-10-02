# Fixed-context native evidence assessment probe

This opt-in experiment changes the exact evidence passed to the production assessment planner. It bypasses retrieval and does **not** grade final answers. It uses the two DEV cases for unresolved admission counts and an approved capacity versus a later unapproved proposal, with `[A,B]`, `[B,A]`, `[A,B,Acopy]`, and `[B,A,Bcopy]`. A copied passage keeps identical text and gets distinct document/chunk IDs.

Build the candidate application first. Close other model-consuming processes and reserve an exclusive GPU slot. Preparing plans and reporting results load no model:

```powershell
pnpm exec tsx tests/evals/native-calibration/evidenceOrderPlans.ts --prepare out/optimization-20261002/evidence-plans.json
$env:LOKLM_NATIVE_EVIDENCE = '1'
node tests/bench/evidence-assessment.cjs --plans=out/optimization-20261002/evidence-plans.json --out=out/optimization-20261002/evidence-order-candidate
Remove-Item Env:LOKLM_NATIVE_EVIDENCE
pnpm exec tsx tests/evals/native-calibration/evidenceOrderPlans.ts --report out/optimization-20261002/evidence-order-candidate/raw.json out/optimization-20261002/evidence-order-candidate/review.json
```

For a two-control smoke probe, append `--cases=authority-dev-01/A-B,authority-dev-03/A-B` to the runner command. The list must be nonempty, unique, and use exact known case/order identities. Explicit list order is preserved. Omitting the filter runs all eight plans. Raw configuration and parser review list selected and intentionally unrequested cases separately; selected calls that never completed are unobserved. For example, a completed two-case subset is 2/2 observed with six unrequested, whereas stopping the default run after three calls leaves five unobserved.

The plans file and output directory must be new. The runner verifies assessment source, prompt helper, public chat wrapper and freshly compiled worker hashes before starting. It hashes the existing local model, then launches only the Electron utility worker with an isolated temporary profile; it opens no app window or user vault and downloads nothing. Only that validated temporary profile is removed. Results, model capacity, native resource snapshot, logs and per-call errors survive failure in `raw.json`. A per-call 240-second timeout kills the worker and leaves remaining selected cases unobserved. A completed token-limit failure is recorded separately and may continue to another case. No CPU-only result is accepted.

The eight calls share one loaded model and run in recorded order, so elapsed times are exploratory warm-state measurements, not randomized latency estimates. Temperature zero does not guarantee bitwise reproducibility on native GPU inference. A valid structured response and matching quote demonstrate only parsing and literal presence. Review the actual original passages for compatible scope, supported approval, conflict completeness and false authority. For the later unapproved proposal case, compatible current-versus-proposed facts can be a correct classification; do not require every two-source case to be unresolved or resolved.
