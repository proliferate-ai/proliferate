# Delivery specification — agent_auth slice 3: truth & recovery (frozen)

Chain position: slice 3 of the approved auth slice plan (runs **after slice 2**, in parallel with slice 4). Evidence of record: the agent_auth system spec ([specs/systems/agent_auth/README.md](../../specs/systems/agent_auth/README.md) — §2's status document and delivery-governance rules, §3 Flow 4, §4 cell 2's `status/` tree and local API) and the root-cause evidence in its delta table (the probe-decay row: `launch_options/basis.rs:67-72` folds the global document revision, so every push invalidates every harness's options with no recovery event). **Base branch: `agent-auth-slice-2`** until that PR merges; retargets automatically. Builders implement from this document without re-deriving the architecture.

## Intent

One machine truth per harness, and a probe engine that heals itself. This slice kills the two worst live bug classes: (a) four-sources-of-truth — changing one harness's auth makes *other* harnesses' panes flicker or go dark; (f) probe decay — a missed or killed probe leaves "launch options are not available (state: Some…)" until a human clicks Retry. After this slice the pane can never show a state the machine doesn't hold.

## Acceptance gate (the merge bar — performed by Pablo, in the product)

(1) Change grok's auth method; codex's models list does not flicker or go dark. (2) `kill -9` a probe process mid-run and walk away; the pane recovers on its own within the backoff window, showing stale-with-last-observation in between — no Retry click. Falsifier: any pane state derived client-side, or any harness whose light goes dark (rather than stale) on a probe failure.

## Scope

Spec sections of record: §2 Runtime persistent state (the status-document JSON, exact shape) · §2 The wire document (`sequence`/`fingerprint` governance) · §3 Flow 4 · §4 cell 2 (the `status/` tree, the local API, probe events) · §4 cell 4 (the subscribe migration).

- **The `status/` module** (runtime, new): one status document per harness persisted in the runtime's SQLite — `{harness_kind, methods[], applied, next_seat_id, rotate, probe:{verdict, at, stale}, cooling_until}` exactly as §2 prints it. Event-refreshed, **served stale-marked while a re-probe runs, never withdrawn**; survives restart marked stale until the startup pass re-verifies. It absorbs slice 2's transitional carry (serving/next/cooling on the old read path) and the legacy `auth_state.rs` derivation.
- **Doors**: local API `GET /status` + `GET /status/stream` (SSE) + `GET /methods` (`methods()` computable from the applied document only — policy gates writes and render, never runtime availability). Readiness consumes through the one seam (`apply_launch_route_upgrade`); the courier reports acks from it.
- **Probe recovery events**: `PokeReason` gains `BackoffExpired` and `FirstDetected`, and `AuthApplied` carries the changed harness set (per-harness targeting — an apply that changed only grok probes only grok). The event set now contains its own recovery: a missed probe re-enters through backoff expiry, not through a human.
- **Serve-stale observation store**: the last observation persists beside the status row; a probe failure dims (stale=true, last observation visible), never darkens.
- **The `sequence`/`fingerprint` split** (§2 governance, exact): document field `revision` → `sequence` (monotonic per surface, bumped only by content-changing renders; runtime rejects lower-than-persisted); `fingerprint` becomes a `GET /state` rider only (content hash of the canonical harnesses array), never in the document; drop the equal-revision clause. Contract fixture updated (both sides break until aligned). Alembic migration renames `agent_auth_delivery_ack.acked_revision` → `acked_sequence`. **Alembic heads: slice 4 also lands a migration — before finalizing, fetch main and re-parent your revision onto the current head (`check_migration_heads.py`).**
- **The launch-options basis fix** (bug f's root): `launch_options/basis.rs` stops folding the global document revision — the basis becomes a content hash of the harness's own entry, so a push that didn't change a harness cannot invalidate its options (`basis_ignores_noop_renders`).
- **Frontend subscribe migration**: panes subscribe the status stream through one access-layer seam (`useHarnessStatus(kind)` returning `{methods, applied, nextSeatId, rotate, probe, coolingUntil}`); **delete `agent-auth-evidence.ts`** and every client-side derivation with it; ban the pattern's return via the old-paths checker. The status document replaces `authState` on the agents projection (`credentialState`/`readiness` stay harnesses').

## Non-goals (deliberately out)

Usage meters and `seat_usage_sample` (slice 4, parallel) · the Rust `domains/agent_auth/` consolidation (Wave 3 — `status/` lands where the auth code lives today, moving later with everything else) · cross-machine status reconciliation (environments rebuild) · grok's login fix (slice 6 — but this slice's per-harness targeting must make grok's brokenness *stay grok's*).

## Proof

- `rendered_document_contains_every_configured_harness` — a selection change re-renders the full document, and untouched harnesses' entries are byte-identical.
- `basis_ignores_noop_renders` — a push with an unchanged harness entry leaves that harness's launch-options basis unchanged.
- `probe_failure_serves_stale_observation` — kill a probe: status serves stale=true with the prior observation; `BackoffExpired` re-probes and clears it, no manual poke.
- `launch_gates_on_resolvability_not_probe` — a stale probe verdict never blocks a launch the document can satisfy.
- `auth_applied_targets_changed_harnesses_only` — an apply naming only grok pokes only grok.
- Sequence/fingerprint: fixture pin both sides; ack-column migration round-trip; reject-below-sequence test.
- The evidence-file deletion is proven by the frontend fences: no import site remains, and the old-paths checker refuses its return.

## Discharges

Delta rows: status module & derivation absorption · probe self-recovery · sequence/fingerprint · authState replacement on the agents projection. Build list: the status-module child of the seats spine + the "alongside, not gating" content-hash items.
