# Session Portability: Gemini CLI

## Bottom Line

Gemini CLI sessions are stored as single JSON files on local disk under a
project-scoped temp directory. The storage path is derived from a
human-readable project slug (mapped from the absolute project root path via a
global registry). Sessions carry their full conversation transcript inline
(messages, tool calls with results, thoughts, tokens). On resume, the CLI
replays the full message history into the Gemini API as a new chat with
prepopulated history -- there is no server-side session state to rejoin.

Moving a session to another machine requires: (1) the session JSON file,
(2) optionally the tool-output sidecar directory, and (3) re-creating the
project registry mapping so the new machine can find the session under the
correct project slug. Absolute paths are embedded in tool call arguments/results
and in masked tool output file references, making transcript content
path-sensitive but not lookup-sensitive. Collection should only happen for a
quiescent session; exporting the JSON while Gemini CLI is rewriting it risks
capturing an inconsistent document.

## Resume Path

Entry point: `gemini --resume <identifier>` (alias `-r`).

Identifier forms:
- `latest` -- selects the most recent session by `startTime`
- A full UUID -- matched against `sessionId` in each session file
- A 1-based integer index -- indexes sessions sorted oldest-first by
  `startTime`

Flow:
1. `parseArguments()` in `packages/cli/src/config/config.ts` parses `--resume`
   (with `skipValidation` so bare `--resume` with no value coerces to
   `"latest"`).
2. In `packages/cli/src/gemini.tsx` (~line 583), the resume flag triggers
   `SessionSelector.resolveSession(argv.resume)`.
3. `SessionSelector` (in `packages/cli/src/utils/sessionUtils.ts`) reads the
   `chats/` directory under the project temp dir, parses each
   `session-*.json` file, deduplicates by sessionId, sorts by startTime, and
   selects the matching session.
4. The resolved `ConversationRecord` is wrapped into `ResumedSessionData`
   (`{ conversation, filePath }`).
5. `config.setSessionId(resumedSessionData.conversation.sessionId)` --
   subsequent recording continues writing to the **same** session file.
6. In interactive mode, `useSessionResume` hook
   (`packages/cli/src/ui/hooks/useSessionResume.ts`) calls
   `convertSessionToClientHistory()` to rebuild the Gemini API Content array,
   then calls `config.getGeminiClient().resumeChat(clientHistory, resumedData)`
   which creates a new `GeminiChat` instance pre-seeded with that history.
7. Workspace directories saved in the session's `directories` field are
   re-added to `WorkspaceContext` (filtering out paths that no longer exist).

There is also a session browser UI (in-app `/sessions` command) that uses the
same `SessionSelector` / `getSessionFiles` machinery.

## Durable Identity

**Session ID**: UUID v4, generated at process startup.

Source: `packages/core/src/utils/session.ts`:
```
export const sessionId = randomUUID();
```
This module-level constant is imported by `gemini.tsx` and passed as
`sessionId` into `loadCliConfig` -> `Config` constructor -> `_sessionId`.

On resume, `config.setSessionId()` overwrites it with the original session's
UUID so the `ChatRecordingService` continues appending to the same file.

**Session file name format**:
`session-{ISO-timestamp-to-minute}-{first-8-chars-of-uuid}.json`

Example: `session-2026-04-10T14-32-a1b2c3d4.json`

Generated in `ChatRecordingService.initialize()` at
`packages/core/src/services/chatRecordingService.ts` ~line 214.

Subagent sessions use a different naming: `{subagent-uuid}.json` nested under
`chats/{parent-session-uuid}/`.

**Project identifier**: A human-readable slug derived from `path.basename(projectRoot)`,
managed by `ProjectRegistry` (`packages/core/src/config/projectRegistry.ts`).
The registry lives at `~/.gemini/projects.json` and maps normalized absolute
project paths to slugs (e.g., `/Users/pablo/myproject` -> `myproject`,
`/Users/pablo/myproject` duplicate -> `myproject-1`). Ownership markers
(`.project_root` files) are written inside each slug directory under
`~/.gemini/tmp/` and `~/.gemini/history/` to prevent collisions.

