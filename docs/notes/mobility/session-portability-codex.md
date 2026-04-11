# Session Portability: Codex

## Bottom Line

Codex sessions are stored as append-only JSONL "rollout" files under
`~/.codex/sessions/YYYY/MM/DD/`. A SQLite database (`state_5.sqlite`) acts as
a secondary index over those files but is not the source of truth -- it is
rebuilt from the rollout files via backfill. Moving a session to another machine
requires copying the rollout `.jsonl` file and rewriting the absolute `cwd`
path embedded in the first line (SessionMeta) and in every `TurnContext` and
`ExecCommandBegin/End` event. There is no server-side conversation state; the
entire replay history is local to the machine.

## Resume Path

Entry: `codex resume [SESSION_ID]` or `codex resume --last`.

The `resume` subcommand is defined in `codex-rs/cli/src/main.rs` (struct
`ResumeCommand`, line ~216). It sets internal flags on the TUI CLI struct
(`resume_session_id`, `resume_last`, `resume_picker`) defined in
`codex-rs/tui/src/cli.rs` (lines 21-36).

Resume flow:

1. **Locate rollout file.** Either by UUID lookup
   (`find_thread_path_by_id_str` in `codex-rs/rollout/src/list.rs` line 1252)
   or by "latest" scan (`find_latest_thread_path` in
   `codex-rs/rollout/src/recorder.rs` line 371). The lookup first tries
   the SQLite `threads` table (`rollout_path` column), then falls back to
   filesystem search using `codex-file-search` with the UUID as the query
   term. Thread names (user-assigned aliases for sessions) are resolved via
   `session_index.jsonl` (`codex-rs/rollout/src/session_index.rs` line 117,
   `find_thread_meta_by_name_str`).

2. **Load rollout items.** `RolloutRecorder::load_rollout_items`
   (`codex-rs/rollout/src/recorder.rs` line 644) reads the entire `.jsonl`
   file, parses each line as a `RolloutLine { timestamp, item: RolloutItem }`,
   and collects all items plus the `ThreadId` from the first `SessionMeta`
   line.

3. **Build InitialHistory.** `RolloutRecorder::get_rollout_history`
   (line 709) wraps the items into `InitialHistory::Resumed(ResumedHistory {
   conversation_id, history, rollout_path })`. Defined in
   `codex-rs/protocol/src/protocol.rs` line 2443.

4. **Resolve CWD.** `resolve_cwd_for_resume_or_fork` in
   `codex-rs/tui/src/lib.rs` line 1536 reads the session's cwd (from SQLite
   or from the latest `TurnContext` item in the rollout, falling back to the
   `SessionMeta.cwd` field). If the cwd differs from the current directory,
   the TUI prompts the user to choose.

5. **Open recorder in append mode.** `RolloutRecorderParams::Resume { path }`
   opens the existing rollout file for append (`codex-rs/rollout/src/recorder.rs`
   line 500-514).

6. **Spawn thread.** `ThreadManager::resume_thread_from_rollout` in
   `codex-rs/core/src/thread_manager.rs` line 509 passes the loaded history
   into `spawn_thread`, which feeds the `ResponseItem` sequence back to the
   model as conversation context.

There is also `codex fork [SESSION_ID]`, which works identically except the
history is wrapped in `InitialHistory::Forked(items)` (a new thread ID is
generated, old rollout is not appended to).

## Durable Identity

**ThreadId** is a UUIDv7 (`Uuid::now_v7()`), defined in
`codex-rs/protocol/src/thread_id.rs` line 18. Generated at session creation
time. The UUID is embedded in:

- The rollout filename: `rollout-YYYY-MM-DDThh-mm-ss-<UUID>.jsonl`
- The first JSONL line's `SessionMeta.id` field
- The SQLite `threads.id` column

The ID is stable across resume. On fork, a new ThreadId is generated for the
child session.

## Required Artifacts

### Primary: rollout file

```
~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<UUID>.jsonl
```

This is the single source of truth for the session. Format:

```jsonl
{"timestamp":"...","type":"session_meta","payload":{"id":"<UUID>","cwd":"/abs/path","source":"cli","model_provider":"openai","cli_version":"...","base_instructions":{...},...}}
{"timestamp":"...","type":"turn_context","payload":{"cwd":"/abs/path","model":"o3","approval_policy":"on-request","sandbox_policy":"read-only",...}}
{"timestamp":"...","type":"response_item","payload":{...}}
{"timestamp":"...","type":"event_msg","payload":{"type":"exec_command_begin","call_id":"...","cwd":"/abs/path","command":["ls"],...}}
...
```

