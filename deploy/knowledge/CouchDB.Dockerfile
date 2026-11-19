FROM couchdb:3.5.0@sha256:1c0a30a54535377bc9ae23f42efb1ca4e92abe796f78ec98b768ac1d5874cc1b
# Bake static nonsecret config with image ownership. A root-owned read-only bind
# fails the upstream entrypoint's ownership repair on some Docker/WSL hosts.
COPY --chown=couchdb:couchdb --chmod=0644 couchdb.ini /opt/couchdb/etc/local.d/loklm.ini
