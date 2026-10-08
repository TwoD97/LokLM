# GLib 0.18.5 security backport

Tauri's GTK3 dependency graph still uses GLib 0.18. The latest published release in that compatible line is 0.18.5; moving only GLib to 0.20 would not satisfy those dependencies.

`glib/` is the unmodified crates.io 0.18.5 distribution except for the two-line fix in `src/variant_iter.rs` from [upstream gtk-rs commit b5a4071e439bef2b5eea76c3aa25e5ae84839e34](https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34) ([PR 1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343)). The output pointer is mutable and is passed as a mutable reference to the variadic GLib call. This corrects [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html); no other source behavior or package version was changed.

Original crate SHA-256: `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`. Original source commit: `42b9caf98e03ded086362d9653ca58fe94dc8658`. All shipped source, tests, metadata and license files are retained. Cargo's local extraction marker `.cargo-ok` is not part of the distribution. `Cargo.toml` selects this source with `[patch.crates-io]`; this is a real backport, not an advisory ignore or version change.

On Linux with the GLib development libraries installed, validate the actual patched dependency in an optimized build:

```sh
cargo test --locked --release --test glib_variant_iter
```

The test covers all five affected iterator entrypoints, interleaved traversal, Unicode/empty strings and exhausted iterators. Windows installer tests do not execute this Linux-only dependency. Remove this backport when the Tauri/GTK dependency graph accepts an upstream fixed GLib release, and retain the behavior regression.