Line types (enum `RolloutItem` in `codex-rs/protocol/src/protocol.rs`
line 2761):

| Variant        | Purpose                                              |
|----------------|------------------------------------------------------|
| `SessionMeta`  | Session identity, cwd, originator, base instructions |
| `ResponseItem` | Model messages, tool calls, function results         |
| `Compacted`    | Summarized context after compaction                  |
| `TurnContext`  | Per-turn env snapshot (cwd, model, policies)         |
| `EventMsg`     | Exec events, approvals, diffs, PTY output            |

### Secondary: SQLite state database

```
~/.codex/state_5.sqlite
```

Opened by `StateRuntime::init` in `codex-rs/state/src/runtime.rs` line 87.
Tables include `threads` (thread metadata index), `thread_dynamic_tools`,
`thread_spawn_edges` (parent/child sub-agent relationships), and memory-related
tables (`stage1_outputs`, `phase2_selections`, etc.).

This database is **derived** -- it is rebuilt from rollout files via backfill
(`codex-rs/state/src/runtime/backfill.rs`). Not required for resume, but
accelerates thread listing and search.

### Secondary: session_index.jsonl

```
~/.codex/session_index.jsonl
```

Append-only file mapping ThreadId to user-assigned thread names
(`codex-rs/rollout/src/session_index.rs` line 17). Used for `codex resume
<name>` lookups. Not required for UUID-based resume.

### Secondary: shell snapshots

```
~/.codex/shell_snapshots/<ThreadId>.<nanos>.sh
```

Captured shell environment (functions, aliases, exports) for the session's
PTY processes. Files are named `<ThreadId>.<SystemTime_nanos>.sh`. Used to
bootstrap the agent's shell environment. 3-day retention
(`codex-rs/core/src/shell_snapshot.rs` line 33). Not required for resume
(snapshots are regenerated), but absence means the agent starts with a
fresh shell environment.

### Secondary: logs database

```
~/.codex/logs_2.sqlite
```

Structured logs partitioned by thread_id. Diagnostic only, not consumed by
resume.

### Secondary: history.jsonl

```
~/.codex/history.jsonl
```

TUI composer input history (what the user typed). Not consumed by resume;
purely for input recall in the TUI.

### Not per-session: config and auth

- `~/.codex/config.toml` -- global config (model, provider, sandbox policy)
- `~/.codex/auth.json` or keyring -- API credentials
- `~/.codex/AGENTS.md` -- global agent instructions

These are not session artifacts. They are environment-level.

## Lookup Sensitivity

### CWD filtering

By default, `codex resume --last` and the resume picker filter sessions by
the current working directory. The function `latest_session_cwd_filter` in
`codex-rs/tui/src/lib.rs` line 632 passes `config.cwd` to
`find_latest_thread_path`, which calls `resume_candidate_matches_cwd`
(`codex-rs/rollout/src/recorder.rs` line 1292). Matching logic:

1. Check `ThreadItem.cwd` (from SQLite or rollout head)
2. Fall back to the latest `TurnContext.cwd` in the rollout
3. Fall back to `SessionMeta.cwd` from rollout head

Path comparison uses `path_utils::normalize_for_path_comparison` which
canonicalizes symlinks and case. The match is exact after normalization --
no prefix or ancestor matching.

Passing `--all` (`resume_show_all`) disables CWD filtering.

### UUID lookup

`find_thread_path_by_id_str` (`codex-rs/rollout/src/list.rs` line 1252):

1. SQLite `threads.rollout_path` (if state DB is available)
2. File search under `~/.codex/sessions/` for a file containing the UUID

Both are global -- no CWD filtering.

## Transcript / Tool History Path Sensitivity

**Absolute paths are heavily embedded in the rollout.** Every location where
a path appears stores the full absolute path:

