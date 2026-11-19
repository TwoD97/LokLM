FROM rust:1.95-bookworm@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1 AS build-env
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler libprotobuf-dev clang cmake python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY native/crates/core native/crates/core
COPY native/crates/knowledge/Cargo.toml native/crates/knowledge/Cargo.lock native/crates/knowledge/
COPY native/crates/knowledge/src native/crates/knowledge/src
COPY native/crates/knowledge/tests native/crates/knowledge/tests
COPY native/crates/knowledge/examples native/crates/knowledge/examples
COPY deploy/knowledge/collect_licenses.py /collect_licenses.py
ARG FEATURES=lance
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/native/crates/knowledge/target \
    cargo test --locked --manifest-path native/crates/knowledge/Cargo.toml --features "$FEATURES" -j 2 && \
    cp native/crates/knowledge/target/debug/loklm-knowledge /loklm-knowledge

FROM build-env AS debug-benchmark
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/native/crates/knowledge/target \
    cargo build --locked --manifest-path native/crates/knowledge/Cargo.toml --features bench --examples -j 2 && \
    cp native/crates/knowledge/target/debug/examples/stores_bench /stores_bench

FROM build-env AS build
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/native/crates/knowledge/target \
    cargo build --locked --release --manifest-path native/crates/knowledge/Cargo.toml --features "$FEATURES" -j 2 && \
    cp native/crates/knowledge/target/release/loklm-knowledge /loklm-knowledge && \
    python3 /collect_licenses.py native/crates/knowledge/Cargo.toml "$FEATURES" /licenses

FROM build AS benchmark-build
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/native/crates/knowledge/target \
    cargo build --locked --release --manifest-path native/crates/knowledge/Cargo.toml --features bench --example stores_bench -j 2 && \
    cp native/crates/knowledge/target/release/examples/stores_bench /stores_bench

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS runtime-base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY LICENSE /usr/share/licenses/loklm/LICENSE
COPY deploy/knowledge/MODEL-AUDIT.md /usr/share/licenses/loklm/MODEL-AUDIT.md
USER 1000:1000
ENV LOKLM_VAULT=/knowledge LOKLM_INDEX=/index LOKLM_BIND=0.0.0.0:8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD curl --fail --silent http://127.0.0.1:8787/healthz >/dev/null || exit 1
ENTRYPOINT ["loklm-knowledge"]
CMD ["serve"]

FROM runtime-base AS test-runtime
COPY --from=build-env /loklm-knowledge /usr/local/bin/loklm-knowledge
COPY --from=debug-benchmark /stores_bench /usr/local/bin/stores_bench

FROM runtime-base AS production-base
COPY --from=build /loklm-knowledge /usr/local/bin/loklm-knowledge
COPY --from=build /licenses /usr/share/licenses/loklm/dependencies

FROM production-base AS benchmark
COPY --from=benchmark-build /stores_bench /usr/local/bin/stores_bench

FROM production-base AS production
