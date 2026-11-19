FROM couchdb:3.5.0
# Bake static nonsecret config with image ownership. A root-owned read-only bind
# fails the upstream entrypoint's ownership repair on some Docker/WSL hosts.
COPY --chown=couchdb:couchdb --chmod=0644 couchdb.ini /opt/couchdb/etc/local.d/loklm.ini