| Field                                  | Contains absolute path |
|----------------------------------------|------------------------|
| `SessionMeta.cwd`                      | Yes                    |
| `TurnContext.cwd`                      | Yes                    |
| `ExecCommandBeginEvent.cwd`            | Yes                    |
| `ExecCommandEndEvent.cwd`              | Yes                    |
| `PatchApplyBeginEvent` (file paths)    | Yes                    |
| `ResponseItem::LocalShellCall` output  | Yes (in stdout/stderr) |
| `ResponseItem::FunctionCall` arguments | Yes (file paths)       |
| `ResponseItem::Message` content        | Yes (when model mentions paths) |

The `SessionMeta.cwd` and `TurnContext.cwd` are the structurally critical
ones -- they determine the session's working directory on resume. Tool
output paths in `ExecCommandEnd.stdout/stderr` are serialized verbatim but
are truncated to 10KB (`PERSISTED_EXEC_AGGREGATED_OUTPUT_MAX_BYTES` in
`codex-rs/rollout/src/recorder.rs` line 187) and only stored in Extended
persistence mode.

On resume, Codex replays the entire rollout item list as conversation
context to the model. The model sees all the old absolute paths in
tool call arguments and results. If the workspace has moved, the model
will see stale paths in the history but should operate in the current
cwd going forward.

## Minimal Export Spec

To export a Codex session for mobility:

1. Copy the rollout `.jsonl` file.
2. Record the original `cwd` (from `SessionMeta.cwd` on line 1).
3. Optionally copy the thread name from `session_index.jsonl`.

That's it. The rollout file is self-contained.

## Minimal Install Spec

To install a session on a new machine/runtime:

1. Place the rollout `.jsonl` under `~/.codex/sessions/YYYY/MM/DD/`
   (the date directories must match the filename timestamp).
2. If the workspace cwd has changed, rewrite `SessionMeta.cwd` on line 1
   and all `TurnContext.cwd` entries. The model will see stale paths in
   older tool events but will operate in the new cwd.
3. Optionally run backfill to populate the SQLite index (or just let Codex
   discover the file via filesystem search).
4. Resume: `codex resume <UUID>`.

No SQLite import is needed -- the database is rebuilt from rollout files.
The `session_index.jsonl` entry is optional (only needed if you want to
resume by thread name instead of UUID).

## v1 Recommendation

For a first-pass portability implementation in our system:

**Copy-and-rewrite the rollout file.** The rollout `.jsonl` is the only
artifact that matters. Export = read the file + extract metadata.
Import = write the file + optionally rewrite cwd paths + place in the
dated directory structure.

**Do not try to port the SQLite database.** It is derived state. Let
Codex rebuild it via backfill on the target machine.

**CWD rewriting is optional but recommended.** If the project lives at
a different absolute path on the target machine, rewrite the `cwd` fields
in `SessionMeta` and `TurnContext` items. Old tool output paths in the
history will be stale but that's acceptable -- the model adapts to the
current cwd on the next turn.

**Shell snapshots are not worth porting.** They are regenerated from the
user's shell environment on the target machine.

**Thread naming is nice-to-have.** Append an entry to
`session_index.jsonl` on the target so the session is discoverable by
name.

**Concrete steps for v1:**

1. Export: read rollout path from SQLite or filesystem, copy the `.jsonl`.
2. Transfer: move the file to the target machine.
3. Import: `mkdir -p ~/.codex/sessions/YYYY/MM/DD/` and place the file.
   Optionally sed-rewrite cwd paths.
4. Resume: `codex resume <UUID>` or `codex resume --last --all`.

## Code References

