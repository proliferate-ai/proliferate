# Session Portability Summary

Cross-agent comparison and adapter design for workspace mobility.

## Agent Comparison

| Dimension | Claude Code | Codex | Gemini CLI |
|-----------|------------|-------|------------|
| **Primary artifact** | `.jsonl` (append-only) | `.jsonl` (append-only) | `.json` (full rewrite) |
| **Artifact count** | 1 file + optional sidecar dirs | 1 file | 1 file + optional sidecar dirs |
| **Session ID format** | UUID v4 | UUID v7 | UUID v4 |
| **Storage root** | `~/.claude/projects/<sanitized-cwd>/` | `~/.codex/sessions/YYYY/MM/DD/` | `~/.gemini/tmp/<slug>/chats/` |
| **Database / index** | None | SQLite (derived, rebuilt via backfill) | None |
| **Registry** | None (path is the key) | `session_index.jsonl` (optional names) | `projects.json` (slug mapping) |
| **cwd in storage path?** | Yes (sanitized into dir name) | No (date-partitioned) | Yes (project slug) |
| **cwd in resume lookup?** | Yes (`--continue` scans cwd's dir) | Yes (`--last` filters by cwd; `--all` bypasses) | Yes (scans slug's chats dir) |
| **Direct-path resume?** | Yes (`--resume /path/to/file.jsonl`) | No (UUID or `--last` only) | No (UUID, index, or `latest` only) |
| **Absolute paths in transcript?** | Yes (tool inputs, message `cwd`, attachments) | Yes (`SessionMeta.cwd`, `TurnContext.cwd`, exec events, tool args) | Yes (tool args, results, masked output refs, `directories[]`) |
| **Server-side session state?** | No | No | No |
| **Compaction** | `compact_boundary` markers; transparent on resume | `Compacted` rollout items | None observed |
| **Encrypted fields** | No (encryption is in AnyHarness layer) | No | No |
| **Resume mechanism** | Deserialize JSONL -> filter -> replay into context | Load JSONL -> wrap in `InitialHistory::Resumed` -> feed to model | Parse JSON -> `convertSessionToClientHistory` -> `resumeChat` |

## v1 Mobility Recommendations

### Safe for v1

All three agents are safe for mobility v1. Each stores its entire session
state in a single local file with no server-side dependencies. The primary
risk across all three is absolute path mismatch, which is cosmetic (the model
adapts to the new cwd on the next turn) and optionally fixable via path
rewriting.

| Agent | v1 Safe? | Confidence | Notes |
|-------|----------|------------|-------|
| Claude Code | Yes | High | Direct file path resume (`--resume /path`) makes install trivial |
| Codex | Yes | High | Single rollout file; SQLite is derived and rebuilt automatically |
| Gemini CLI | Yes | High | Single JSON file; no database; full replay on resume |

### Primary risks

1. **Absolute path mismatch.** All three embed absolute paths in tool call
   arguments/results. If the project lives at a different path on the
   destination, the model sees stale paths in history. Mitigation: optional
   find-and-replace rewriting of the old project root to the new one.

2. **cwd-based lookup.** Claude Code and Gemini CLI use cwd-derived directory
   names for session storage. If the session file is placed under the wrong
   slug/sanitized path, native `--continue` / `--resume latest` won't find
   it. Mitigation: Claude Code supports `--resume /direct/path.jsonl`;
   Codex supports `--resume <UUID>` globally; Gemini CLI requires placing
   the file in the correct slug directory.

3. **Large tool result sidecars.** Claude Code and Gemini CLI externalize
   large tool outputs to sidecar files. Without these, resumed sessions show
   truncated placeholders for some historical outputs. Mitigation: include
   sidecar directories in the export bundle.

## Normalized Adapter Interface

```
trait SessionAdapter {
    /// Collect all artifacts needed to reproduce this session on another machine.
    fn collect(session_id: &str, cwd: &Path) -> ExportBundle;

    /// Install a previously collected bundle into the target runtime.
    fn install(bundle: ExportBundle, target_cwd: &Path) -> InstalledSession;
}
```

### ExportBundle

```
struct ExportBundle {
    agent_kind: AgentKind,              // claude | codex | gemini
    session_id: String,                 // original session UUID
    source_cwd: PathBuf,               // absolute path on source machine

    /// The primary transcript file (JSONL or JSON).
    transcript: Vec<u8>,

    /// Optional sidecar files, keyed by relative path from transcript root.
    /// Examples:
    ///   Claude: "<uuid>/subagents/agent-abc.jsonl"
    ///   Claude: "<uuid>/tool-results/tool_use_xyz.json"
    ///   Gemini: "tool-outputs/session-<uuid>/shell_call1.txt"
    sidecars: HashMap<PathBuf, Vec<u8>>,
}
```

### InstalledSession

```
struct InstalledSession {
    session_id: String,
    transcript_path: PathBuf,           // where the file was written
    resume_command: String,             // CLI command to resume
}
```

### Per-Agent Adapter Notes

#### `collect` implementation

