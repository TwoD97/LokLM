# Local HTTP cache remediation — 5 October 2026

LokLM now applies a pinned pnpm patch to `http-cache-semantics@4.2.0` for [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp). This is a repository-maintained code correction, not an upstream fixed release or an advisory suppression. The package is a development dependency through `electron-builder → app-builder-lib → @electron/get → got → cacheable-request`; it is not in the 474-dependency production audit.

## Why a local patch

The initial synthetic probe reproduced the shared-cache `max-stale` bypass on both installed 4.2.0 and published 4.3.0. The latter's npm source exactly matched commit `b1d4bd682fbab0252985de45219f4e7497c0067c`. Updating the version alone would move outside the advisory's current affected range without changing the failing behavior. The [upstream issue](https://github.com/kornelski/http-cache-semantics/issues/56) identifies the same conflict between freshness overrides and reuse restrictions; the reviewed advisory currently names no patched version.

## Patch scope

The [patch](../../patches/http-cache-semantics@4.2.0.patch) factors the library's existing zero-lifetime reuse restrictions into a shared check. Request `max-stale` cannot bypass shared Set-Cookie restrictions, shared `proxy-revalidate`, response `no-cache`, non-storable responses or `Vary: *`. The same check prevents `stale-while-revalidate` and failed-origin `stale-if-error` paths from bypassing those restrictions. `must-revalidate` also remains binding across stale extensions. This follows the distinction between ordinary expiration and mandatory validation in [RFC 9111 §4.2.4](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2.4) and [§5.2](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2).

Normal fresh and expired public responses retain their existing behavior. Private caches and the library's existing explicit `public`/`immutable` cookie opt-ins remain supported. Validation can still use ETags, retain a 304-validated body for the current request, and adopt a server's explicit new policy. No field or version is added to serialized policies, so previously stored version 1 policies receive the same protection when loaded. This is a bounded remediation, not a claim that the package implements every HTTP caching rule correctly.

## Regression and installation evidence

[The regression suite](../../tests/unit/scripts/http-cache-semantics-patch.test.mjs) resolves the real packaging dependency chain instead of testing a copied implementation. Against the original installation, 18 of the initial 26 cases failed. With the patch, all 30 current cases pass, covering bounded/unbounded `max-stale`, both request-evaluation APIs, JSON serialization round trips, stale extensions, 304/200 revalidation, rejection of a failed revalidation for protected entries, and normal caching controls.

The patch is registered in `package.json` and hashed in `pnpm-lock.yaml`; its `.gitattributes` rule preserves LF bytes on Windows checkouts. Installation used `pnpm install --ignore-scripts --offline`; only the cache package was replaced and no dependency versions changed. A subsequent `--frozen-lockfile` install succeeded. All three directly addressed SQLite native binaries had unchanged hashes across that reinstall; the main binding hash also matches the prior independently recorded value `2220fb562d831478fa2bd07054e2536b1c54239e93977e30127e404e13a967c9`. No native dependency rebuild was performed.

Reproduce the check with:

```powershell
pnpm install --ignore-scripts --frozen-lockfile
pnpm exec vitest run --project scripts tests/unit/scripts/http-cache-semantics-patch.test.mjs
pnpm audit --json
pnpm audit --prod --json
```

The post-patch registry audit still reports **one high advisory across 1071 total dependencies**, because it sees the unchanged upstream package version rather than reviewing the local diff. The production audit reports **zero advisories across 474 dependencies**. Nothing is ignored, suppressed or relabeled as an upstream fix. Local raw evidence is retained under `out/optimization-20261005/dependency-review/` in `audit-patched-all.json`, `audit-patched-prod.json` and `native-hashes-frozen-result.json`.

Retain this patch and regression suite until a genuine upstream fix passes the same cases. When upgrading packaging dependencies, verify the resolved package still receives the patch; if the package disappears from the graph, remove the patch and dependency-chain test together after confirming the advisory path is gone.
