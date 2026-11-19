# Optional NVIDIA runtime preparation; not built or exercised on user hardware.
FROM nvidia/cuda:12.8.1-devel-ubuntu24.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends git cmake ninja-build build-essential ca-certificates libssl-dev libcurl4-openssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# Same llama.cpp source tag as the tested CPU archive, resolved to an exact commit.
RUN git init && git remote add origin https://github.com/ggml-org/llama.cpp.git && git fetch --depth 1 origin b1b770d90d94cad9e9ea5b993bdbc383a522fb28 && git checkout --detach FETCH_HEAD
ARG CUDA_ARCHITECTURES=75;86;89
RUN cmake -S . -B build -G Ninja -DGGML_CUDA=ON -DBUILD_SHARED_LIBS=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=ON -DCMAKE_BUILD_TYPE=Release "-DCMAKE_CUDA_ARCHITECTURES=${CUDA_ARCHITECTURES}" && cmake --build build --target llama-server -j 2
FROM nvidia/cuda:12.8.1-runtime-ubuntu24.04
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/bin/llama-server /opt/llama/llama-server
COPY --from=build /src/LICENSE /opt/llama/LICENSE
COPY model-entrypoint.sh /usr/local/bin/model-entrypoint
RUN chmod +x /usr/local/bin/model-entrypoint
USER 1000:1000
ENTRYPOINT ["model-entrypoint"]
