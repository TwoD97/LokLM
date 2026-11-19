# Measured preview performance — 2026-11-19

This is a locked-shell comparison, not full migration acceptance or an end-to-end
RAG benchmark. The preview still lacks many original features. Source data and
reproducible scripts are committed; no model weights or personal documents were
loaded during the shell samples.

Windows 10.0.26200, Intel i9-9900K (16 logical processors), 34,264,842,240 bytes
physical RAM. Original source `4651557`, production Vite bundle in unpackaged
Electron 42.11.10. Native source `fa55d2f`, optimized normal executable, WebView2
157.0.4341.60, with inference and PDF code linked but no model resident. The
headless peer was idle; other user applications were left untouched.

The script alternates engines, uses one isolated empty profile per engine and
keeps the registration window visible. After five seconds of settling it samples
Windows process-tree working set/private bytes and a CPU-time delta over roughly
2.13 seconds. Creation times exclude unrelated orphan processes after Windows
PID reuse. All recorded sample process sets were stable.

Five reused-profile runs (medians; MiB = 1,048,576 bytes):

| Metric | Electron | Native preview |
|---|---:|---:|
| Process-tree private committed memory | 308.76 MiB | 165.77 MiB |
| Process-tree working-set sum | 376.71 MiB | 330.13 MiB |
| Idle CPU, percentage of one logical core | 1.47% | 0% observed |
| Observed launch-to-input timing | 483.79 ms | 366.80 ms |

The native shell's median private committed memory was about 46% lower in this
fixture; its working-set sum was about 12% lower. Working sets double-count shared
pages and are not exclusive physical RAM. Zero observed CPU reflects the sample
resolution and short interval, not guaranteed zero work.

Memory/CPU windows were both 1200×800 DIP. Electron initially opens at 1280×800
and is resized after readiness; native opens at 1200×800. Readiness also includes
different Playwright/CDP connection paths. **Startup values are descriptive; they
do not establish a matched speed improvement.** Fresh-profile observations were
500.63 ms / 391.88 ms, but caches were not evicted: these are not cold starts.
Cold/warm startup under fully matched instrumentation remains a release gate.

Normal native executable: 13,895,680 bytes; SHA-256
`a065c7f3d2155f18af0db02cbd27913d340e57caedba217e4c150ec4a2613d40`.
This excludes separately installed WebView2 and model files. No comparable signed
installer was built, so there is no package-footprint improvement claim.

The earlier sampler pass was discarded because it included stale-parent-PID
orphans. The older Electron-only provisional measurements were also discarded.
Only [the corrected raw samples](evidence/locked-shell-windows.json) support the
table. Reproduce with `node native/scripts/measure-shells.mjs` after both app
bundles exist and during a coordinated idle window.

Active import/index memory, import throughput, larger-corpus retrieval p50/p95,
generation/reranking latency, cancellation latency distributions, cold caches,
installer/update footprint and other platforms remain unmeasured here. The
headless agent's Lance/Qdrant storage microbenchmarks are separate evidence, not
desktop or complete-RAG speed claims.

## Later executable size observations

These are normal, CPU-only Windows x64 release executables, excluding WebView2,
model weights and an installer. They do not replace the older shell measurement:

| Source | Bytes | Evidence |
|---|---:|---|
| `5c3de0b`, prior UI | 14,214,144 | [grammar snapshot](evidence/windows-grammar-executable.json) |
| `7012117`, active citation gate and position-based UI | 15,417,344 | [citation snapshot](evidence/windows-citation-executable.json) |

The latter is 1,203,200 bytes larger. It activates the full citation parser in
the basic answer path and includes the rebuilt Rust/WASM UI; no per-component
size attribution has been measured. The low-level llama common archive was
already enabled through its dependency defaults. No new startup, RSS or package
improvement is inferred from these builds or their functional UI smoke timings.