Legacy: before the registry, a SHA-256 hash of the project root was used.
`StorageMigration` in `packages/core/src/config/storageMigration.ts` handles
migration from hash-based to slug-based directories.

## Required Artifacts

### Primary: Session JSON

Location: `~/.gemini/tmp/{project-slug}/chats/session-{timestamp}-{short-id}.json`

Schema (`ConversationRecord` from `packages/core/src/services/chatRecordingService.ts`):

```ts
interface ConversationRecord {
  sessionId: string;           // UUID
  projectHash: string;         // SHA-256 of project root (legacy field name)
  startTime: string;           // ISO 8601
  lastUpdated: string;         // ISO 8601
  messages: MessageRecord[];   // full transcript
  summary?: string;            // AI-generated summary
  directories?: string[];      // workspace dirs added via /dir add
  kind?: 'main' | 'subagent';
}
```

Each `MessageRecord` includes:
- `id`: UUID (per-message)
- `timestamp`: ISO 8601
- `type`: `'user' | 'gemini' | 'info' | 'error' | 'warning'`
- `content`: `PartListUnion` (string or Part[])
- `displayContent?`: separate display-friendly version
- For `gemini` type: `toolCalls?: ToolCallRecord[]`, `thoughts?`, `tokens?`,
  `model?`

Each `ToolCallRecord` includes:
- `id`, `name`, `args`, `result` (PartListUnion or Part[]), `status`,
  `timestamp`, `displayName`, `description`, `resultDisplay`,
  `renderOutputAsMarkdown`

The `result` field contains the **full** tool output (or a masked/truncated
placeholder referencing a sidecar file). Tool call results are also stored
inline as `functionResponse` Parts when `updateMessagesFromHistory()` is called.

### Secondary: Tool Output Sidecar Files

Location: `~/.gemini/tmp/{project-slug}/tool-outputs/session-{session-uuid}/`

These are created by two services:
1. **ToolOutputMaskingService** (`packages/core/src/context/toolOutputMaskingService.ts`):
   When tool outputs exceed ~80k tokens, older outputs are "masked" -- the full
   content is saved to a `.txt` file and the in-memory history is replaced with
   a summary referencing the file path.
2. **ToolOutputDistillationService** / `saveTruncatedToolOutput()`
   (`packages/core/src/utils/fileUtils.ts`): Large tool outputs are truncated
   and the full version saved to disk with a file path reference.

These sidecar files contain the raw tool output. The absolute path to the
sidecar file is embedded in the masked placeholder text in the API history.

For portability: these files are **not** required for basic resume. They are
only needed if the model tries to reference a masked output via the file path
in the placeholder text (e.g., `read_file` on the sidecar path). Without them,
the session will resume but some historical tool outputs will show truncated
placeholders.

### Tertiary: Activity Log

Location: `~/.gemini/tmp/{project-slug}/logs/session-{session-uuid}.jsonl`

Per `sessionOperations.ts`, this is a JSONL activity log. It is deleted with
the session but is **not** used for resume.

### Tertiary: Per-session State Directories

Location: `~/.gemini/tmp/{project-slug}/{session-uuid}/`

Contains session-scoped subdirectories:
- `plans/` -- plan mode artifacts
- `tracker/` -- todo tracker state
- `tasks/` -- task data

These are referenced by `Storage.getProjectTempPlansDir()`,
`getProjectTempTrackerDir()`, and `getProjectTempTasksDir()` (all in
`packages/core/src/config/storage.ts`). These are **not** required for basic
session resume but would be needed to fully restore plan/task state.

### Tertiary: Git Checkpoints

Location: `~/.gemini/tmp/{project-slug}/checkpoints/`

