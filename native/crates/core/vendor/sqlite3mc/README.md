# SQLite3 Multiple Ciphers 2.3.4

Unmodified amalgamation and headers copied from the pinned
`better-sqlite3-multiple-ciphers@12.10.0` package in this repository's pnpm lockfile.
This is the exact encryption engine used by the original LokLM v0.7.4 workspace
store. Upstream: https://github.com/utelle/SQLite3MultipleCiphers .

SQLite is public domain; SQLite3 Multiple Ciphers is MIT, copyright Ulrich Telle.
The amalgamation retains notices for its bundled cryptographic implementations.
Keep all notices when redistributing. No Node addon or runtime is linked.

Stock SQLCipher 4 cannot read the app's default sqlite3mc non-legacy framing.
The synthetic original-engine integration fixture detects this distinction.
Rust's `rusqlite` calls the same SQLite C API and links this static library under
its expected `sqlcipher` link name. `SELECT sqlite3mc_version()` is a hard runtime
gate against accidentally linking a different SQLite implementation.
