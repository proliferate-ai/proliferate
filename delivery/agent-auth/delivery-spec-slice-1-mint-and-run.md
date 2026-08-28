# Delivery specification — agent_auth slice 1: mint & run (frozen)

Chain position: slice 1 of the approved auth slice plan (0 funding ✅ → **1 mint & run** → 2 rotation → 3 ∥ 4 → 5 independent → 6). Evidence of record: the approved agent_auth system spec ([specs/systems/agent_auth/README.md](../../specs/systems/agent_auth/README.md), merged #2247), the live feasibility tests of 2026-08-26 (setup-token format · end-to-end seat session through the installed adapter · per-seat keychain coexistence — all passed), and the ai_gateway spec's `seat_pool` grant source already present in the schema. This document freezes the slice-1 deltas; builders implement from it without re-deriving the architecture.

## Intent

A Claude Max login becomes a **seat** — a portable credential in the vault — and a session runs on it. The full mint → store → render → apply → launch chain for a single seat, end to end, product-grade. This is the spine slice: rotation, meters, and the status module build on what lands here.

## Acceptance gate (the merge bar — performed by Pablo, in the product)

In settings: click **"Add a Claude.ai login"**, sign in via the browser; the seat appears labeled with the entered email. Start a Claude Code session, send "hi" — it answers, and the Anthropic account's own usage shows the burn on the **Max plan** (not gateway credits, not an API key). Falsifier: any step requires a terminal or a pasted token, or the session bills anything else. Secondary checks: revoking the seat removes it from the next render and the harness refuses with plain words; an aborted mint leaves no secret anywhere (vault, disk, logs).

## Scope

Spec sections of record: agent_auth §2 Data (vault kind, selection shape, wire `seat` source) · §3 Flow 2 (mint) and Flow 3 (launch, seat arm without rotation) · §4 cell 1 (routes, renderer) and cell 2 (seat recipe, homes, login terminal) · the design pass (Auth Options v2 — Claude.ai logins section, single-seat subset).

- **Schema + constants**: `anthropic_subscription` in `agent_api_key.kind`; `seat` in `agent_auth_selection.source_kind`; the pool selection shape (one enabled `seat` row, `api_key_id NULL` = pool, non-null pins; the radio counts kinds). One alembic migration (CHECK constraint rebuilds); `constants/agent_gateway.py` vocab + registry mirror updates.
- **Stores**: `db/store/agent_gateway/api_keys.py` (seat kind through CRUD; decrypt-for-render), `selections.py` (write gate: a seat row references an `anthropic_subscription` entry or NULL; env_var_name forbidden), `records.py`/`mappers.py`.
- **Server**: `server/agent_auth/models.py` (wire `seat` source + keys-create accepting the kind + the mint label fields), `selection_rules.py` (seat legality per the kind-counting radio), `state_render.py` (expand the pool row into seat sources, vault order — single seat this slice), `seats.py` (new: seat rows' lifecycle glue; no probe loop yet).
- **Wire pin**: `fixtures/contracts/agent-auth-state/` gains the `seat` variant; renderer asserts producing, Rust asserts consuming.
- **Runtime**: `route_auth/state.rs` (parse the variant), `profile.rs`, `render.rs` (the seat recipe: `CLAUDE_CODE_OAUTH_TOKEN` + per-seat `CLAUDE_CONFIG_DIR` + the strip list `ANTHROPIC_AUTH_TOKEN`/`_API_KEY`/`_BASE_URL` + rerouting flags), `materialize.rs` (the `claude-config-<seat>/` home family), `auth/login_terminal.rs` (the `mint_seat` variant: run `claude setup-token` in an isolated dir; capture = last non-empty line matching `^sk-ant-[A-Za-z0-9_-]{40,}$`; completion = terminal exit or 60s grace after match; buffer wiped on handoff and on error; **single-flight per harness — new guard**), the ws login-terminal route's variant parameter.
- **Courier + client**: `uploadSeatToken()` (memory-only, one POST, no silent retry); the settings pane's single-seat subset of the design: the "Add a Claude.ai login" affordance, the mint sheet (email + optional plan tier, defaults "Max seat N"), the inline waiting-for-sign-in row, the seat row with label; SDK regen for the keys-create kind.
- **Verification**: the ordinary launch probe under the seat's home after apply; a failed verification leaves the seat saved, shown unverified with the probe's detail.
- **Refusal wording** for the cases this slice touches (`SourceUnsatisfied`: revoked seat).

## Non-goals (deliberately out — later slices)

Rotation, cooling, and the limit-hit report (slice 2) · the status module, SSE, subscribe migration, probe recovery events, the `sequence`/`fingerprint` rename — **this slice still ships `revision` on the wire** (slice 3) · usage probe and meters (slice 4) · the ai_gateway code split (slice 5) · codex seats, org-owned seat rows, the native-migration bridge (phase 2 / slice 6 / rulings as dated).

## Proof

- `seat_mint_store_render_launch_roundtrip` — the e2e proven by hand on 2026-08-26, automated: mint (stubbed token print) → vault row → render → apply → launch env contains the token + per-seat dir with the strip list applied.
- `mint_capture_never_touches_disk` — abort at each step; assert no secret in vault, files, or logs.
- Seat render/strip-list cases in `route_auth` render tests; contract-fixture update breaking both sides until aligned.
- Store write-gate tests for the seat selection shape; selection-rules kind-counting radio.
- Existing suites green throughout (`test_agent_gateway_*`, route_auth tests, pane vitest).

## Discharges

Delta rows: seat vault kind + wire source · the seat-minting flow · (partially) plain-words refusals. Build list: the "Seats v1" spine item's mint/store/render/apply/verify parts, minus its slice-2/3/4 nested children.
