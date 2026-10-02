# Optional build provenance for native evaluation

The normal app build command is unchanged. When an evaluation needs a build-to-source record, run from the repository root while production sources are frozen and no native test is using `out/`:

```powershell
node tests/bench/build-provenance.cjs --build
node tests/bench/build-provenance.cjs --verify
```

The wrapper invokes the installed `electron-vite` CLI through Node with `shell:false` and a hidden Windows child process. It hashes `src/`, `patches/`, `resources/`, `public/`, relevant root build/TypeScript/package/lock/env files before and after compilation. If those input files change during the build, it fails and does not write a new manifest. File additions/deletions count as changes. Symbolic links in captured trees are rejected rather than silently excluding their contents.

A successful build writes `out/build-provenance.json` with input hashes, all output-file hashes under `out/main`, `out/preload` and `out/renderer`, timestamps and tool versions. It stores only hashes of relevant build-environment values, never their values or source contents. The manifest is separate from those output directories and cannot hash itself.

Native calibration records the verification result before and after a run:

- `matched` means the compiled files match the manifest's exact output set and hashes. `sourceHashesAtBuild` identifies the captured build inputs.
- `matched` with `currentSourcesMatchBuild:false` means later source edits have not been compiled into that output. The changed paths are listed; they are not silently treated as runtime code.
- Missing, invalid or stale manifests yield `unknown`. Historical builds still run, but source-to-output correspondence cannot be inferred from current working-tree hashes. Added or altered compiled files also make correspondence unknown.

This is a reproducibility record, not a signed attestation or a complete dependency sandbox. It records the package/lock/patch inputs and tool versions, not every byte of `node_modules`, the OS, drivers or external build environment. Freeze sources during compilation; comparing before and after cannot detect an edit that was made and reverted between those snapshots. Preserve a run's recorded evidence instead of relabeling old results after a later build.
