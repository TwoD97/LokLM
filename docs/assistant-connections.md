# Assistant, organizer skills, and connections

Chat has two explicit modes. **Documents** keeps the existing document retrieval and citations. **Assistant** can read the account's calendar, tasks, and notes, and propose actions using Fastmail, Obsidian/CouchDB and connected MCP tools. Hiding an organizer module in navigation does not delete its data or change these permissions.

## Use the built-in organizer

Open Chat in a workspace, choose **Assistant**, and try:

- “What is on my calendar tomorrow?”
- “Create a task to prepare slides, due Friday.”
- “Find my workshop notes.”
- “Append the room number to the workshop note.”

Reads run directly and show result cards. Changes show the exact arguments for review; choose **Apply** or **Dismiss**. Nothing is saved to the organizer while a change is merely proposed. **Open calendar / tasks / notes** opens the relevant item, and mounted organizer views refresh after saves. Unsaved editor drafts retain their original revisions and receive conflict protection.

Local events use local dates and times. They do not send invitations, schedule notifications, or synchronize themselves to an external calendar. Long notes support paged reads and exact excerpt edits so replacing a truncated preview cannot discard the unseen content.

## Connect email, calendars, and other services

### Fastmail

Choose **Fastmail** in Settings → Connections. Create a personal [Fastmail API token](https://app.fastmail.com/settings/security/tokens) and enter it in the password field. Save, then Connect. No MCP installation is needed. Mail access provides mailbox listing, message search and message reading; submission access also exposes identities, draft creation and sending. Server permissions still apply to each operation.

Ask Assistant to search your Fastmail inbox. Review and run the search, then request a message by its ID. Message bodies have explicit truncation markers and a 24,000-character combined limit; attachments are not downloaded. Creating a draft and sending are separate tools. Sending shows the From address, recipients, subject and full plain-text body for review; From must match a sending identity. A send is submitted once. If its outcome is uncertain, inspect Drafts and Sent before proposing another send.

This is an email connector. Fastmail calendars use CalDAV and are not included here; LokLM's organizer calendar and separately configured calendar MCP tools remain available. See [Fastmail's developer documentation](https://www.fastmail.com/dev/) and the [JMAP mail specification](https://www.rfc-editor.org/rfc/rfc8621.html).

### Obsidian Self-hosted LiveSync / CouchDB

Choose **Obsidian / CouchDB**. Enter the full database URL (for example `https://notes.example/vault`), CouchDB username/password, and the separate **LiveSync encryption passphrase**. Use your existing LiveSync encryption configuration. Credentials and the passphrase are stored in LokLM's encrypted account vault; decryption happens in the main process. The passphrase is never sent to CouchDB or exposed as a tool argument. Connect checks database access; encrypted reads authenticate the passphrase.

Assistant can list notes, filter filenames within each scanned page, read paged text, and **edit existing notes**. Follow `nextCursor` even if a filtered page is empty. Reads reconstruct ordered LiveSync chunks, including inline Eden chunks, and return the note ID, path and revision. This does not build a full-vault search index.

Edits show the path, expected revision and entire replacement text for review. They require the exact revision returned by a prior read, verify the old chunks, and use CouchDB's normal revision precondition. A stale revision or conflict fails without overwriting the current note. New chunks are encrypted locally before upload, and encrypted filenames/metadata remain encrypted. Writes use fresh immutable chunk IDs rather than deduplicating content, then update the existing note revision. If the metadata write fails after a chunk was stored, that unreferenced chunk may remain; LokLM never deletes existing/shared chunks or automatically retries a write. Check the note in Obsidian after an uncertain result.

Supported encrypted envelopes are LiveSync's legacy `%`/JSON AES-GCM formats (including dynamic iteration reads) and `%=` PBKDF2/HKDF format, with encrypted metadata, paths and Eden. HKDF reads use the existing replication salt and never generate or replace one. Unknown formats, corrupt data, unresolved conflicts and binary attachments fail explicitly. Writes support current `plain` LiveSync notes and unambiguous plain JSON notes with one `content`, `text` or `body` field. New-note creation, renaming, deletion, binary/legacy-note writes and full sync/replication are not implemented. Replacement text is limited to 24,000 characters; reads are limited to 256 chunks / 1,000,000 characters with 16,000 characters per returned page. Read all pages before replacing a long note.

Format references: upstream [LiveSync encryption transforms](https://github.com/vrtmrz/livesync-commonlib/blob/main/src/pouchdb/encryption.ts), [HKDF envelopes](https://github.com/vrtmrz/octagonal-wheels/blob/main/src/encryption/hkdf.ts), [legacy envelopes](https://github.com/vrtmrz/octagonal-wheels/blob/main/src/encryption/encryption.ts), [note/chunk assembly and revision handling](https://github.com/vrtmrz/livesync-commonlib/blob/main/src/managers/EntryManager/EntryManagerImpls.ts), and [CouchDB document updates](https://docs.couchdb.org/en/stable/api/document/common.html#put--db-docid).

### Other services via MCP

Go to **Settings → Connections**. Add a server using either:

- **Local process (stdio):** an executable, its argument array, and environment variables.
- **HTTP:** a Streamable HTTP MCP endpoint and optional authentication headers. Remote endpoints require HTTPS; local HTTP uses a literal loopback address such as `http://127.0.0.1:8000/mcp`.

Save the configuration, then choose **Connect**. LokLM initializes the server and displays its discovered tools. Saving a configuration alone does not launch it. After locking/reopening LokLM, reconnect the server explicitly. Disconnect stops its process or HTTP session and removes its tools from chat.

All external tool calls require **Run tool**, including reads. This makes it visible which service receives which arguments. For example, ask Assistant to search your inbox, review the search arguments, run the tool, then ask a follow-up such as “Summarize those messages.” Completed tool results are included in subsequent Assistant turns. Sending mail or editing an external calendar is a separate reviewed action.

### Gmail and Google Calendar example

[Google Workspace MCP](https://github.com/taylorwilsdon/google_workspace_mcp) is a third-party server exposing Gmail and Google Calendar. Follow its [setup guide](https://workspacemcp.com/quick-start) to install its launcher, configure Google APIs/OAuth, and authorize your account. LokLM does not create OAuth credentials or sign into Google on your behalf.

The editable Gmail + Google Calendar preset uses:

```text
Command: uvx
Arguments: ["workspace-mcp", "--tools", "gmail", "calendar"]
```

Supply your own values in **Environment variables**:

```json
{
  "GOOGLE_OAUTH_CLIENT_ID": "your-client-id",
  "GOOGLE_OAUTH_CLIENT_SECRET": "your-client-secret"
}
```

Use the executable's absolute path if the desktop application cannot find `uvx`. Complete the server's authorization flow before requesting private data. The preset configures a launch command; it does not install the server or grant access to your account. Other mail/calendar MCP servers can be configured through the same form using their own setup instructions.

## Storage, retries, and limits

Connection configuration is stored in the encrypted account vault. Saved environment/header values are not returned to the settings editor: a blank credentials field preserves them, and `{}` clears them for MCP. Native connector fields preserve their individual saved values when blank; remove the connection to erase all its credentials. Switching connector types does not transfer secrets. An external server may maintain its own credential files outside LokLM's vault. Local process servers run with your operating-system privileges and the environment values you explicitly configure.

Assistant uses the selected language-model provider. If you configured remote Ollama, the selected organizer content and tool results used to answer your request also go to that model server.

Action cards persist in the workspace conversation. Approval submits persisted IDs, not editable tool arguments. LokLM saves a running marker before executing and coalesces concurrent approvals. An interrupted running action cannot run again automatically: check the destination if its result is uncertain. Regeneration is disabled for turns containing tool actions. Reconnecting or editing a server invalidates its old proposals; ask for a fresh proposal after the connection changes.

The client implements MCP initialize-based stdio and Streamable HTTP for protocol versions 2025-03-26, 2025-06-18, and 2025-11-25, including JSON/SSE replies, pagination, bounded messages, timeouts, cancellation, and session shutdown. It does not implement legacy HTTP+SSE, remote OAuth discovery/login, MCP resources/prompts, sampling, elicitation, or automatic execution/retry of external tools. Unknown client requests receive a capability error. See the [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

The local model receives a bounded tool catalog ranked by the request, plus bounded history and read results. A very small context may omit tools; narrow the request or increase the configured context. Tool descriptions and returned messages are treated as untrusted data. Input validation checks supported JSON Schema constraints; the server remains responsible for enforcing its complete schema and its own account permissions.

## Validation and review

Tests cover organizer reads and reviewed writes, duplicate approval, stale revisions, cancellation, lost receipts, SQLite migration/compare-and-set/reopen, live organizer refresh, dirty editors, connection editing, and action-card restoration. Protocol tests exercise HTTP and stdio through deterministic transports. A real subprocess smoke is included but is skipped when the host explicitly denies subprocess creation.

The earlier organizer/MCP change passed 151 backend tests with one subprocess-permission skip, 61 chat/settings/shell tests and 27 organizer UI/refresh/date tests. The native-connector addition passed 37 dedicated tests, 12 connection-settings tests and the existing MCP/approval regressions (103 passing focused tests across these runs, with the same subprocess-permission skip). Encryption fixtures use independent WebCrypto encryption to check Node-based decryption, including Unicode, tampered tags, legacy iteration variants and encrypted metadata/chunks. Write tests cover stale revisions, ciphertext-only uploads, partial upload failure, missing chunks and invalid passphrases; lock tests verify request cancellation.

Those initial focused runs used cached dependencies. The subsequent full-access validation installed the exact frozen lockfile and passed the full application/test TypeScript check, production build, and **5,349 tests with ten skipped** under the pinned Vitest 4.1.11. The real MCP subprocess test also passes under Electron as Node. Full ESLint reports zero errors and two existing cleanup-ref warnings. See the [application review](research/2026-10-18-application-review.md) for desktop, packaged persistence, and native installer results.

Real Fastmail/CouchDB credentials were not supplied. Live account operations, Obsidian replication of edited notes, external OAuth and GPU behavior still need verification in a configured installation. Packaged application persistence checks do not establish live connector compatibility. The checked-in implementation does not claim those accounts are connected or production-validated.

The integration follows the reusable-tool and connection-lifecycle approach inspected in [Hermes's MCP implementation](https://github.com/NousResearch/hermes-agent/blob/main/tools/mcp_tool.py); it uses LokLM's provider, encrypted vault, and conversation lifecycle.
