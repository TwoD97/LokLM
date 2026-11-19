# Narrow official LiveSync sidecar. No locally invented CouchDB wire format.
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init && git remote add origin https://github.com/vrtmrz/obsidian-livesync.git && git fetch --depth 1 origin 5b57324bc72a6c7a330c280b876ae9c6f8e83221 && git checkout --detach FETCH_HEAD && git submodule update --init --recursive
# Use the upstream lock including its workspaces; avoid upstream Dockerfile's
# separate unlocked runtime npm install (npm edgesOut failure with npm 10.9.9).
RUN npm ci --legacy-peer-deps --no-audit --no-fund && npm run build -w self-hosted-livesync-cli

FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /app
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/src/apps/cli/dist ./dist
COPY --from=build /src/LICENSE ./LIVESYNC-LICENSE
USER 1000:1000
ENTRYPOINT ["node","/app/dist/index.cjs","/state","--settings","/state/settings.json","--vault","/vault"]
CMD ["daemon"]
