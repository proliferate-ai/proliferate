# AnyHarness Repo Shape

Status: authoritative for file/module shape and migration discipline in
AnyHarness code.

## File Size

Use these thresholds for Rust source under `anyharness/crates/**`:

| Area | Soft limit | Hard limit | Notes |
| --- | ---: | ---: | --- |
| `api/**/*.rs` | 400 | 700 | Large handlers usually mean product orchestration leaked into transport. |
| `domains/**/store*.rs` | 500 | 900 | Split by table/query family. |
| `domains/**/service*.rs` | 500 | 900 | Split by durable use case or subdomain. |
| `domains/**/runtime*.rs` | 500 | 900 | Split by workflow family. |
| `live/**/actor*.rs` | 500 | 900 | Split by command/startup/prompt/config/lifecycle concern. |
| `live/**/event_sink*.rs` | 500 | 900 | Split by normalized event family. |
| `adapters/**/*.rs` | 500 | 900 | Split by capability if the adapter grows. |
| `integrations/**/*.rs` | 400 | 800 | Split by protocol concern. |

Existing files above these limits are migration debt, not precedent.

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
event_sink/tools.rs
integrations/mcp/json_rpc.rs
```

## Migration Discipline

- Preserve behavior unless the task explicitly asks for a behavior change.
- Move one ownership boundary at a time.
- Do not leave duplicate old and new code paths after a migration.
- Do not create empty target folder trees.
- Do not add generic `utils`, `helpers`, or `misc` buckets.
- When moving files mechanically, run focused tests before beginning behavior
  cleanup.
- When splitting god files, split by responsibility, not by arbitrary line
  ranges.

## Boundary Ratchet

CI runs `scripts/check_anyharness_boundaries.py` to keep AnyHarness dependency
direction from regressing while cleanup is in progress. Existing violations are
count-based debt in `scripts/anyharness_boundaries_allowlist.txt`; new
violations, increased counts, and stale allowlist entries fail the check.

When a cleanup removes an allowlisted violation, reduce or delete that
allowlist entry in the same change. Completed splits should tighten any
transitional allowances that no longer match the documented target shape.

## Old Path Ratchets

After a split lands, block the old flat file path from coming back. The
repo-shape CI job runs `scripts/check_anyharness_old_paths.py` for completed
AnyHarness splits. Add paths to that check only after the owning migration has
landed on `main`, then keep the old path blocked instead of relying on review
to catch resurrected flat files.

## Review Questions

Ask these in PR review:

- Can I tell what this file is allowed to own from its path?
- Does this file import upward into API/app or across into a product surface?
- Is this a behavior-preserving extraction, or did it change behavior?
- Did the old path get deleted?
- Did a generic shared bucket appear because ownership was unclear?
