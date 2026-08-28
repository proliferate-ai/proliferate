# Delivery specification — agent_auth slice 6: cleanups (frozen)

Chain position: the final slice of the approved auth slice plan. Two independent lanes and one serialized one: **lane A (grok + env-passthrough + native bridge) runs off `main` any time; lane B (Wave-3 Rust consolidation) is move-only and MUST base on the tip of the slice-2→3 chain** (it moves the files those slices edit). Evidence of record: the agent_auth system spec's delta rows (grok's login-resolution miss — the managed artifact is `grok-launcher`, grok has no native artifact, login resolution searches native → managed `grok` → PATH, every rung misses; the zero-rows-convention cutover row with the bridge ruling) and the fence-enforcement table (#2252 — the `agent_auth` Rust fence node lands with Wave 3). The native-bridge **pixels are the design pass's call**: build the bridge functional behind reasonable placeholder UX, flag every user-visible string/layout for the design pass in the PR body.

## Intent

The loose ends die: grok either authenticates or stops offering login; the legacy ambient-env selection shape leaves prod; a pre-cutover native user's first launch gets a one-time prompt instead of a refusal; and the Rust cell finally lives at `domains/agent_auth/` with its fence node pinning exactly who may import it.

## Acceptance gate (the merge bar — performed by Pablo, in the product)

Grok authenticates through its pane (or its pane no longer offers login). A pre-cutover native user's first launch gets the one-time prompt, never a refusal. No env-passthrough selection rows remain in prod (read-only verification listed in the PR; any prod migration run is Pablo's). Wave 3: `domains/agent_auth/` exists, `lints/anyharness/fences.toml` carries its node with the Doors-table edge list, and the full Rust suite is green with zero behavior change.

## Scope

**Lane A (off main):**
- **Grok**: root cause is known (delta row): either ship the vendor `grok` CLI in the managed install recipe, or teach login resolution the launcher name, or drop the CLI-login declaration from grok's catalog entry — decide by what the vendor artifact actually supports (investigate the ACP sidecar's auth passthrough first; prefer the smallest honest fix, document the decision in the PR).
- **Env-passthrough removal**: identify the legacy selection shape that passes an ambient/host env var into launches (no `env_passthrough` constant exists — pin the actual shape from `selections.py` history and prod rows via read-only query). Remove its write path, add the selection-write validation, ship the cleanup migration for existing rows, and plain-words copy for anyone who had one. List affected prod rows read-only in the PR; do not run prod mutations.
- **The native-migration bridge** (delta row, exact): the status document's native detection + mint offer already exist (slices 1–3); this lane adds the cutover — existing native harnesses get a **one-time settings prompt**, and until acted on, launches keep native behavior behind a legacy flag the migration removes. Functional placeholder UX, every string flagged for the design pass.

**Lane B (base: tip of slice-3's branch, move-only, separate PR):** Wave-3 consolidation — `route_auth/`, `auth/`, `launch_probe/`, `status/` (and `auth_state.rs`'s remains) out of `domains/agents/` into `domains/agent_auth/`; `api/http/agent_auth.rs` stays api-layer. `git mv` with `--follow` intact; the `agent_auth` node lands in `lints/anyharness/fences.toml` with its measured edge list (which must equal the spec's Doors consumers); AH-FENCE-002 protects its store automatically. Zero behavior change, proven by the unmodified Rust suite.

## Non-goals

Design-pass pixels (flagged, not final) · codex seats (phase 2) · deleting the delta tables (convergence, after Pablo's gates) · any prod data mutation (listed read-only, executed by Pablo).

## Proof

- Grok: a login-resolution test proving the chosen fix (resolution finds the artifact, or the declaration is gone and the pane renders no login).
- Env-passthrough: write-path rejection test · migration round-trip on a synthesized legacy row · the read-only prod count in the PR body.
- Bridge: `pre_cutover_native_user_first_launch_prompts_not_refuses` · legacy-flag launch keeps native behavior · acting on the prompt (mint or dismiss-to-configure) clears the flag · the migration removes the flag.
- Wave 3: full anyharness suite green unmodified · all files renames (R95+) · fence baseline equals reality · `git log --follow` reaches pre-move history.

## Discharges

Delta rows: grok · zero-rows cutover/bridge · the runtime-cell location row · the fence-teeth Rust node (enforcement table's last open row). At convergence after this slice + Pablo's gates, the delta table should be nearly empty — the surviving rows are phase-2 items.
