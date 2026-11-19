FROM ubuntu:24.04 AS fetch
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/llama
RUN curl -fL https://github.com/ggml-org/llama.cpp/releases/download/b12359/llama-b12359-bin-ubuntu-x64.tar.gz -o /tmp/llama.tar.gz && \
    echo '0bc1f091e8916102b6d8f2cf944233a620e90a0f856c72d0ce41150c65c2e72e  /tmp/llama.tar.gz' | sha256sum -c - && \
    tar -xzf /tmp/llama.tar.gz --strip-components=1 -C /opt/llama
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=fetch /opt/llama /opt/llama
COPY model-entrypoint.sh /usr/local/bin/model-entrypoint
RUN chmod +x /usr/local/bin/model-entrypoint
USER 1000:1000
ENV LD_LIBRARY_PATH=/opt/llama
ENTRYPOINT ["model-entrypoint"]