| Concept                          | File (relative to `~/codex/`)                                        | Key symbol / line                                                |
|----------------------------------|----------------------------------------------------------------------|------------------------------------------------------------------|
| Resume CLI subcommand            | `codex-rs/cli/src/main.rs`                                           | `ResumeCommand` (~line 216), `ForkCommand` (~line 242)           |
| TUI resume flags                 | `codex-rs/tui/src/cli.rs`                                            | `resume_session_id`, `resume_last`, `resume_picker`              |
| Resume orchestration             | `codex-rs/tui/src/lib.rs`                                            | Lines 1239-1304 (session_selection match)                        |
| CWD resolution for resume        | `codex-rs/tui/src/lib.rs`                                            | `resolve_cwd_for_resume_or_fork` (line 1536)                    |
| CWD filter for --last            | `codex-rs/tui/src/lib.rs`                                            | `latest_session_cwd_filter` (line 632)                           |
| Resume picker UI                 | `codex-rs/tui/src/resume_picker.rs`                                  | `SessionTarget`, `SessionSelection`                              |
| ThreadId (UUIDv7)                | `codex-rs/protocol/src/thread_id.rs`                                 | `ThreadId::new()` -> `Uuid::now_v7()`                           |
| SessionMeta struct               | `codex-rs/protocol/src/protocol.rs`                                  | `SessionMeta` (line 2700)                                       |
| RolloutItem enum                 | `codex-rs/protocol/src/protocol.rs`                                  | `RolloutItem` (line 2761)                                       |
| RolloutLine (JSONL wrapper)      | `codex-rs/protocol/src/protocol.rs`                                  | `RolloutLine` (line 2888)                                       |
| TurnContextItem                  | `codex-rs/protocol/src/protocol.rs`                                  | `TurnContextItem` (line 2801)                                   |
| ExecCommandBeginEvent            | `codex-rs/protocol/src/protocol.rs`                                  | `ExecCommandBeginEvent` (line 3015, `cwd: PathBuf`)             |
| InitialHistory / ResumedHistory  | `codex-rs/protocol/src/protocol.rs`                                  | `ResumedHistory` (line 2443), `InitialHistory` (line 2450)      |
| ResponseItem enum                | `codex-rs/protocol/src/models.rs`                                    | `ResponseItem` (line 188)                                       |
| BaseInstructions                 | `codex-rs/protocol/src/models.rs`                                    | `BaseInstructions` (line 348)                                   |
| Rollout recorder                 | `codex-rs/rollout/src/recorder.rs`                                   | `RolloutRecorder`, `RolloutRecorderParams`                      |
| Rollout file path computation    | `codex-rs/rollout/src/recorder.rs`                                   | `precompute_log_file_info` (line 786)                           |
| Load rollout items               | `codex-rs/rollout/src/recorder.rs`                                   | `load_rollout_items` (line 644)                                 |
| get_rollout_history              | `codex-rs/rollout/src/recorder.rs`                                   | `get_rollout_history` (line 709)                                |
| CWD match on resume --last       | `codex-rs/rollout/src/recorder.rs`                                   | `resume_candidate_matches_cwd` (line 1292)                      |
| Thread listing (filesystem)      | `codex-rs/rollout/src/list.rs`                                       | `get_threads` (line 305), `get_threads_in_root` (line 330)      |
| Thread path lookup by UUID       | `codex-rs/rollout/src/list.rs`                                       | `find_thread_path_by_id_str` (line 1252)                        |
| Session index (thread names)     | `codex-rs/rollout/src/session_index.rs`                              | `SessionIndexEntry`, `append_thread_name`, `find_thread_meta_by_name_str` |
| SESSIONS_SUBDIR constant         | `codex-rs/rollout/src/lib.rs`                                        | `"sessions"` (line 22)                                          |
| Codex home directory             | `codex-rs/utils/home-dir/src/lib.rs`                                 | `find_codex_home()`, defaults to `~/.codex`                     |
| CODEX_HOME env override          | `codex-rs/utils/home-dir/src/lib.rs`                                 | `CODEX_HOME` env var (line 13)                                  |
| SQLite state runtime             | `codex-rs/state/src/runtime.rs`                                      | `StateRuntime::init`, `state_db_path`                           |
| SQLite state DB filename         | `codex-rs/state/src/lib.rs`                                          | `state_5.sqlite` (STATE_DB_VERSION=5, STATE_DB_FILENAME="state") |
| Threads table schema             | `codex-rs/state/migrations/0001_threads.sql`                         | `CREATE TABLE threads` (cwd TEXT NOT NULL)                      |
| Thread metadata model            | `codex-rs/state/src/model/thread_metadata.rs`                        | `ThreadMetadata` (line 57)                                      |
| Thread spawn edges               | `codex-rs/state/migrations/0021_thread_spawn_edges.sql`              | Parent/child sub-agent relationships                            |
| Shell snapshots                  | `codex-rs/core/src/shell_snapshot.rs`                                | `ShellSnapshot`, `SNAPSHOT_DIR = "shell_snapshots"`             |
| ThreadManager resume             | `codex-rs/core/src/thread_manager.rs`                                | `resume_thread_from_rollout` (line 509)                         |
| Persistence mode / truncation    | `codex-rs/rollout/src/recorder.rs`                                   | `sanitize_rollout_item_for_persistence` (line 189), 10KB limit  |