Used by the `/restore` command to undo changes. These are git-level artifacts
(commit hashes + history snapshots), not session resume artifacts.

### Not Required for Resume

- `~/.gemini/history/{project-slug}/` -- shell command history, not session
  transcript
- `~/.gemini/memory/{project-slug}/` -- project memory (GEMINI.md-derived),
  loaded fresh from disk on startup
- `~/.gemini/projects.json` -- only needed to resolve project slug; can be
  recreated

## Lookup Sensitivity

**Project path is the partition key.** Session files are stored under
`~/.gemini/tmp/{project-slug}/chats/`. The slug is derived from the project
root's absolute path via the `ProjectRegistry`. The same project on a different
machine with a different absolute path will get a different slug and will not
find existing sessions.

**CWD matters.** The project root is typically `process.cwd()` (or the value
passed as `cwd` to `loadCliConfig`). This determines which project slug is
used, and therefore which `chats/` directory is scanned for sessions.

**Within a project, session lookup is path-independent.** Sessions are found
by scanning `*.json` files in the chats directory and matching by UUID or
index -- no path is encoded in the lookup key.

**The `projectHash` field in `ConversationRecord` is a SHA-256 of the project
root path.** In the current inspected resume path, it does not appear to be
used for lookup or validation during resume. Treat it as a legacy/informational
field today, but also as a future-compatibility risk if Gemini CLI starts
validating it later.

## Transcript / Tool History Path Sensitivity

**Tool call arguments contain absolute paths.** For example, `read_file`,
`write_file`, `edit`, `shell` tool calls record the absolute file paths in
their `args` field. Example:
```json
{ "name": "read_file", "args": { "file_path": "/Users/pablo/myproject/src/main.ts" } }
```

**Tool call results may contain absolute paths.** File contents, shell output,
grep results, etc., are stored verbatim.

**Masked/truncated tool output placeholders contain absolute paths to sidecar
files.** Example embedded in history:
```
For full output see: /Users/pablo/.gemini/tmp/myproject/tool-outputs/session-abc123/shell_call1_xyz.txt
```

**The `directories` field contains absolute paths.** These are workspace
directories added via `/dir add` and are restored on resume. The resume code
filters out paths that no longer exist on disk.

**Impact on portability:** If a session is moved to a machine where the project
lives at a different absolute path, the historical tool calls will reference
the old paths. This doesn't prevent resume (the session loads and the model
gets the full history), but the model may be confused by stale absolute paths
in its context. A path-rewriting pass on the transcript would mitigate this.

## Minimal Export Spec

To make a Gemini CLI session portable, export:

0. Ensure the session is quiescent. Do not export while Gemini CLI may still be
   rewriting the session JSON file.
1. **Session JSON file**:
   `~/.gemini/tmp/{project-slug}/chats/session-{timestamp}-{short-id}.json`

2. **Tool output sidecar directory** (optional, for full fidelity):
   `~/.gemini/tmp/{project-slug}/tool-outputs/session-{session-uuid}/`

3. **Session state directory** (optional, for plan/task state):
   `~/.gemini/tmp/{project-slug}/{session-uuid}/`

4. **Subagent sessions** (if any):
   `~/.gemini/tmp/{project-slug}/chats/{session-uuid}/*.json`

Total: 1 required file + up to 3 optional directories.

## Minimal Install Spec

To install a session on a new machine:

1. Determine the target project slug. Either:
   - Run `gemini` once from the project root to auto-create the registry
     mapping, then note the slug from `~/.gemini/projects.json`.
   - Or manually add a mapping in `~/.gemini/projects.json`:
     `{ "projects": { "/new/path/to/project": "myproject" } }`

2. Place the session JSON file at:
   `~/.gemini/tmp/{slug}/chats/session-{timestamp}-{short-id}.json`

3. Optionally place sidecar files at:
   `~/.gemini/tmp/{slug}/tool-outputs/session-{session-uuid}/`

