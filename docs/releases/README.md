# Desktop release procedure

Use a new stable patch version for reliability/security fixes; use a minor version for a new product capability. Complete the application, dependency, native RAG and installer gates; explicitly record validation results, remaining limitations and any approved exceptions in the release notes. Updating the website alone does not update desktop installations.

1. Finish review and the required application/native validation. Update root `package.json` to the agreed version and commit the reviewed sources to `main`. Tauri reads this same package version; do not independently bump its Cargo package metadata.
2. Push `vX.Y.Z` for that exact main commit, or dispatch **Release installer** on it with matching `X.Y.Z`. The workflow validates the version and runs the reusable application/website checks before any packaging.
3. All platforms must build successfully. Windows, Linux and both native Mac runners execute the packaged persistence/restart/shutdown smoke without models or a personal vault. All three installer platforms run their Rust tests. Mac ARM and Intel payloads are built on separate native runners and checked for active native-addon architecture; the shared wizard must contain both Mach-O architectures. The extracted Mac archive must retain its signature. Linux verifies the Debian package version.
4. The publisher verifies all ten installers/archives, their checksums and the three manifests baked into the installers. Required model endpoints must be reachable. Only then are the files uploaded to a new version prefix, and every public artifact is downloaded and hashed.
5. The verified website release manifest is committed to `main` using the existing deploy key. That push starts the normal website deployment, including its checks. Confirm its success and the public download links before announcing availability. A successful upload alone is not a deployed website.

## Recovery and concurrency

Partial platform releases and overwrites of an existing version prefix are rejected. A failed upload remains unadvertised; fix the cause and use a new patch version. Never replace files beneath a URL baked into an already downloaded installer. The workflow serializes its own publishers; restrict other storage writers as well. This is not a storage-level object-lock guarantee.

Publication requires `main` still to point to the reviewed release commit. If it advances while builders run, publishing fails rather than force-pushing or deploying stale source. If it advances after artifact upload, the non-forced manifest push fails safely; preserve the uploaded artifacts and reconcile the manifest in a reviewed commit, without overwriting the version prefix.

## Signing and configuration

Required existing repository secret names are `PUBLIC_INSTALLER_BASE_URL`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, and `MANIFEST_DEPLOY_KEY`. Website hosting uses the normal website workflow's configuration. Never print secret values during readiness checks.

Windows uses the optional existing `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` to sign the app, embedded wizard and outer installer before checksums are recorded. Missing configuration produces unsigned artifacts and is explicitly reported. No certificate identity is created by the workflow.

As of 2026-10-08, the repository's secret-name inventory contains hosting/release credentials but no Windows or Apple signing credentials, and no repository environments or organization inheritance supply them. Without new publisher credentials, this release remains unsigned on Windows and ad-hoc signed on Mac. Do not describe it as an identified-publisher or notarized release.

Mac payloads currently receive an ad-hoc signature with the existing Electron JIT entitlements at build time. This is **not** a Developer ID signature or notarization. The installer preserves downloaded signatures and OS quarantine; it must not re-sign or bypass Gatekeeper during installation. Trusted public Mac distribution still requires the publisher's actual Developer ID/notarization configuration and platform verification. Native architecture and a valid ad-hoc signature do not establish publisher trust.

## Local Mac packaging

`build-mac-payloads.mjs` builds only its host architecture. To aggregate a universal download wizard locally, collect both `payload-mac-arm64.tar.zst` and `payload-mac-x64.tar.zst` plus their SHA256 sidecars from native builds into `release/`. The archive/DMG steps verify both archives first. Do not cross-build by reusing the other architecture's `node_modules`; the release workflow provides separate runners for this purpose.

Mac dependency installation also rebuilds Whisper from pinned sources. The upstream 1.1.0 package contains ARM64 binaries in both Mac directories and absolute build-machine library search paths. The repair requires Xcode command-line tools, CMake and Git; it must succeed before packaging. Native CI checks the addon on both architectures, including loading an isolated copy outside the build directory. Release verification repeats the check on the extracted delivery archive. These load checks do not establish end-to-end transcription quality.

Current runner labels are documented by [GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Tauri documents [package-derived version configuration](https://v2.tauri.app/reference/config/#version) and [the universal Apple target](https://v2.tauri.app/distribute/app-store/).
