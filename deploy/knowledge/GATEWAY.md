# Optional HTTPS peer gateway

`compose.gateway.yaml` adds a TLS reverse proxy for the existing CouchDB LiveSync
database. The base Compose stack remains unchanged and publishes no host ports.
The optional gateway defaults to **127.0.0.1:8443**, requires operator-provided
certificates, and opens no HTTP port or automatic certificate challenge listener.
It does not install a CA, change host DNS/firewalls, create a public tunnel, or
publish a registry image. Enable LAN access only after the operator chooses the
hostname, certificate trust, specific private interface and peer firewall policy.

## Dependency and upstream contract

The unmodified official image is pinned to
`nginx:1.30.7-alpine@sha256:bef154735288bc38d99fac41ae63730684bcc661503673a04a0f9bc526ba8598`.
The linux/amd64 platform manifest is
`sha256:4d1d4ce08432dc7dfe4af762cb224ce6b5273ae878f41e020ea2425d02ea91a4`.
The official image catalog identifies packaging source
`nginx/docker-nginx` commit `a2a986d19aac4a79a330e6e0b5171aae4e521926`,
`stable/alpine`. This is an exact tested dependency candidate, not a promise that
a pinned image receives future fixes automatically. Nginx uses its
[two-clause BSD license](https://nginx.org/LICENSE); retain upstream image/package
notices when distributing it. Review security updates and replace the digest only
after rerunning the acceptance fixture.

Design references:

* [CouchDB reverse proxy guidance](https://docs.couchdb.org/en/stable/best-practices/reverse-proxies.html): continuous replication requires response buffering disabled.
* [Pinned LiveSync server guidance](https://github.com/vrtmrz/obsidian-livesync/blob/5b57324bc72a6c7a330c280b876ae9c6f8e83221/docs/setup_own_server.md): HTTPS can serve private devices without public exposure; root-path CouchDB and sufficient request size avoid common proxy failures.
* [Nginx TLS configuration](https://nginx.org/en/docs/http/ngx_http_ssl_module.html): certificate chain/key files and TLS 1.2/1.3.
* [Nginx proxy directives](https://nginx.org/en/docs/http/ngx_http_proxy_module.html): unbuffered traffic, forwarding headers, cookie flags and explicit timeouts.
* [Nginx upstream DNS](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#resolve): resolve the backend on Docker's DNS rather than retaining a startup-only address.
* [Official image source](https://github.com/nginx/docker-nginx/tree/a2a986d19aac4a79a330e6e0b5171aae4e521926/stable/alpine) and [official image catalog](https://github.com/docker-library/official-images/blob/master/library/nginx).

## Trust and authentication boundaries

TLS terminates in this non-root, read-only gateway. The last hop to CouchDB is
HTTP on the existing private Docker network. Host administrators and containers
on that private network are within the trust boundary; this is not end-to-end
transport encryption between the client and the CouchDB process. LiveSync's
existing encrypted document payload format remains unchanged.

Clients must validate both the certificate chain and hostname. Supply a publicly
trusted certificate obtained through the operator's existing process, or a private
CA already trusted by the intended devices. Installing a private CA is an operator
decision; mobile Obsidian trust behavior still needs testing on the actual device.
Never turn off verification to make a connection work. The supplied fixture's CA
is synthetic and ephemeral; it is never a deployment certificate authority.

The gateway passes CouchDB Basic/session authentication through unchanged and
strips client-supplied CouchDB proxy-auth headers. Use the existing **non-admin
`loklm-sync` credentials** and database `loklm-knowledge`. No new gateway password
is created. Session cookies receive Secure/HttpOnly flags; CORS remains the existing
CouchDB origin allowlist. Root server information, `/_up`, `/_session` and this
database's replication routes are available; Fauxton, server configuration, `_users`,
database listing, security/revision policy, purge/compaction and unrelated paths
are blocked. Database authorization is still enforced
by CouchDB; the path allowlist is not a replacement for its security policy.

The knowledge API is not routed by this overlay. Its private bearer-token boundary
is unchanged. Do not combine `compose.local.yaml` with this peer gateway; the
gateway preflight rejects direct CouchDB/knowledge port publications. A dedicated
operator can still administer the existing stack locally through its containers.

Access and runtime error logging are disabled so request paths, credentials and
note content are not retained by the gateway. Nginx startup config checks can
report local certificate/configuration errors, without printing key contents.
Monitor from a trusted client using authenticated requests and normal TLS checks;
a running container is not a successful handshake or peer-convergence signal.

## Configure and start

1. Complete the base stack's fresh setup in [OPERATIONS.md](OPERATIONS.md). Do not
   reinitialize an established database for HTTPS. Keep the existing server-side
   LiveSync sidecar on its private `http://couchdb:5984` endpoint.
2. Place a PEM certificate chain and matching PEM private key in a private directory
   **outside this checkout and the synchronized vault**. The chain starts with the
   server certificate and includes required intermediates. Keep the CA signing key
   elsewhere; it is never mounted into the proxy. Grant only the chosen container
   UID/GID access to the server key (for example mode 0400 owned by that UID).
3. Fill `LOKLM_TLS_HOST`, `LOKLM_TLS_CERT_FILE` and `LOKLM_TLS_KEY_FILE` in the ignored
   `.env` locally. Use an ASCII DNS hostname present in the certificate SAN, without
   scheme, wildcard or port; use absolute file paths. Keep `LOKLM_TLS_BIND=127.0.0.1`
   initially. These values are not guessed and no certificate/key should be pasted
   into chat. Use the same project/env/overlay flags for every command below.
4. Run `python3 gateway_preflight.py`. It reads Compose configuration and checks
   bindings and file metadata only, never key contents. A pass does not validate
   expiry, hostname matching, issuer trust or a live handshake.
5. Pull only the pinned gateway dependency with
   `docker compose -f compose.yaml -f compose.gateway.yaml pull gateway`, then run
   `docker compose -f compose.yaml -f compose.gateway.yaml up -d --no-deps gateway`.
   The already-running CouchDB is required. Missing/unreadable/mismatched TLS files
   fail startup; there is no automatic self-signed or HTTP fallback.
6. From the intended trusted client, request `https://YOUR_HOST:8443/_up` using
   normal certificate validation. If testing locally before DNS is configured,
   use curl's `--resolve YOUR_HOST:8443:127.0.0.1` and, for a private CA, its
   `--cacert /absolute/public-ca-certificate.pem` option. Never use `-k`. Confirm
   anonymous database requests fail and authenticated non-admin requests succeed.
7. For LAN/VPN use, explicitly change `LOKLM_TLS_BIND` to the host's **specific
   private interface IP**, arrange DNS for `LOKLM_TLS_HOST` on those devices, and
   restrict inbound TCP `LOKLM_TLS_PORT` in the existing firewall to intended peers.
   Preflight rejects wildcard and public bind addresses. Recreate only gateway
   after the operator configures this; no LAN or public bind is performed by tests.
8. In a new disposable Obsidian vault, configure the upstream plugin using
   `https://YOUR_HOST:PORT` as its server URL (no `/couchdb` prefix), the existing
   database name, non-admin credentials and exact LiveSync encryption settings.
   Test both devices before real migration. The restricted gateway intentionally
   cannot perform administrative setup/configuration through the plugin; administer
   the fresh server locally first.

The gateway caps each HTTP request at **50 MiB**, has 60-second client-body and
one-hour upstream read/write timeouts, one worker/CPU and 128 MiB container memory.
These are configuration limits, not validated production capacity. Larger files
may be chunked by upstream LiveSync; the fixture proves a 256 KiB attachment only.
An attachment larger than the per-request ceiling needs deliberate configuration
review and a new test. Streaming `_changes` responses remain unbuffered.

## Certificate rotation, updates and removal

Renew through the operator's existing certificate process. Replace the private
files without logging their contents, then **recreate** gateway with
`docker compose -f compose.yaml -f compose.gateway.yaml up -d --no-deps --force-recreate gateway`.
Individual bind-mounted files can retain an old inode after atomic host-file
replacement; a mere process reload is insufficient for that case. Check the new
certificate fingerprint/expiry and authenticated peer sync from a trusted client.
Keep the previous valid files securely for rollback until validation passes.

For a proxy-image update, retain the old digest/configuration, validate the candidate
with disposable HTTPS peers, and recreate only gateway. Rollback selects the prior
digest/configuration and still-valid certificate files. This does not require a
new knowledge index, CouchDB setup or a vault migration.

To remove external peer access, stop and remove only the gateway service with the
same overlay/project flags. The base services and canonical stores remain intact.
Restore the base-only command set for future starts; do not run a project-wide
`down` merely to remove the proxy. Remove client trust only if the operator's CA
policy requires it; this package never edits global trust stores.

## Manual testing

1. In an admitted disposable Linux/WSL Docker slot, build the existing stack images,
   pull the exact gateway digest, and run `python3 test_gateway.py` from this
   directory. Set `LOKLM_KNOWLEDGE_TEST_IMAGE` if the production tag differs; when
   WSL cannot read Windows worktree Git metadata, set `LOKLM_TEST_SOURCE_COMMIT`
   to the exact checkout commit. The test uses the local Docker Unix socket,
   synthetic private files and a unique project; it publishes only an ephemeral
   loopback port. It requires host OpenSSL and Python 3.11+.
2. Expect trusted HTTPS success, untrusted-CA and unknown-host refusal, anonymous
   and wrong-password denial, preserved non-admin/session/CORS boundaries, blocked
   admin routes, and unchanged private knowledge-token enforcement.
3. Expect actual upstream LiveSync to refuse the untrusted certificate, then transfer
   a Unicode UUID note and binary attachment between peers using only the HTTPS
   gateway network. Expect a continuous changes heartbeat, gateway restart,
   certificate renewal/recreation and successful edit/attachment recovery.
   No TLS verification bypass is used.
4. Expect cleanup of only the fixture's containers/networks, data and CA/keys.
   Confirm existing services were not restarted. The JSON report contains public
   certificate fingerprints, image/source digests and check labels, never secrets.
5. On the eventual target host, repeat with disposable Obsidian desktop/mobile
   vaults, operator-issued certificates, intended DNS/interface/firewall and real
   client trust. Test expiry/renewal, interrupted connection, large attachments
   and both devices' reconnect behavior before real migration.

Local Docker/CLI evidence is recorded separately when executed. It is not an
Unraid host, real Obsidian UI, mobile certificate enrollment, or Internet exposure
acceptance claim.
