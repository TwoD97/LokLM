# Assistant, organizer skills, and MCP connections

Chat has two explicit modes. **Documents** keeps the existing document retrieval and citations. **Assistant** can read the account's calendar, tasks, and notes, and propose actions using connected MCP tools. Hiding an organizer module in navigation does not delete its data or change these permissions.

## Use the built-in organizer

Open Chat in a workspace, choose **Assistant**, and try:

- “What is on my calendar tomorrow?”
- “Create a task to prepare slides, due Friday.”
- “Find my workshop notes.”
- “Append the room number to the workshop note.”

Reads run directly and show result cards. Changes show the exact arguments for review; choose **Apply** or **Dismiss**. Nothing is saved to the organizer while a change is merely proposed. **Open calendar / tasks / notes** opens the relevant item, and mounted organizer views refresh after saves. Unsaved editor drafts retain their original revisions and receive conflict protection.

Local events use local dates and times. They do not send invitations, schedule notifications, or synchronize themselves to an external calendar. Long notes support paged reads and exact excerpt edits so replacing a truncated preview cannot discard the unseen content.

## Connect email, calendars, and other services

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

Connection configuration is stored in the encrypted account vault. Saved environment/header values are not returned to the settings editor: a blank credentials field preserves them, and `{}` clears them. An external server may maintain its own credential files outside LokLM's vault. Local process servers run with your operating-system privileges and the environment values you explicitly configure.

Assistant uses the selected language-model provider. If you configured remote Ollama, the selected organizer content and tool results used to answer your request also go to that model server.

Action cards persist in the workspace conversation. Approval submits persisted IDs, not editable tool arguments. LokLM saves a running marker before executing and coalesces concurrent approvals. An interrupted running action cannot run again automatically: check the destination if its result is uncertain. Regeneration is disabled for turns containing tool actions. Reconnecting or editing a server invalidates its old proposals; ask for a fresh proposal after the connection changes.

The client implements MCP initialize-based stdio and Streamable HTTP for protocol versions 2025-03-26, 2025-06-18, and 2025-11-25, including JSON/SSE replies, pagination, bounded messages, timeouts, cancellation, and session shutdown. It does not implement legacy HTTP+SSE, remote OAuth discovery/login, MCP resources/prompts, sampling, elicitation, or automatic execution/retry of external tools. Unknown client requests receive a capability error. See the [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

The local model receives a bounded tool catalog ranked by the request, plus bounded history and read results. A very small context may omit tools; narrow the request or increase the configured context. Tool descriptions and returned messages are treated as untrusted data. Input validation checks supported JSON Schema constraints; the server remains responsible for enforcing its complete schema and its own account permissions.

## Validation and review

Tests cover organizer reads and reviewed writes, duplicate approval, stale revisions, cancellation, lost receipts, SQLite migration/compare-and-set/reopen, live organizer refresh, dirty editors, connection editing, and action-card restoration. Protocol tests exercise HTTP and stdio through deterministic transports. A real subprocess smoke is included but is skipped when the host explicitly denies subprocess creation.

Validation for this change: 151 backend tests passed with one subprocess-permission skip; 61 chat/settings/shell tests and 27 organizer UI/refresh/date tests passed. Production renderer TypeScript and scoped lint checks passed (two existing ChatView warnings). The full backend typecheck still reports 13 pre-existing cached dependency diagnostics involving node-llama-cpp and missing accessibility-test packages, with no new diagnostics. Tests here used the available cached Vitest 5.0.3 rather than the repository's pinned 4.1.11.

This environment cannot authorize real email/calendar accounts or run the native Electron/GPU application. Live OAuth, actual mail/calendar operations, and packaged application behavior still need a configured installation. The checked-in implementation does not claim those accounts are connected.

The integration follows the reusable-tool and connection-lifecycle approach inspected in [Hermes's MCP implementation](https://github.com/NousResearch/hermes-agent/blob/main/tools/mcp_tool.py); it uses LokLM's provider, encrypted vault, and conversation lifecycle.