4. Optionally rewrite absolute paths in:
   - `ConversationRecord.directories[]`
   - `ToolCallRecord.args` values that are file paths
   - Masked tool output placeholder text referencing sidecar file paths
   - `ConversationRecord.projectHash` (recompute as SHA-256 of new project root)

5. Resume with: `gemini --resume latest` or `gemini --resume {uuid}`

## v1 Recommendation

**Gemini CLI is technically portable but intentionally deferred from workspace
mobility v1.** The main reasons are the global project registry, the heavier
install path, and unresolved path-sensitive behavior around `directories[]`
and subagent/session sidecars.

If Gemini portability is revisited in a later iteration:

1. **Export**: Copy the session JSON file. This is the only required artifact.
   Tool output sidecars are nice-to-have but not required for resume.

2. **Path rewriting**: If targeted structural rewriting is needed, use a
   JSON-aware transform rather than raw byte replacement. Candidate fields are:
   - `directories[]` array
   - All `args` objects in `toolCalls[]` (file_path, command cwd, etc.)
   - Tool result strings that embed absolute paths
   - `projectHash` field

3. **Registry setup**: Ensure the target machine has the project registered in
   `~/.gemini/projects.json` and the session file is placed in the correct
   `chats/` directory.

4. **No API state**: Gemini CLI rebuilds the full API chat history from the
   transcript on resume (via `convertSessionToClientHistory` in
   `packages/core/src/utils/sessionUtils.ts`). There is no session token or
   server-side continuation to worry about.

Key risk: The `convertSessionToClientHistory` function filters out slash
commands (`/` prefix) and system messages (`info`/`error`/`warning` types)
during reconstruction. This means the API history is a cleaned subset of the
full transcript. This is handled automatically -- no special treatment needed.

Additional open edges:

- Parent/subagent continuity is not fully characterized. The code stores
  subagent sessions under `chats/{parent-session-uuid}/`, but this
  investigation did not prove whether resuming a parent requires additional
  subagent installation semantics for full fidelity.
- Version skew between Gemini CLI builds remains a compatibility risk because
  the single JSON format and registry behavior may evolve over time.

## Code References

| Concept | File (relative to `~/gemini-cli/`) |
|---|---|
| Session ID generation | `packages/core/src/utils/session.ts` |
| Session file write/read | `packages/core/src/services/chatRecordingService.ts` |
| ConversationRecord schema | `packages/core/src/services/chatRecordingService.ts` (lines 100-111) |
| Session lookup, selector, list | `packages/cli/src/utils/sessionUtils.ts` |
| Resume hook (UI) | `packages/cli/src/ui/hooks/useSessionResume.ts` |
| Transcript -> API history conversion | `packages/core/src/utils/sessionUtils.ts` (`convertSessionToClientHistory`) |
| CLI --resume flag parsing | `packages/cli/src/config/config.ts` (~line 378) |
| Resume orchestration | `packages/cli/src/gemini.tsx` (~lines 581-613) |
| Project registry (slug mapping) | `packages/core/src/config/projectRegistry.ts` |
| Storage paths (temp, chats, history) | `packages/core/src/config/storage.ts` |
| Project hash generation | `packages/core/src/utils/paths.ts` (`getProjectHash`) |
| Tool output masking (sidecar files) | `packages/core/src/context/toolOutputMaskingService.ts` |
| Tool output distillation/truncation | `packages/core/src/context/toolDistillationService.ts`, `packages/core/src/utils/fileUtils.ts` |
| Session artifact cleanup | `packages/core/src/utils/sessionOperations.ts` |
| Workspace directory management | `packages/core/src/utils/workspaceContext.ts` |
| resumeChat (API history reload) | `packages/core/src/core/client.ts` (~line 323) |
| GeminiChat (chat with history) | `packages/core/src/core/geminiChat.ts` |
| Session-scoped state dirs (plans, tasks) | `packages/core/src/config/storage.ts` (getProjectTempPlansDir, etc.) |
