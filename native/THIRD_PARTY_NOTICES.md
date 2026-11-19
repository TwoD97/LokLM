# Native preview dependencies

LokLM is MIT licensed; retain the repository LICENSE. Application/backend logic
and the Leptos UI are Rust. This does not mean every dependency is written in Rust.

- Tauri uses the operating system webview (WebView2 on Windows) and generated
  IPC JavaScript. Microsoft WebView2 is a separately licensed shared prerequisite;
  its installed footprint must be counted separately from the app executable.
- Leptos/wasm-bindgen generate WebAssembly plus JavaScript loading/interop glue.
  There is no bundled Electron, Node, React or JavaScript inference backend.
- `rusqlite` calls the SQLite C API. `crates/core/vendor/sqlite3mc` contains the
  original app's pinned SQLite3 Multiple Ciphers 2.3.4 amalgamation. Its LICENSE
  and embedded cryptography notices must travel with distributions. SQLite is
  public domain; the encryption extension is MIT. This is the original encryption
  framing, not a conversion to stock SQLCipher.
- `llama-cpp-2 = 0.1.161` is MIT OR Apache-2.0; its bundled llama.cpp C/C++ runtime
  is MIT. The preview enables CPU only, no CUDA/Vulkan/OpenMP download or runtime
  listener. Model weights are separate files with their own licenses. Preserve
  the existing repository THIRD_PARTY_NOTICES and model-manifest provenance.
- Build-only tools include Rust, MSVC, CMake, libclang and Trunk. A local verified
  libclang wheel was used for binding generation; it is not copied into the app.
- PDF text extraction uses `pdf-extract = 0.12.1` (MIT) and `lopdf = 0.42.0`
  (MIT), pinned transitively by Cargo.lock. Parsing runs in a separate bounded
  process. The fonts/CMap and PostScript parsing dependencies' notices also
  belong in the eventual distributable license inventory.
- DOCX ZIP/XML extraction uses `zip = 9.7.0` and `quick-xml = 0.42.0`, both MIT,
  in the same isolated worker. Only stored/deflate ZIP entries are enabled;
  bundled documents are not extracted to filesystem paths or sent to a server.

- Exact source-unit annotations use `regex = 1.13.2` (MIT OR Apache-2.0), with
  fixed bounded-input patterns and no user-supplied regular expressions.
- Source display units use `icu_segmenter = 2.4.0` and its pinned compiled data
  (Unicode-3.0). Automatic/LSTM segmentation is disabled. This is Rust ICU4X,
  not a retained Node/Intl runtime; the original Node/ICU fixtures remain tests.

`Cargo.lock` pins the resolved Rust dependency graph. A complete distributable
license-text inventory and signed installer remain release gates; this notice is
not a claim that distribution/signing review is complete. Headless LiveSync's
Node sidecar belongs to the separate deployment target, not this desktop binary.
