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

### Technical portability vs product support

All three agents are technically portable in the narrow sense that their
session state is local-file-backed and can be reconstructed on another
machine/runtime.

That does **not** mean all three are in scope for workspace mobility v1.
The accepted support matrix narrows v1 to Claude + Codex only. See
[decision-v1-support-matrix.md](./decision-v1-support-matrix.md).

| Agent | v1 Safe? | Confidence | Notes |
|-------|----------|------------|-------|
| Claude Code | Yes | High | Direct file path resume (`--resume /path`) makes install trivial |
| Codex | Yes | High | Single rollout file; SQLite is derived and rebuilt automatically |
| Gemini CLI | Deferred | High technical portability, lower v1 fit | Install path is materially messier and intentionally deferred from the product scope |

### Primary risks

1. **Absolute path mismatch.** All three embed absolute paths in tool call
   arguments/results. If the project lives at a different path on the
   destination, the model sees stale paths in history. In theory this can be
   mitigated by path rewriting, but the accepted v1 decision is narrower: no
   broad transcript-history rewriting, only targeted structural rewrite or
   explicit cwd override where required for resume mechanics. See
   [decision-agent-history-and-source-cleanup.md](./decision-agent-history-and-source-cleanup.md).

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

4. **Live-session capture is unsafe.** All three formats are append-oriented.
   Collecting artifacts during an active turn risks capturing a partial tool
   exchange or half-written transcript state. Mobility collection should only
   run after the AnyHarness workspace passes quiescence checks and the source
   runtime has entered `frozen_for_handoff`.

## Important boundary: agent-native portability is necessary, not sufficient

The docs in this folder only answer the agent-native half of mobility:

- where the agent stores its transcript/session artifacts
- what extra sidecars matter for resume
- what install shape native resume expects

That is not enough to move a real workspace in Proliferate.

The user-visible workspace/session state is primarily owned by AnyHarness:

- `SessionRecord`
- `session_events`
- pending prompts / pending config changes
- live config snapshots
- raw notifications
- workspace/session associations

Agent-native portability must therefore be paired with AnyHarness durable
session migration and re-association via `native_session_id`.

Two concrete consequences:

1. The portability adapter must return data that the AnyHarness runtime can
   install and wire back to a destination `SessionRecord`, not a CLI command
   string.
2. Encrypted harness-owned fields such as `mcp_bindings_ciphertext` are an
   AnyHarness-layer portability concern. They may require a stable
   `ANYHARNESS_DATA_KEY` or an explicit re-encryption path; agent transcript
   portability alone does not solve that.

## Normalized Adapter Interface

```
trait SessionAdapter {
    /// Collect all agent-native artifacts needed to reproduce this session.
    fn collect(session_id: &str, cwd: &Path) -> AgentSessionBundle;

    /// Install a previously collected bundle into the target runtime.
    fn install(bundle: AgentSessionBundle, target_cwd: &Path) -> InstalledAgentSession;
}
```

### AgentSessionBundle

```
struct AgentSessionBundle {
    agent_kind: AgentKind,              // claude | codex | gemini
    native_session_id: String,
    source_cwd: PathBuf,
    files: Vec<PortableFile>,           // primary artifact + sidecars
    install_hints: AgentInstallHints,
    warnings: Vec<String>,
}

struct PortableFile {
    rel_path: PathBuf,
    purpose: PortableFilePurpose,
    // Logical file entry inside the workspace archive. The transport may inline
    // or stream the content, but the interface should stay file-entry based
    // rather than one giant transcript blob.
}
```

### InstalledAgentSession

```
struct InstalledAgentSession {
    native_session_id: String,
    primary_artifact_path: PathBuf,
    runtime_resume_hints: AgentResumeHints,
    warnings: Vec<String>,
}
```

`runtime_resume_hints` is meant for the AnyHarness session runtime, not for
shelling out to a CLI command string. Examples: transcript path, resolved
storage slug, or explicit cwd-override requirements.

