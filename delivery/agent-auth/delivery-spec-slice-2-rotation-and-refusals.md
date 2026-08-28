# Delivery specification — agent_auth slice 2: rotation & refusals (frozen)

Chain position: slice 2 of the approved auth slice plan (0 funding ✅ → 1 mint & run ✅ PR #2254 → **2 rotation & refusals** → 3 ∥ 4 → 5 independent → 6). Evidence of record: the agent_auth system spec ([specs/systems/agent_auth/README.md](../../specs/systems/agent_auth/README.md) — §3 Flow 3's ladder, the Rotation-ownership ruling in §4 cell 2, the `LaunchRefusal` enum in §4) and slice 1's landed seat chain (branch `agent-auth-slice-1`, PR #2254). Builders implement from this document without re-deriving the architecture. **Base branch: `agent-auth-slice-1`** until #2254 merges; the PR retargets to main automatically at that merge.

## Intent

Many seats become a **pool**. A limit-hit seat cools and the next launch rotates past it without a human touching anything; when nothing can serve, the launch refuses **in words**. The `AGENT_ROUTE_SELECTION_MISSING` mystery-error class dies in this slice: every refusal a human can see is a typed reason with plain-English copy.

## Acceptance gate (the merge bar — performed by Pablo, in the product)

With two seats on the account, force a limit error on the serving seat (real or simulated) — the next session starts on seat 2 untouched, and the serving-now tag moves. Cool both — launching shows a sentence naming the earliest reset. Falsifier: `AGENT_ROUTE_SELECTION_MISSING` (or any bare error code) visible to a human anywhere in the product.

## Scope

Spec sections of record: agent_auth §3 Flow 3 (the resolve ladder with the seat arm complete) · §4 cell 1 (the limit-hit route, events) · §4 cell 2 (Rotation ownership: the runtime decides, the server supplies the pool) · §4 cell 3 (`reportSeatLimitHit`) · the design pass (serving-now / next-up tags, the rotate switch).

- **Pool render**: `state_render.py` emits **every active seat** for a harness as `seat` sources, in vault order (slice 1 rendered the deduped pool already — this slice removes any single-seat cap and pins the ordering with a test). Contract fixture gains a multi-seat variant.
- **Runtime rotation** (`route_auth/`): round-robin over the document's seat sources, skipping cooling ones; selection is runtime-local and deterministic (`last_served` per harness advances only on successful spawn). Per-seat cooling records `(seat_id, cooling_until)` persisted in the runtime's SQLite — a new small `seat_cooling` store that the slice-3 `status/` module will absorb; cooling survives restart.
- **Cooling trigger**: a limit error observed in session output marks the serving seat cooling until the reset time the error carries (absent a parseable reset: the top of the next 5-hour window). Marking is runtime-local and never waits on the network.
- **The typed refusal set, complete with copy** (§4's enum, exhaustively surfaced): `NoConfiguredSource` ("Claude Code isn't set up — pick a method in Settings") · `SourceUnsatisfied{reason}` (names the actual why: revoked key, out of credits) · `SeatCooling{seat, reset_at}` · `AllSeatsCooling{earliest_reset}` (names the earliest reset time). Every launch-path caller renders the words, never the variant name; exhaustiveness enforced at the surface (compile-time match, no catch-all).
- **Fallback**: when the harness's profile carries a non-seat source besides the pool (gateway), an all-cooling pool falls through to it before refusing; the refusal fires only when nothing can serve.
- **Limit-hit reporting**: courier `reportSeatLimitHit()` → `POST /seats/{key_id}/limit-hit` `{window, resetAt}`, fire-and-forget (cooling never waits on it); server logs `agent_seat_limit_hit` (and `agent_seat_rotated` on rotation). Events carry user, org, harness kind, seat id — never token material.
- **The relaunch offer**: a session that dies on a limit error offers one-click relaunch (which lands on the next seat via the ordinary ladder).
- **Pane**: serving-now / next-up tags per seat row and the per-harness rotate toggle (`agent_auth_harness_settings`, settings rider — **off pins the applied seat**, skipping rotation but not cooling). Transitional carry: the tags read `serving_seat_id` / `next_seat_id` / `cooling_until` surfaced on the existing local auth-state read path the pane consumes today; slice 3 moves them into the status document — build accordingly (one seam, no pane re-derivation).

## Non-goals (deliberately out — later slices)

The `status/` module, SSE stream, subscribe migration, `sequence`/`fingerprint` rename — **`revision` still ships on the wire** (slice 3) · usage meters and the probe loop (slice 4) · cross-machine cooling reconciliation (future; the limit-hit event is its feedstock) · org-owned pools (phase 2).

## Proof

- `limit_error_marks_seat_cooling_until_reset` — observed limit error → cooling record with the carried reset time.
- `all_seats_cooling_falls_back_with_reason` — pool exhausted: falls to gateway when present, else `AllSeatsCooling` naming the earliest reset.
- `rotation_skips_cooling_and_round_robins` — three seats, one cooling: launches alternate over the two active in document order.
- `rotate_toggle_off_pins_applied_seat` — toggle off: the applied seat serves even when a later seat is fresher; cooling still refuses.
- Typed-reason exhaustiveness on the launch surface (no catch-all arm; adding a variant breaks compile).
- Multi-seat contract-fixture pin, both sides; existing suites green throughout.

## Discharges

Delta rows: rotation flow · refusals-in-words (the `AGENT_ROUTE_SELECTION_MISSING` class). Build list: the "rotation" and "typed launch refusals" children of the seats-v1 spine item.
