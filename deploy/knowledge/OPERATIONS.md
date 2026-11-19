# First run and recovery

This runbook targets the supplied Compose stack. Local Linux Docker fixtures are
the acceptance environment; actual Unraid installation, Obsidian UI and a remote
TLS gateway remain untested. The base stack provides lexical retrieval. Dedicated
LokLM model overlays are optional; basic QA remains experimental.

## Host and source preparation

Use a complete checkout at a recorded commit, Docker Engine with `docker compose`
available, and Python 3.11+ for the host administration scripts. Check
`docker compose version` and `python3 --version` before proceeding. Python and
Compose availability on the future Unraid host must be established there; this
package does not install host plugins or change the host OS. Build from the
repository root as described in README; the Dockerfile needs the shared core.

Use encrypted local SSD storage. Choose the actual pool path instead of assuming
the pool is named `cache`. Create three separate trees: canonical knowledge,
derived index, and appdata containing `livesync` and `couchdb`. Run the daemon and
LiveSync with a non-root UID/GID that can read/write their respective trees; the
daemon mounts canonical files read-only. Use the CouchDB image's ownership rules
for its separate data directory. Disable array migration for the active index.

In `deploy/knowledge`, copy `.env.example` to private `.env`, fill its paths,
UID/GID and fresh CouchDB admin credentials locally, and create private
`secrets/api_token` and `secrets/vault_passphrase` using a password manager or local
secure generator. No credentials belong in commands, chat or reports. The API
token needs at least 32 characters, the passphrase at least 24. Grant read access
to the configured container UID and restrict `.env` and the secrets directory.
Retain an encrypted separate copy of these files and later `settings.json`.

From this directory, use the **same project, env file and overlays every time**.
The examples use the base project's default name and `.env`. If using another
project or overlay, pass `--project-name NAME --env-file FILE -f compose.yaml
-f OVERLAY` to Compose and the equivalent arguments to `manage.py`.

1. Run `python3 preflight.py`. Fix every issue; this check does not start services.
2. Build with `docker compose build knowledge livesync couchdb`. Builds run Cargo
   with two jobs. Record `git rev-parse HEAD` and the resulting image IDs with
   `docker image inspect --format '{{.Id}}' IMAGE`.
3. Run `docker compose up -d --wait couchdb`, then
   `docker compose --profile setup run --rm setup` exactly once for fresh state.
   Existing settings/database/user are deliberately refused. If interrupted,
   preserve the partial state and diagnose it; there is no automatic destructive
   reset. Never retry by deleting an established database or sync user.
4. Run `docker compose up -d knowledge livesync`, then `python3 manage.py doctor`.
   A new empty vault is valid. For a nonempty vault, each Markdown note requires
   a unique `loklm_id`; use `prepare_vault.py` on a separate copy before startup.
5. `doctor` exits 0 only for recent local index readiness, a running stack and
   authenticated encrypted remote configuration. Exit 1 means degraded; exit 2
   means the check could not complete. Its output omits tokens, note text and
   raw logs. **It does not prove peer convergence or absence of conflicts.**
6. Before real migration, connect two disposable Obsidian vaults using the
   supported LiveSync setup UI, private non-admin settings and an authenticated
   TLS/VPN gateway. Test note/attachment, edit, rename, delete, offline conflict
   and recovery. The supplied stack publishes no host ports; `compose.local.yaml`
   adds loopback-only access for local administration, not LAN access.

The Unraid `unraid.xml` template starts **only** the knowledge daemon. Build its
image locally first, create the private Compose network and configure its paths
and UID/GID to match the stack. Do not run both the template daemon and Compose's
knowledge service against one index. Use either Compose for all services (the
tested local configuration), or the template daemon with separately administered
LiveSync/CouchDB. No prepublished registry image is promised by the template.

## Readiness and failed scans

Anonymous `/healthz` means the process is alive. Authenticated `/v1/ready` returns
200 only after a successful reconciliation **in this process** less than 90
seconds ago, 503 before that or after a failed/stale scan, and 423 when locked.
It does not query model servers or CouchDB. A previously successful persisted
index cannot make a restarted process ready without a new successful scan.
Long indexing/model operations may temporarily exceed the freshness window.
Authenticated `/v1/status` preserves counts and sanitized errors for diagnosis.

For an invalid/duplicate UUID, restore valid source files and retry reconciliation;
the failed scan preserves the previous checkpoint. After correcting the issue,
the watcher or `POST /v1/reconcile` restores readiness. For a detailed local error,
stop only knowledge and run `docker compose run --rm --no-deps knowledge reconcile`,
then `docker compose up -d knowledge`. Keep detailed output private.

