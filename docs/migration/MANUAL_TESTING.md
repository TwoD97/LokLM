# Manual testing — native preview

Do not point this preview at personal data. The default app ID and directory are
separate from Electron. The following instructions create synthetic data only.
Model workflows are under validation; check the migration report for limitations.

## Build prerequisites and commands (Windows)

Rust 1.95, Visual Studio C++ build tools, WebView2, CMake, libclang and Trunk
0.21.14. Add `wasm32-unknown-unknown` with rustup. `LIBCLANG_PATH` must name the
directory containing `libclang.dll`. It is a build dependency, not a secret.
Do not run original model download/install scripts for this preview.

```powershell
$env:NO_COLOR = 'true'
$env:CARGO_BUILD_JOBS = '2'
Set-Location native
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) 'target-wasm'
trunk build --release
Remove-Item Env:CARGO_TARGET_DIR
cargo test -p loklm-core -p loklm-inference -p loklm-documents
cargo build --release -p loklm-native
```

## Manual testing

1. Create a new empty test directory and set `LOKLM_NATIVE_DATA_DIR` to its
   `vault` subdirectory in the terminal used to launch
   `native/target/release/loklm-native.exe`. Create an encrypted vault with a
   synthetic password. Save its generated recovery phrase privately, not in chat.
2. Create two workspaces. In the first import a local UTF-8 `Überblick Berlin.md`
   containing `# Reisen`, `Berlin ist die Hauptstadt.`, and
   `The library code is ALPHA-47.` on separate lines. The real Windows picker
   should open and importing should display the document and chunk count.
3. Search `Berlin`, then `ALPHA`. Open each source. Its indexed text, file path,
   headings and page metadata should refer to the imported document. Search an
   absent word and expect no-results. The second workspace must return no sources.
4. Import the same unchanged file again: it should not duplicate the document.
   Edit and reimport it: this preview must explicitly refuse replacement while
   preserving the old indexed revision and citations. Empty, invalid UTF-8 and
   oversized text must fail visibly without adding a partial document.
5. Put `<script>window.__documentExecuted=true</script>` and an instruction to
   upload files in a synthetic Markdown paragraph. Search and open it. Source
   content must appear as plain text; it must never execute or authorize actions.
6. Lock the vault. Sources, recovery phrase and answers must disappear. Unlock
   with a wrong password and expect an authentication error. Unlock correctly and
   verify the document remains. Close the native window, relaunch, unlock and
   verify it again. The original Electron vault must remain unchanged.
7. Lock and select recovery. Use the private synthetic recovery phrase to set a
   replacement password. Save the replacement phrase privately. The old password
   must fail after a subsequent lock; the new password must reopen the same data.
8. When sufficient RAM is available, open Local models and select the existing
   LokLM Qwen3.5-4B GGUF. It must verify its full checksum. Selecting another file
   must fail rather than silently using an unrelated model. Models use CPU only,
   two threads. No network server or automatic download should appear.
9. Load the installed BGE-M3 (Lite) or Qwen3 embedding model (Standard), select
   Index workspace, then cancel. Restarting indexing should retain completed
   chunks, finish remaining chunks and keep distinct model fingerprints.
10. Ask a question containing `Berlin` in English and German. A provisional answer
    should stream; only validated current-source identities become source links.
    Open them and compare with the actual passage. Unknown/missing markers must
    produce an error. Optionally load BGE reranker with sufficient RAM and test
    an unrelated question: if every score is below 0.2 it must refuse without
    generating. A failed reranker must surface an error. The original structured
    factual-verification routes remain pending; source identity is not entailment.
11. Cancel during generation, then repeat and lock during generation. No late
    text or source should reappear. Lock unloads only this preview's own models.
    Reopen and verify that documents and completed index checkpoints remain.

Automated WebView testing uses `cargo build --release -p loklm-native --features
ui-test` and `node native/scripts/native-ui.mjs` from the repository root. That
build substitutes a test file for the OS picker. Never distribute it as the
normal application. The harness enables a temporary loopback-only WebView CDP
endpoint for its own process; production startup does not enable that endpoint.
Node/TypeScript in these scripts runs the original compatibility fixtures and
test driver only; the native application does not load a Node backend.
For optional real CPU model tests, set `LOKLM_TEST_MODELS_DIR` to the directory
containing the existing canonical GGUF files and `LOKLM_TEST_GENERATION=1`.
Allow several minutes and adequate free RAM; do not overlap other model jobs.
`LOKLM_TEST_COMBINED=1` additionally keeps the embedding and reranking models
loaded with generation and checks locking during streaming; use with the model
directory and generation flags. `LOKLM_TEST_PDF=1` selects the simple PDF fixture
workflow; `LOKLM_TEST_DOCX=1` selects DOCX instead. For format-specific manual
fixtures and failure expectations, see [PDF_IMPORT.md](PDF_IMPORT.md) and
[DOCX_IMPORT.md](DOCX_IMPORT.md). If testing a saved
ui-test executable after building the normal executable, set `LOKLM_TEST_EXE`
to that explicit test binary. Never distribute the ui-test build.

`native-stream-lock.mjs` requires the completed synthetic UI fixture and a saved
`native/artifacts/loklm-native-ui-test.exe`. It copies that test vault before
checking real generation lock/revocation. No personal vault is discovered or used.

## Native grammar adapter

The native grammar adapter has a separate synthetic vocabulary/model harness in
[NATIVE_GRAMMAR.md](NATIVE_GRAMMAR.md), with numbered setup and DE/EN, invalid
source, UTF-8, cancellation and lock checks. Its results do not imply that the
desktop answer action has switched to the checked route.

After building the normal executable, run
`python native/scripts/normal-workers.py native/target/release/loklm-native.exe`
with Python 3.11 or later. Expect nine synthetic PDF/DOCX worker checks and an
executable hash. This exercises private parser entry points without opening a
GUI or a vault; the real UI workflow above remains separate.

## Copy-only migration / rollback

`core::migration::copy_snapshot` stages and hash-verifies an entire closed vault
tree in a new sibling directory, preserves all original bytes and publishes a
versioned receipt. It rejects existing destinations, links/reparse points, live
SQLite journals, exceeded size budgets and cancellation. It does not convert
legacy v4/v5 payloads or Lance formats. No real-data UI migration is exposed.
Use only synthetic/copy fixtures until full compatibility passes. Rollback means
closing the preview and returning to the untouched original app/data. Publishing,
installing over the old app or migrating real data needs final user approval.
