# Tool Interception: How Results Get Back to the Agent

- **The stub runs instantly in the sandbox** and returns a placeholder string like `"Snapshot will be saved automatically."` — see `packages/shared/src/opencode-tools/index.ts:277` (`save_snapshot`'s execute)

- **OpenCode treats the tool as completed immediately** with the stub's return value. The LLM sees that result and keeps going. OpenCode has no concept of "wait for the gateway."

- **The gateway detects the tool call via SSE** in `apps/gateway/src/hub/event-processor.ts:324` and fires `onInterceptedTool()` at line 348

- **The real handler runs server-side** (e.g., `apps/gateway/src/hub/capabilities/tools/save-snapshot.ts:18` calls `hub.saveSnapshot()`)

- **The gateway races to overwrite the stub result** via `apps/gateway/src/lib/opencode.ts:152-294` — PATCHes the OpenCode HTTP API at `/session/{sid}/message/{mid}/part/{pid}` with the real output

- **If the PATCH wins the race**, the LLM sees the real result when it reads message history. If it loses, the LLM already moved on with the placeholder — but the placeholder is written to be harmless

- **If all 5 retry attempts fail** (`opencode.ts:169`), the gateway logs a warning and gives up silently — the session continues with the stub result