During a CouchDB outage, local retrieval may stay ready while `doctor` reports
remote failure. Restore connectivity/authentication without reinitializing the
database; wait for the existing upstream daemon to reconnect and verify a new
synthetic change on the other peer. A successful network check alone does not
establish that queued changes finished replicating.

## Inspect and recover conflicts

Do not run a second CLI process against the daemon's PouchDB directory. Stop this
stack's LiveSync service first, then inspect its last replicated local state:

```sh
docker compose stop livesync
python3 manage.py conflicts
```

The JSON report uses the actual upstream `ls` revision markers. Exit 1 means
conflicts were found, 0 means none in that local snapshot, and 2 means unknown or
inspection refused. It includes private note paths; store the report privately.
For current remote state, while the daemon is stopped run one explicit
`docker compose run --rm --no-deps livesync sync` and inspect again. That sync
replicates revision data; it is not a read-only remote probe.

Review each affected path with the maintained CLI. Replace the illustrative path
and revisions below with the actual report/info values. Prepare a **new empty**
private recovery directory outside the canonical vault and mount it separately:

```sh
docker compose run --rm --no-deps livesync info 'Notes/Example.md'
docker compose run --rm --no-deps -v /absolute/private/recovery:/recovery livesync pull-rev 'Notes/Example.md' /recovery/winner.md WINNING_REV
docker compose run --rm --no-deps -v /absolute/private/recovery:/recovery livesync pull-rev 'Notes/Example.md' /recovery/alternative.md CONFLICT_REV
```

Recover **every** listed branch to distinct files, review their text and attachment
references, and keep the recovery copy. Only then explicitly choose a revision
with `docker compose run --rm --no-deps livesync resolve 'Notes/Example.md' KEEP_REV`,
run `sync`, recheck conflicts, and `docker compose up -d livesync`. To merge text,
first preserve all branches and resolve deliberately, then edit the canonical
note after synchronization. Preserve the UUID of the original note; a separately
kept new note needs a new UUID. The winning revision can be indexed while a
conflict exists; retrieval never claims every branch was reviewed.

## Backup and isolated restore

1. Stop external editors/peers that can write, then
   `docker compose stop livesync knowledge`. Stop any dedicated model containers
   as well if locking their encrypted volumes. These commands affect only the
   selected project; never stop unrelated Docker services.
2. Run `python3 backup.py backup /absolute/vault /encrypted/backup/source.tar.gz`,
   then `python3 backup.py verify /encrypted/backup/source.tar.gz`. Archive paths
   must be new and outside the source tree. Files and archives use private Unix
   permissions. The archive itself is **not encrypted by the script**.
3. Retain private `.env`, secrets and LiveSync settings separately. For full
   revision/conflict history also stop this project's CouchDB and snapshot its
   data and LiveSync state on encrypted storage. Source-only backup does not
   preserve remote revisions. Never rely on copying live SQLite/Lance files.
4. Restore source files with `python3 backup.py restore ARCHIVE NEW_VAULT`.
   Verification precedes extraction; existing destinations, traversal and links
   are refused. Set ownership on the **new** tree for the intended UID/GID.
5. Use a different Compose project, new appdata, new index, fresh local credentials
   and a fresh remote DB. Run preflight/setup/start/doctor there. Compare UUIDs,
   note hashes, attachments and retrieval. Do not reconnect a historical snapshot
   to an old active remote: its tombstones/edits could replay into the restore.
6. Keep the old deployment stopped and intact until the isolated restore has been
   reviewed. Choose the migration direction explicitly with LiveSync when ready.

## Upgrade and rollback

Record the current source commit, image IDs, configuration, model aliases and
index path. Tag existing local images with a unique rollback tag before building
so a reused `0.1.0` tag cannot lose the old artifact. Take and verify the stopped
source backup above. Test the candidate images against disposable data first.

For changed model/runtime/chunker/index contracts, select a **new empty index
directory** and retain the old one. Start the new image with the intended source
tree, check readiness, source counts, UUIDs and known searches, and then resume
peers. Never share an index with desktop or another daemon. A rebuild may need
the configured models; lexical-only rebuilds do not.

Rollback: stop the candidate's writers/knowledge, select the retained old image
tag and its matching old index path, start knowledge and verify its new scan,
then resume sync. Do not downgrade a newly mutated index in place. Keep canonical
source changes made since the upgrade; restoring an older source snapshot is a
separate isolated restore operation, not a routine index rollback.