| Agent | Steps |
|-------|-------|
| Claude Code | 1. Read `~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl` as transcript. 2. Glob `<session-uuid>/subagents/**`, `<session-uuid>/remote-agents/**`, `<session-uuid>/tool-results/**` as sidecars. 3. Optionally include `plans/<slug>.md` if plan mode was used. |
| Codex | 1. Locate rollout via SQLite `threads.rollout_path` or filesystem scan under `~/.codex/sessions/`. 2. Read the single `.jsonl` as transcript. 3. No sidecars needed (shell snapshots are regenerated). |
| Gemini CLI | 1. Read `~/.gemini/projects.json` to resolve project slug. 2. Read `~/.gemini/tmp/<slug>/chats/session-*.json` matching the UUID. 3. Glob `~/.gemini/tmp/<slug>/tool-outputs/session-<uuid>/**` as sidecars. 4. Optionally glob `~/.gemini/tmp/<slug>/<uuid>/` (plans/tasks) as sidecars. |

#### `install` implementation

| Agent | Steps |
|-------|-------|
| Claude Code | 1. Write transcript to any path. 2. Write sidecars as siblings. 3. Resume: `claude --resume /path/to/<uuid>.jsonl`. No path rewriting or directory placement needed thanks to direct file path resume. |
| Codex | 1. Parse timestamp from rollout filename. 2. `mkdir -p ~/.codex/sessions/YYYY/MM/DD/` and write transcript. 3. Optionally rewrite `SessionMeta.cwd` and `TurnContext.cwd` fields (line 1 and subsequent `turn_context` lines). 4. Resume: `codex resume <UUID>`. |
| Gemini CLI | 1. Resolve or create project slug via `~/.gemini/projects.json`. 2. Write transcript to `~/.gemini/tmp/<slug>/chats/`. 3. Write sidecars to `~/.gemini/tmp/<slug>/tool-outputs/session-<uuid>/`. 4. Optionally rewrite `directories[]` and tool arg paths. 5. Resume: `gemini --resume <uuid>`. |

### Path Rewriting

All three agents embed absolute paths, but none require them to be correct
for session loading. The model sees them in history context. Rewriting is
optional but improves model accuracy on the next turn.

Recommended approach:
```
fn rewrite_paths(transcript: &[u8], old_root: &str, new_root: &str) -> Vec<u8> {
    // Simple byte-level find-and-replace of old_root -> new_root.
    // Works because paths appear as JSON string values.
    // Edge case: paths in base64 content or thinking blocks are not
    // structurally important and can tolerate stale values.
}
```

This is a best-effort transform. It handles the common case (tool args,
cwd fields, file path references) without needing to parse the full
transcript schema.

## Artifact Classification

For the AnyHarness mobility system, artifacts fall into three categories:

### 1. Agent-native transcript files (owned by the agent CLI)

These are what the `collect`/`install` adapter moves. They are the agent's
own session format.

| Agent | Format | File |
|-------|--------|------|
| Claude Code | JSONL | `<uuid>.jsonl` |
| Codex | JSONL | `rollout-<ts>-<uuid>.jsonl` |
| Gemini CLI | JSON | `session-<ts>-<short-uuid>.json` |

### 2. AnyHarness session data (owned by AnyHarness runtime)

Stored in `~/.proliferate/anyharness/db.sqlite`. This is the harness-level
session record: session ID, workspace association, event stream, config
snapshots, pending prompts, background work tracking. The AnyHarness
`session_events` table stores a normalized event stream that is a
higher-level representation of what the agent is doing -- it is NOT a copy
of the agent's native transcript.

For mobility, AnyHarness session data must also be migrated, but that is
a separate concern from agent transcript portability. The AnyHarness
session record points to the agent session via `native_session_id` and can
be recreated or re-associated on the destination.

### 3. Agent-native sidecars (owned by the agent CLI, optional)

| Agent | Sidecar | Purpose |
|-------|---------|---------|
| Claude Code | `<uuid>/subagents/` | Subagent transcripts |
| Claude Code | `<uuid>/tool-results/` | Externalized large tool outputs |
| Claude Code | `<uuid>/remote-agents/` | Remote agent metadata |
| Claude Code | `plans/<slug>.md` | Plan mode artifacts |
| Codex | `session_index.jsonl` entry | Thread name alias |
| Codex | `shell_snapshots/<uuid>.*.sh` | Shell env (regenerated) |
| Gemini CLI | `tool-outputs/session-<uuid>/` | Masked/truncated tool outputs |
| Gemini CLI | `<uuid>/plans/`, `<uuid>/tracker/` | Plan/task state |

## Implementation Priority

1. **Claude Code adapter** -- highest value, most used agent. Direct file
   path resume makes `install` trivial.
2. **Codex adapter** -- straightforward single-file export. CWD rewriting
   is the main install concern.
3. **Gemini CLI adapter** -- requires project registry management on install.
   Otherwise simple.

All three can share the same `ExportBundle` / `InstalledSession` types and
the same path rewriting utility.