### Per-Agent Adapter Notes

#### `collect` implementation

| Agent | Steps |
|-------|-------|
| Claude Code | 1. Read `~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl` as transcript. 2. Glob `<session-uuid>/subagents/**`, `<session-uuid>/remote-agents/**`, `<session-uuid>/tool-results/**` as sidecars. 3. Optionally include `plans/<slug>.md` if plan mode was used. |
| Codex | 1. Locate rollout via SQLite `threads.rollout_path` or filesystem scan under `~/.codex/sessions/`. 2. Read the single `.jsonl` as transcript. 3. No sidecars needed (shell snapshots are regenerated). |
| Gemini CLI | 1. Read `~/.gemini/projects.json` to resolve project slug. 2. Read `~/.gemini/tmp/<slug>/chats/session-*.json` matching the UUID. 3. Glob `~/.gemini/tmp/<slug>/tool-outputs/session-<uuid>/**` as sidecars. 4. Optionally glob `~/.gemini/tmp/<slug>/<uuid>/` (plans/tasks) as sidecars. |

Collection should only run for quiescent sessions. None of these adapters
should read artifacts from a session that is mid-turn or otherwise actively
appending to disk.

#### `install` implementation

| Agent | Steps |
|-------|-------|
| Claude Code | 1. Write transcript to any path. 2. Write sidecars as siblings. 3. Resume: `claude --resume /path/to/<uuid>.jsonl`. No path rewriting or directory placement needed thanks to direct file path resume. |
| Codex | 1. Parse timestamp from rollout filename. 2. `mkdir -p ~/.codex/sessions/YYYY/MM/DD/` and write transcript. 3. Optionally rewrite `SessionMeta.cwd` and `TurnContext.cwd` fields (line 1 and subsequent `turn_context` lines). 4. Resume: `codex resume <UUID>`. |
| Gemini CLI | 1. Resolve or create project slug via `~/.gemini/projects.json`. 2. Write transcript to `~/.gemini/tmp/<slug>/chats/`. 3. Write sidecars to `~/.gemini/tmp/<slug>/tool-outputs/session-<uuid>/`. 4. Optionally rewrite `directories[]` and tool arg paths. 5. Resume: `gemini --resume <uuid>`. |

### Path Rewriting

All three agents embed absolute paths, but none require them to be broadly
rewritten for session loading.

This section is a portability observation, not the accepted v1 implementation
policy.

For v1:

- do **not** do best-effort global transcript rewriting
- only apply targeted rewrite or explicit cwd override where structurally
  necessary for resume

See
[decision-agent-history-and-source-cleanup.md](./decision-agent-history-and-source-cleanup.md).

If a future version ever adds targeted structural rewrites, use a
JSON-value-aware transform:

```
fn rewrite_json_paths(value: JsonValue, old_root: &str, new_root: &str) -> JsonValue {
    // Deserialize JSON/JSONL payloads, walk string values, replace only
    // structurally recognized path-bearing fields, then re-serialize.
}
```

Do not do raw byte-level global replacement. That is brittle across escaping,
format variants, and future file-format changes. This remains out of scope for
accepted v1 mobility.

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

For mobility, AnyHarness session data must also be migrated. This is not an
optional add-on. Agent transcripts alone are insufficient because the product
UI and session actor behavior are driven from AnyHarness durable state, not
from the raw agent transcript files.

The AnyHarness session record points to the agent session via
`native_session_id` and must be recreated or re-associated on the destination.

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

1. **Claude Code adapter** -- simplest v1 install path because direct-file
   resume avoids path-derived lookup constraints.
2. **Codex adapter** -- straightforward single-file export with explicit
   cwd handling and no required DB import.
3. **Gemini CLI adapter** -- technically feasible but intentionally deferred
   from the v1 product scope.

All three can share the same logical `AgentSessionBundle` /
`InstalledAgentSession` model, but v1 should only implement Claude and Codex
adapters.
