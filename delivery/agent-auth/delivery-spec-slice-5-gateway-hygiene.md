# Delivery specification — agent_auth slice 5: gateway hygiene (frozen)

Chain position: slice 5 of the approved auth slice plan — **independent of slices 2–4**, runs off `main` any time. Evidence of record: the ai_gateway system spec ([specs/systems/ai_gateway/README.md](../../specs/systems/ai_gateway/README.md)) and the fence-enforcement table in [agent_auth §0](../../specs/systems/agent_auth/README.md) (merged #2252). Builders implement from this document without re-deriving the architecture. **Base branch: `main`.**

## Intent

The ai_gateway system's code matches its spec: its own folder, its own manifest, its own fences — and the two live operational gaps close (verification off; the signup-grant miss that left the founder org unfunded for 8 days). Zero behavior change in the split itself; the behavior changes are the verification enable, the codex model refresh, and the zero-grant alert.

## Acceptance gate (the merge bar — performed by Pablo, or demonstrated to him from CI + a staging run)

`server/proliferate/server/ai_gateway/` exists with its own MANIFEST and every gateway suite green across the move. A deliberately wrong config.yaml model entry gets flagged `verification_status=misconfigured` (with its delta) within the verification interval. A fresh signup on a new GitHub identity lands with a nonzero credit balance — no admin grant. Falsifier: any gateway suite skipped or weakened to get the move green, or a fence/manifest checker exception added.

## Scope

Spec sections of record: ai_gateway §0 census (the `⇒ ai_gateway` files) · §4 Structure (the final tree) · §3 Flow 5 (verification) · agent_auth §0 fence-enforcement table (the server fence file + store locks land here) · agent_auth §4 cell 1 (the recomposed remainder).

- **The code split** (move-only, zero behavior): the gateway files out of `server/proliferate/server/agent_auth/` — enrollment, free_credits, budget, usage_import, topups, verification, migration, signup_hook, worker, and api.py's `/agent-gateway` routes — into `server/proliferate/server/ai_gateway/` with its own `MANIFEST.toml`. The agent_auth remainder recomposes into `vault.py` / `state_render.py` / `seats.py` / `selection_rules.py` / api.py per the spec's cell-1 tree. Import sites updated mechanically; `git log --follow` must survive (moves, not delete+create).
- **Fence teeth** (the enforcement table's two server rows): `lints/server/fences.toml` — server domain-import fence on the anyharness record shape (shrink-only edge baseline, measured at introduction), enforced by extending `check_server_boundaries.py` or a sibling checker wired into the Repo-shape CI job; plus `NamedStoreBoundary` locks for the agent-auth vault (`api_keys`) and selection stores — credential-bearing symbols owner-locked to `agent_auth`/`ai_gateway` modules.
- **Verification on**: flip `agent_gateway_verification_enabled` default to true now that config.yaml is settled (#2249); the loop records `verification_status` per enrollment key, `misconfigured` carries the delta `{reason, models}` onto the capabilities read.
- **Codex model refresh**: the gpt-5.2-era entries in config.yaml (mirror of #2249's claude fix — the same 403 is waiting on codex's current default model).
- **The signup-grant miss**: find why `ensure_signup_enrollment` → free-credits granting never ran for the founder org (the enrollment row existed; no `free_signup` grant row was ever created). Fix the hole, and add the guard: an enrollment older than one hour whose org has zero grant rows raises an ops alert (log-based is acceptable; a worker-loop check is the spec-shaped home). Backfill check: a one-off sweep listing any other zero-grant orgs in prod.
- **MANIFEST + atlas**: `check_manifests` green with the new folder; the ownership-atlas OWNERSHIP table gains the `server/ai_gateway/` region (edit `scripts/ownership-atlas/generate.py`, regenerate).

## Non-goals (deliberately out)

Per-run keys and envelopes (open ruling — ai_magic stays on direct endpoints) · any Rust or frontend move (Wave 3/4) · the seat_usage tables (slice 4) · retiring the transitional delta tables (that happens at convergence, not here).

## Proof

- Every existing `test_agent_gateway_*` suite green **unmodified** across the move (the move is proven by the tests not noticing it).
- `test_litellm_config_access_groups.py` still pins the reviewed config.yaml, extended over the codex entries.
- A verification-loop integration test: wrong access-group model on a key → `misconfigured` + delta within one loop tick; corrected config → status clears.
- A signup-path test proving the grant row lands in the same flow as the enrollment row (regression for the founder-org miss), plus the zero-grant guard's unit test.
- `lints/server/fences.toml` baseline equals reality at introduction (checker self-test), and the vault-store lock rejects an out-of-owner import in the checker's unit tests.

## Discharges

ai_gateway's delta table: the folder/manifest row, the verification-default row, the codex-models row, the signup-gap build item — everything except per-run keys. agent_auth: the fence-teeth build item's first two steps (store locks + server fence file; the Rust node stays with Wave 3).
