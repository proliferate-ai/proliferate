# Delivery specification — agent_auth slice 4: meters (frozen)

Chain position: slice 4 of the approved auth slice plan (parallel with slice 3; its true code dependency is slice 1's seats, so it may build stacked on `agent-auth-slice-1`/`-2` — whichever is the live tip when the runner starts — and retargets as those merge). Evidence of record: the agent_auth system spec ([specs/systems/agent_auth/README.md](../../specs/systems/agent_auth/README.md) — §2's `seat_usage_sample` DDL, §3 Flow 5's usage probe, §4 cell 1's `seats.py`/`seat_usage_probe` and `GET /seats/usage`) and the live feasibility capture of 2026-08-26: a one-token `/v1/messages` request under a seat token returns `anthropic-ratelimit-unified-{5h,7d}-*` headers (utilization + reset), account-global. Builders implement from this document without re-deriving the architecture.

## Intent

Live 5-hour and 7-day usage bars per seat in the settings pane — the "show overall usage" view. **Advisory only, never a launch gate**: the header surface is undocumented upstream, so nothing in the launch path may ever read a sample.

## Acceptance gate (the merge bar — performed by Pablo, in the product)

The pane shows live 5h/7d bars per seat with reset times and the binding window emphasized; run a heavy session for a few minutes and the bar moves, matching `claude /usage` on that account. Falsifier: any launch-path code reads `seat_usage_sample`, or a probe failure changes any launch behavior.

## Scope

Spec sections of record: §2 `seat_usage_sample` (column-exact DDL) · §3 Flow 5 (the soft signal — cadence, egress, backoff, pruning) · §4 cell 1 (`seats.py`, the usage read) · the design pass (per-seat 5h/7d meters, binding window emphasized, warning at ≥75%, reset times).

- **Schema**: `seat_usage_sample` exactly per §2 — `api_key_id → agent_api_key`, `sampled_at`, `util_5h`/`util_7d` (0..1), `reset_5h`/`reset_7d`, `binding_window` (`five_hour|seven_day`), `status CHECK IN ('allowed','limited','probe_failed')`. One alembic migration. **Alembic heads: slice 3 also lands a migration — before finalizing, fetch and re-parent onto the current head (`check_migration_heads.py`).**
- **The probe loop** (server, `seats.py` / `seat_usage_probe`): a one-token request per active seat reading the ratelimit headers; cadence config `agent_seat_usage_probe_active_interval` (default 5 min while a session runs on the seat) / `agent_seat_usage_probe_idle_interval` (default 30 min); off for revoked seats; provider errors record a `probe_failed` sample and back off exponentially to a one-hour cap; the request follows the same pinned-address egress rules as every outbound call; the writer prunes samples older than 30 days. Header parsing is defensive: an absent or unparseable header yields a `probe_failed` sample, never a crash or a guessed number.
- **The read**: `GET /seats/usage` — latest sample per seat (the meters read only the latest); shaped for the pane, no raw header passthrough.
- **Pane meters**: per-seat 5h and 7d bars with reset times, binding window emphasized, warning treatment at ≥75%; a settings-pane open forces one fresh sample (the pane-open poke). Unverified/probe_failed renders honestly (a dash and the sample age, never a stale bar pretending to be live).
- **Secret hygiene**: the probe decrypts the seat token in memory for the request only; tokens never land in samples, logs, or error messages (`check_agent_auth_secret_logs.py` covers the new module).
- **Events**: none new (the meters read; `agent_seat_limit_hit` is slice 2's).

## Non-goals (deliberately out)

Rotation decisions from samples (rotation is runtime-owned, driven by *observed* limit errors — slice 2; samples never feed it) · the status document (slice 3 — the meters are server-fed pane data, not runtime status) · codex usage (phase 2) · alerting/notifications on high usage (future; the ≥75% treatment is pane-only).

## Proof

- Header-parse unit tests against captured real responses (the 2026-08-26 capture is the fixture seed), including absent-header and garbage-header cases → `probe_failed`.
- **The advisory-only assertion**: no launch-path module imports the sample store or its records — enforced as a test (import scan) so the constraint survives refactors.
- Cadence/backoff unit tests (active vs idle interval selection; exponential cap at one hour; revoked seats skipped).
- Pruning test (31-day-old samples deleted by the writer's pass).
- `GET /seats/usage` returns latest-per-seat under multiple samples; pane vitest for the meter states (live, warning, probe_failed, no-sample-yet).

## Discharges

Delta rows: `seat_usage_sample` + the usage probe + meters. Build list: the usage-probe child of the seats spine.
