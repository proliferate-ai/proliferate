# AnyHarness Repo Shape

Status: authoritative for file/module shape in AnyHarness code.

## File Size

Use these thresholds for Rust source under `anyharness/crates/**`:

| Area | Soft limit | Hard limit | Notes |
| --- | ---: | ---: | --- |
| `api/**/*.rs` | 400 | 700 | Large handlers usually mean product orchestration leaked into transport. |
| `app/**/*.rs` | 500 | 900 | Split by wiring family; app files must remain composition-only. |
| `domains/**/store*.rs` | 500 | 900 | Split by table/query family. |
| `domains/**/service*.rs` | 500 | 900 | Split by durable use case or subdomain. |
| `domains/**/runtime*.rs` | 500 | 900 | Split by workflow family. |
| `live/**/actor/**/*.rs` | 500 | 900 | Split by command/startup/prompt/config/lifecycle concern. |
| `live/**/driver/**/*.rs` | 500 | 900 | Split by external process/protocol/PTY lifecycle concern. |
| `live/**/sink/**/*.rs` | 500 | 900 | Split by normalized event family. |
| `live/**/output_sink/**/*.rs` | 500 | 900 | Split by ordered output family. |
| `adapters/**/*.rs` | 500 | 900 | Split by capability if the adapter grows. |
| `integrations/**/*.rs` | 400 | 800 | Split by protocol concern. |

Files above these limits require a split plan or justification.

Current split shapes:

- `domains/sessions/store/**` is the current split session store shape.
- `domains/sessions/mcp_bindings/**` is the current split session MCP binding and
  launch assembly shape.
- `live/sessions/sink/**` is the current split session event sink shape.
- `domains/sessions/runtime/**` is the current split session runtime shape.
- `live/sessions/manager/**`, `live/sessions/handle.rs`,
  `live/sessions/actor/**`, `live/sessions/driver/**`,
  `live/sessions/sink/**`, `live/sessions/rendezvous/**`,
  `live/sessions/background_work/**`, and `live/sessions/replay/**` are the
  current split live session shape. The `InboundDoor` is split under
  `live/sessions/driver/inbound/**` as the agent-initiated inbound direction
  inside the driver role.
- Remaining `acp/**` files are shared ACP permission/payload/provider-error
  helpers, not current owners for live session manager, sink, rendezvous,
  background work, or replay behavior.

## Module Style

Prefer explicit concern files over giant `mod.rs` files.

Use `mod.rs` to declare and lightly re-export a cohesive module surface, not to
hold the whole implementation.

Avoid both extremes:

- one 3,000-line file that owns five concepts
- ten tiny wrapper files that hide a simple local function

Split when a reader can name a real responsibility:

```text
store/events.rs
runtime/prompt.rs
actor/config.rs
sink/tools.rs
integrations/mcp/json_rpc.rs
```

## Large Subsystems

The top-level boundary is not enough for large subsystems. Once a subsystem has
multiple responsibility families, define its internal shape before splitting
files. The target is legibility by path at both levels:

```text
domains/sessions/runtime/prompt.rs    # session workflow entrypoint
live/sessions/actor/turn/active.rs    # active prompt turn loop
live/sessions/sink/tools.rs           # transcript event normalization
```

Do not dump unrelated files into a newly-correct parent folder. A move into
`live/sessions/actor/*.rs` is only useful if the children also encode
responsibility.

Large subsystem splits should name the local architecture explicitly in the
owning spec or guide. For example:

- durable domains split by `model`, `store`, `service`, `runtime`, and named
  subdomains.
- app composition split by wiring family such as sessions, workspaces,
  product extensions, product MCP registration, and startup tasks.
- live resources split by manager, handle, private actor, private driver,
  sink, rendezvous, background work, snapshot, and replay roles.
- live actors split by command surface, loop, startup, prompt turn, config,
  notifications, interactions, and shutdown.
- event/output sinks split by normalized event or output family.
- integrations split by protocol/vendor mechanic.

## Change Discipline

- Preserve behavior unless the task explicitly asks for a behavior change.
- Move one ownership boundary at a time.
- Do not leave duplicate old and new code paths after replacing an
  implementation.
- Do not create empty target folder trees.
- Do not add generic `utils`, `helpers`, or `misc` buckets.
- When moving files mechanically, run focused tests before beginning behavior
  changes.
- When splitting god files, split by responsibility, not by arbitrary line
  ranges.

## Boundary Ratchet

CI runs `scripts/check_anyharness_boundaries.py` to keep AnyHarness dependency
direction from regressing. Existing violations are count-based exceptions in
`scripts/anyharness_boundaries_allowlist.txt`; new violations, increased
counts, and stale allowlist entries fail the check.

When a change removes an allowlisted violation, reduce or delete that allowlist
entry in the same change.

## Old Path Ratchets

Completed splits block old flat file paths from coming back. The
repo-shape CI job runs `scripts/check_anyharness_old_paths.py` for completed
AnyHarness splits. Add paths to that check after the replacement lands on
`main`, then keep the old path blocked instead of relying on review to catch
resurrected flat files.

## Review Questions

Ask these in PR review:

- Can I tell what this file is allowed to own from its path?
- Does this file import upward into API/app or across into a product surface?
- Is this a behavior-preserving extraction, or did it change behavior?
- Did the old path get deleted?
- Did a generic shared bucket appear because ownership was unclear?
