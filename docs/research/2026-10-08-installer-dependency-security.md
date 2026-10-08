# Installer dependency security — 2026-10-08

A full RustSec scan found issues beyond the repository's saved GitHub alerts. Both sources are necessary: the GitHub snapshot included a serde_with advisory absent from this RustSec database.

The installer lockfile now uses compatible upstream fixes: rustls 0.23.45 (with rustls-webpki 0.103.15), serde_with/macros 3.21.0, quinn-proto 0.11.15, h2 0.4.16, anyhow 1.0.103, and plist 1.10.0 selecting quick-xml 0.41.0. Unrelated Windows dependency changes introduced by resolution were restored. Model versions, GPU settings and Node native addons were not changed.

Primary remediation references:

- [Rustls handshake boundaries](https://github.com/rustls/rustls/security/advisories/GHSA-2mjx-qc3c-rqvc).
- [Serde_with empty-entry panic](https://github.com/jonasbb/serde_with/security/advisories/GHSA-7gcf-g7xr-8hxj).
- [Quinn stream reassembly exhaustion](https://github.com/quinn-rs/quinn/security/advisories/GHSA-4w2j-m93h-cj5j).
- [HTTP/2 empty DATA buffering](https://github.com/hyperium/hyper/security/advisories/GHSA-q83h-524g-xf6h).
- [Anyhow mutable-downcast unsoundness](https://github.com/dtolnay/anyhow/issues/451).
- [Quick-xml duplicate-attribute complexity](https://github.com/tafia/quick-xml/pull/971) and [namespace-allocation bounds](https://github.com/tafia/quick-xml/issues/970).

## GLib backport

Tauri's Linux GTK3 graph requires GLib 0.18; its latest compatible release, 0.18.5, contains [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html). A GLib 0.20 override would not satisfy those dependent APIs.

The path patch in `installer-wizard/src-tauri/vendor/glib` preserves the original version, license and all 121 distributed files. Exactly two lines differ from the checksum-verified crates.io archive, matching [upstream commit b5a4071e439bef2b5eea76c3aa25e5ae84839e34](https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34): the output-pointer binding becomes mutable and GLib receives `&mut p`. Passing a shared reference to that variadic output argument was undefined behavior. Full provenance and the original archive hash are in [the vendor note](../../installer-wizard/src-tauri/vendor/README.md).

The three Linux iterator regressions call all five affected entrypoints, exercise Unicode and empty values, mixed-direction traversal and exhaustion. The Linux release gate runs:

```sh
cargo test --manifest-path installer-wizard/src-tauri/Cargo.toml --locked --release --test glib_variant_iter
```

Optimized execution matters because the original undefined behavior could turn into a null-pointer dereference under optimization. **That Linux runtime validation is a required release gate; it was not executed on this Windows development machine.** The source delta and test coverage received independent review.

The separate [native CI run for commit `66fec00`](https://github.com/TwoD97/LokLM/actions/runs/37753011974) now passes on all four runners. Ubuntu 22.04 passes 71 installer tests and all three GLib regressions in both debug and optimized release builds. Windows passes 66 installer tests; native Apple Silicon and Intel Mac runners each pass 74. An independent check confirms every committed vendor blob matches the reviewed source bytes. The source commit was subsequently published to `main` without a release tag; existing downloadable installers still require a new build and release to receive these fixes.

## Measured status and limits

Cargo-audit 0.22.2 scanned all targets against RustSec commit `b8a1a33e246a0a9a3b5f377248c41a503defec74` (1,294 advisories, updated October 7). The original lock had five vulnerability findings and two unsoundness warnings. The final registry scan with `--deny unsound` exits successfully, with no vulnerability findings and seven unmaintained warnings. No advisory ignore or target filter was added.

Cargo-audit does not cover the path-patched GLib through its registry matching. A control restoring its original registry identity reproduces the warning. Therefore the scanner result is not evidence that the backport works; provenance, source review and the optimized Linux test provide separate checks.

The seven visible maintenance warnings concern paste through Metal/wgpu, proc-macro-error through GTK3/GLib macros, and five unic packages through urlpattern/tauri-utils. They require supported parent migrations and remain documented rather than suppressed.

The final Windows installer suite passes **66/66** with the new lockfile. Its Linux-only test target runs zero tests on Windows. This establishes Windows compilation and existing behavior compatibility, not universal safety or independent reproduction of every upstream exploit. These local results do not establish that previously published binaries already contain the fixes.
