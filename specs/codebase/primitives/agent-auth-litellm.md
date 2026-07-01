# Agent Auth via LiteLLM — Migration & Build-Out

Status: approved plan, execution in progress.
Date: 2026-07-01

Supersedes `agent-auth.md` and `agent-auth-bifrost-byok.md` (Bifrost-era).
Those specs remain as historical reference for the shipped stack that PR 1
removes.

Sources: pablo's mental-model notes + `~/agent_convo.txt` (harness
compatibility research, LiteLLM local testing at `http://127.0.0.1:4000`),
`~/proliferate/design-system` Agents pages (UI reference), Q&A decisions
recorded in §0.

## 0. Decision Register (locked)

| Decision | Choice |
| --- | --- |
| Gateway | **LiteLLM Proxy replaces Bifrost entirely.** Separate service with its own Postgres; control plane administrates via master key. |
| Bifrost code | Complete removal (PR 1). No compatibility shims. |
| Schema | **Full reset.** All Bifrost-era agent-auth/gateway/usage tables drop. Keep `free_cloud_allocation` (anti-abuse) and all compute-billing tables. Prod credentials are NOT migrated; users re-add keys. |
| Routes per (user, harness, surface) | `native` (local only), `api_key` (direct env), `gateway` (LiteLLM virtual key). |
| Synced-native-to-cloud | **Cut.** Cloud = `gateway` or `api_key` only. Selection model leaves room for a synced route to return later. |
| BYOK custody | **Direct everywhere.** The raw key is materialized into the harness env on both surfaces. Consequence: BYOK traffic is not metered by us; org admins cannot cap it (flag-only admin model covers this). |
| Key pool ownership | Personal only in v1. No org-shared keys. |
| Virtual keys | **Eager enrollment**: minted at signup (personal) and org-join (org context). Durable per (user, team). Attribution via request metadata tags. |
| State split | Server stores auth state (key pool, route selections, enrollment). Client localStorage stores UI prefs only (last model/effort/modes — the "no defaults" idea). |
| Auth changes → running sandboxes | **Live materialization**: selection changes push new state immediately (reusing workspace-flow materialization machinery). In-flight agent processes finish on old creds; the **next process launch** picks up new state. Sessions already running are never hot-swapped. |
| Sandbox identity | Single-user sandboxes in v1. Every workspace/sandbox has one owning user whose (harness, cloud) selections materialize. Shared org compute deferred. |
| Delivery contract | **Worker state-file on both surfaces.** Cloud worker and desktop dispatch worker write the same declarative agent-auth state file; AnyHarness renders per-harness launch profiles from it. |
| Catalog | Probe-generated via a booted runtime (same probe method as the initial catalog). User-triggered refresh per (harness, surface). User overrides allowed. Snapshots stored server-side. |
| Metering | Import LiteLLM spend logs by idempotent cursor into a slim usage-event ledger → LLM credit debits. LLM credits distinct from compute credits. |
| Limits | Per-user budgets set in LiteLLM. Org: hard cap unless overage billing enabled (then uncapped + auto-charge). |
| Top-ups | Background worker watches spend, auto-charges Stripe for LLM credit top-ups. Compute top-ups keep their existing mechanism. |
| Admin controls | **Flag-only in v1.** Org policy stored; violations computed from selections and listed on the enterprise page. No hard block. Editing restrictions is plan-gated. |
| Onboarding | Local-first native detection (credential-discovery crate). Gateway pitched when nothing detected or going cloud; free credits make gateway work instantly. |
| Infra | LiteLLM on ECS beside the server (staging + prod clusters), own RDS Postgres, config/image in this repo, existing deploy pipeline. |
| Prod data | Drop and re-enroll. Only `free_cloud_allocation` survives so free credits can't be double-claimed (reuse the same `allocation_kind` for dedup continuity). |
| Autonomy | Full autonomous execution incl. staging + prod deploys and live Stripe, subject to the per-PR gates in §10/§11. |

## 1. Mental Model

One question per (user, harness, surface):

```text
For user U running harness H on surface S (local | cloud),
which route pays for LLM calls and how is it materialized?
```

```text
route      surfaces      materialization
---------  ------------  ------------------------------------------
native     local only    harness's own auth (claude login, etc.);
                         we detect + leave alone
api_key    local, cloud  raw provider key from the personal key pool,
                         rendered into harness env/config
gateway    local, cloud  LiteLLM virtual key + public base URL,
                         rendered into harness env/config
```

Planes:

```text
LiteLLM Proxy      data plane. Harness → LiteLLM → provider. Meters,
                   enforces budgets/rate limits, serves /v1/models.
Proliferate server control plane. Users, orgs, key pool, selections,
                   enrollment, catalog snapshots, credits, Stripe.
AnyHarness         render plane. Turns the auth state file into
                   harness-specific env/args/config at launch.
```

Product credit split: **LLM credits** (gateway spend) vs **compute credits**
(sandbox hours). Separate ledgers, separate top-up mechanisms, one billing UI.

Fail-closed invariant: a scoped launch (cloud, or local with a selection)
with no resolvable route for the requested harness fails with a typed
`AGENT_AUTH_SELECTION_REQUIRED`-class error rather than falling through to
ambient credentials.

## 2. Gateway Architecture

### 2.1 Service

- LiteLLM Proxy container, ECS service per environment (staging lane + prod
  per the staging-infra layout), own RDS Postgres instance.
- Config (`litellm_config.yaml`) + image pin live in this repo; deployed via
  the existing pipeline.
- Master key in the environment's secrets manager; exposed to the server as
  `AGENT_GATEWAY_LITELLM_MASTER_KEY`. Never reaches sandboxes or clients.
- Managed provider keys (Proliferate-owned Anthropic/OpenAI/xAI/Google keys
  funding free credits + managed usage) are deployment secrets referenced by
  the LiteLLM config, not stored in our DB.
- Settings (config.py + env matrix + env-vars.yaml):

```text
AGENT_GATEWAY_ENABLED
AGENT_GATEWAY_LITELLM_BASE_URL          # private/admin URL (in-VPC)
AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL   # what sandboxes/local harnesses call
AGENT_GATEWAY_LITELLM_MASTER_KEY        # secret
AGENT_GATEWAY_LITELLM_TIMEOUT_SECONDS
```

### 2.2 Admin client

`server/proliferate/integrations/litellm/` (client.py, models.py, errors.py)
exposing coarse ops only:

```text
ensure_team, update_team_budget
ensure_user
mint_virtual_key, rotate_virtual_key, disable_virtual_key, set_key_budget
list_models(virtual_key)            # /v1/models as the key sees it
page_spend_logs(cursor_window)      # for the usage importer
health()
```

No LiteLLM endpoint paths leak into product services.

### 2.3 Enrollment model

- LiteLLM **team per billing subject**: personal billing subject → personal
  team; organization → org team. Team budget mirrors the subject's LLM
  credit state.
- LiteLLM **user per Proliferate user**; **virtual key per (user, team)**,
  durable, stored encrypted in `agent_gateway_enrollment`.
- Minted eagerly: at signup (personal), at org join/activation (org), plus a
  backfill task for existing users.
- Session/workspace attribution via request metadata tags (workspace id,
  session id) added by the harness env where supported; per-key attribution
  is the floor.
- Revocation: disabling a virtual key in LiteLLM is immediate for all
  gateway traffic (this is why cloud defaults to gateway).

## 3. Data Model

### 3.1 Drop (PR 1 migration)

All of: `agent_auth_credential`, `agent_auth_credential_share`,
`sandbox_agent_auth_selection`, `sandbox_profile_agent_auth_revision`,
`agent_gateway_budget_subject`, `agent_gateway_free_credit_entitlement`,
`agent_gateway_policy`, `agent_gateway_provider_credential`,
`agent_gateway_runtime_grant`, `agent_gateway_router_materialization`,
`agent_gateway_llm_usage_event`, `agent_gateway_usage_import_cursor`,
`agent_auth_audit_event`, plus the agent-auth columns of
`sandbox_profile_target_state` (drop the whole table / `sandbox_profile`
too **iff** nothing outside agent-auth still reads them on main — decide in
PR 1 against main's actual shape and record the outcome in the PR).

### 3.2 Keep

`free_cloud_allocation` (reuse `allocation_kind =
agent_gateway_free_credits` so historical dedup holds), all `billing_*` /
`usage_segment` compute tables, Stripe wiring, generic credential
encryption/redaction helpers (relocate to a neutral module if they live
under the deleted `agent_auth/` package).

### 3.3 New tables (PR 3)

```text
agent_api_key                      # personal key pool
  id, user_id, provider, display_name,
  payload_ciphertext, payload_ciphertext_key_id, redacted_hint,
  status (active|revoked), last_validated_at,
  created_at, updated_at, revoked_at

agent_auth_route_selection         # server-side auth state
  id, user_id, harness_kind, surface (local|cloud),
  route (native|api_key|gateway), api_key_id (fk, null),
  revision, created_at, updated_at
  UNIQUE (user_id, harness_kind, surface)
  CHECK (surface='cloud' → route != 'native')

agent_gateway_enrollment
  id, subject_kind (user|organization), user_id, organization_id,
  billing_subject_id, litellm_team_id, litellm_user_id,
  virtual_key_id, virtual_key_ciphertext, virtual_key_ciphertext_key_id,
  sync_status, sync_fingerprint, last_error_code, last_error_message,
  created_at, updated_at, revoked_at

agent_catalog_snapshot             # probe results
  id, harness_kind, surface, route, owner_user_id (null = seed),
  models_json, probed_at, source (probe|seed|override), status

agent_catalog_override             # user/org catalog edits
  id, owner_user_id/organization_id, harness_kind, patch_json, timestamps

org_agent_policy                   # flag-only admin (PR 11)
  organization_id, allowed_routes_json, allowed_harnesses_json,
  updated_by_user_id, timestamps
  (violations computed live from selections; no violations table)

agent_llm_usage_event              # PR 8, slim ledger
  id, litellm_request_id (unique), virtual_key_id, litellm_team_id,
  user_id, organization_id, billing_subject_id,
  provider, model, prompt_tokens, completion_tokens, total_tokens,
  cost_usd, status, workspace_id?, session_id?, occurred_at, imported_at,
  raw_metadata_json

agent_llm_usage_import_cursor
  id (singleton), last_seen_occurred_at, last_polled_at, status,
  last_error_*, metadata_json
```

## 4. Harness Adapter Matrix

From the `agent_convo.txt` research; PR 2's smoke harness re-verifies each
row against the deployed proxy before PR 6 encodes it.

| Harness | Switch-time setup | Launch-time rendering | Model discovery | Notes / risks |
| --- | --- | --- | --- | --- |
| Claude Code | none | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` (gateway) or `ANTHROPIC_API_KEY` (direct); `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1` | selected model | verify streaming + tool-use fidelity through LiteLLM `/anthropic` |
| Codex | isolated `CODEX_HOME`; `codex login --with-api-key` | `CODEX_HOME`, `-m <model>`, `model_providers.proliferate.{base_url,env_key,wire_api=responses}` | selected model | **open risk**: Codex→LiteLLM→Anthropic throws `Unsupported tool type: namespace` / `client_metadata` errors; v1 may restrict Codex-on-gateway to OpenAI-family |
| OpenCode | none | `OPENCODE_CONFIG_CONTENT` with explicit `provider.proliferate.models` list (+ per-provider keys for direct) | **must render model list into config** (needs `model_catalog_json`) | additive multi-provider; probe scan ~9.5s/context — needs spinner |
| Grok | isolated `GROK_HOME` | `GROK_MODELS_BASE_URL`, `XAI_API_KEY`, `--model` | fetches `/v1/models` dynamically | **open risk**: calls `grok-build` alias for title-gen; add a LiteLLM model alias or Grok config override |
| Gemini | none | `GOOGLE_GEMINI_BASE_URL`, `GEMINI_API_KEY` | selected model | gemini 0.46 probe quirk (probes 0 models) noted in catalog gotchas |

AnyHarness stores the resolved profile per (harness, surface):

```text
AgentRuntimeAuthProfile
  harness_kind, mode (native|api_key|gateway), selected_model?,
  base_url?, key_ref, model_catalog_json?, codex_home?, grok_home?,
  revision
```

Switch-time does provisioning (isolated homes, `codex login`); launch-time
only renders env/args. No per-launch refetch.

## 5. Materialization & Delivery

Reuse the workspace-flow machinery in
`server/proliferate/server/cloud/materialization/` (post-commit
`run_after_commit` scheduling, Redis lock per sandbox, atomic private file
writes, SHA256 manifest reconcile → cleanup of stale files).

New: `materialize/agent_auth.py` building a declarative **agent-auth state
file** written into the sandbox (same pattern as secrets/github creds):

```jsonc
// ~/.anyharness/agent-auth/state.json (0600)
{
  "revision": 42,
  "user_id": "…",
  "selections": [
    { "harness": "claude", "route": "gateway",
      "base_url": "https://llm.proliferate.ai/anthropic",
      "key": "<virtual key>" },
    { "harness": "codex", "route": "api_key",
      "provider": "openai", "key": "<raw key>" }
  ]
}
```

Triggers: route-selection change, key revoke/rotate, enrollment rotate,
sandbox boot (part of `materialize_sandbox`). Cleanup: manifest diff deletes
stale entries/isolated homes; a revoked `api_key` route's key disappears at
the next materialization pass (accepted direct-custody tradeoff), while
gateway revocation is instant at LiteLLM.

Local surface: the desktop dispatch worker writes the identical state file
into the local AnyHarness home at switch-time. One render path in AnyHarness
for both surfaces. Running processes are never mutated; next launch reads
the new revision.

## 6. Catalog

- Probe command runs through a **booted runtime** per (harness, route,
  surface) — same mechanism that generates the initial catalog. Results
  upload as `agent_catalog_snapshot`.
- UI: "All models" grid per harness with Refresh (per local/cloud toggle);
  user overrides layer on top (`agent_catalog_override`).
- Canonical model refs: one product-level name (`claude-sonnet-4-5`)
  resolves per route/harness (`anthropic/…`, `proliferate/…`, `-m …`).
- Gateway route seeds from LiteLLM `/v1/models` per virtual key; probes
  refine.
- **Catalog gotchas apply**: JS validator AND Rust `cargo test` both gate
  catalog changes; `catalog.json` is `include_str!`'d → runtime rebuild
  required.

## 7. Metering, Credits, Limits (gateway traffic only)

- Importer pages LiteLLM spend logs with an overlap window, dedupes on
  `litellm_request_id`, writes `agent_llm_usage_event`, debits LLM credits.
- Free credits: granted at signup, deduped through `free_cloud_allocation`.
  Enrollment budget in LiteLLM set to remaining credit.
- Exhaustion: LiteLLM budget is the runtime guardrail (hard stop); importer
  reconciles our ledger, disables/zeroes keys, blocks new **gateway-route**
  launches. `api_key`/`native` routes are unaffected.
- Org: team budget = hard cap; if `overage_enabled`, no cap + top-up worker
  auto-charges Stripe (LLM meter/price distinct from compute overage) and
  raises the LiteLLM budget.
- Not penny-perfect in real time; never unbounded after exhaustion.

## 8. Admin (v1 flag-only)

- `org_agent_policy` edited from the enterprise page; editing gated by org
  plan.
- Violations = members whose active selections conflict with policy
  (computed from `agent_auth_route_selection` — no traffic inspection).
  Listed with user, harness, route. Nothing is blocked.

## 9. Onboarding

- First run (Desktop): credential-discovery scan → detected native auth is
  adopted as `native` selections for local; overview page shows Install for
  missing harnesses.
- Nothing detected, or first cloud workspace → `gateway` with free credits
  (works instantly, zero config).
- Settings later expose `api_key` / route switches per harness.

## 10. PR Stack

Branches `agent-auth/01-…` through `agent-auth/12-…`, all off `main`.
Ordering: 1 → 2 → 3 → 4, then {5, 6, 7} (runtime track) ∥ {10} (UI) ∥
{8 → 9} (billing track), then 11, 12. Only PR 5 additionally waits on the
workspace-flow stack (`codex/cloud-workspace-flow` PRs) being merged — it
extends `server/cloud/materialization/`, which exists only there today.

Every PR: server structure guides respected (integrations/ vs server/cloud/
vs db/store vs db/models vs config.py), env matrix + `env-vars.yaml`
updated when settings change, SDKs regenerated when contracts change,
conventional-commit messages, PR body ends with the standard attribution.

**PR 1 — Bifrost teardown** (`agent-auth/01-bifrost-teardown`)
Delete: `integrations/bifrost/`, `server/cloud/agent_auth/` (relocating any
generic crypto helpers first), agent-auth models/stores, §3.1 drop
migration, dead config flags, worker `materialization/agent_auth.rs` +
dispatcher references, AnyHarness `agent_auth_config` contract/http/domain
surface (+ SQLite drop migration), Desktop agent-auth panes/hooks/config,
SDK regen. Verify each target exists **on main** (some spec-described code
may only exist on the workspace branch); record discrepancies in the PR.
Gates: `cd server && uv run pytest -q`; alembic upgrade on a fresh DB;
`cargo test` (contract, lib, worker); `cd anyharness/sdk && pnpm generate &&
pnpm build`; `cd cloud/sdk && pnpm generate && pnpm build`; desktop
`pnpm typecheck && pnpm test -- --run`; `rg -i bifrost` returns only
docs/specs history.

**PR 2 — LiteLLM service + admin client** (`02-litellm-service`)
Docker-compose LiteLLM + Postgres for local dev (`pdev` profile wiring,
`AGENT_GATEWAY=litellm`), ECS/RDS IaC for staging+prod, config settings,
`integrations/litellm/` client, `scripts/agent-gateway-smoke/` harness that
mints a scoped key and drives **each CLI harness** (claude, codex, opencode,
grok, gemini) through the proxy — this is where §4's open risks get settled
and the matrix corrected.
Gates: client unit tests (mocked); live smoke vs local docker LiteLLM
(mint key → `/v1/models` → chat completion per harness → spend log visible);
staging deploy + same smoke against staging URL.

**PR 3 — Schema + enrollment** (`03-schema-enrollment`)
§3.3 tables + stores, eager enrollment hooks (signup, org activation/join)
+ backfill task, budget mirror to LiteLLM.
Gates: server pytest (store + enrollment integration w/ mocked client);
migration up/down; live: create user locally → team/user/VK appear in local
LiteLLM.

**PR 4 — Auth APIs + SDKs** (`04-auth-api`)
Key pool CRUD (validate-on-add optional), route-selection endpoints,
capabilities endpoint (gateway enabled/flags — Desktop never hardcodes),
audit log entries, cloud-sdk regen.
Gates: API integration tests; sdk generate/build; `rg` proves Desktop reads
capabilities not constants (once PR 10 lands).

**PR 5 — Cloud live materialization** (`05-cloud-materialization`) — after
workspace stack merges.
`materialize/agent_auth.py` + state-file contract + triggers + manifest
cleanup; selection-change → running-sandbox refresh; sandbox boot includes
agent-auth state.
Gates: server pytest on plan/manifest/cleanup; live E2B: boot sandbox →
state file present; flip route → file updates + old key cleaned; revoke →
next materialization removes key.

**PR 6 — AnyHarness profiles + adapters** (`06-anyharness-adapters`)
State-file ingestion → `AgentRuntimeAuthProfile` (SQLite), switch-time
provisioning (CODEX_HOME/GROK_HOME, `codex login --with-api-key`),
launch-time render per §4, fail-closed typed error, desktop dispatch worker
writes the state file locally.
Gates: cargo tests per adapter (render snapshots); fail-closed tests; live
local: switch routes in a dev build → launch each harness against local
LiteLLM and a direct key.

**PR 7 — Catalog probe/refresh/override** (`07-catalog`)
Probe command per (harness, route), snapshot upload API, refresh endpoint,
overrides, canonical-ref resolution. Respect catalog gotchas (JS validator +
Rust tests + `include_str!` rebuild).
Gates: JS catalog validator; `cargo test` catalog suites; live: refresh
against local LiteLLM changes the stored snapshot; OpenCode probe completes
and renders config models.

**PR 8 — Usage import + LLM credits** (`08-usage-credits`)
Importer (cursor, overlap, dedupe), ledger, free-credit grant via
`free_cloud_allocation`, debit + exhaustion → disable VK + block
gateway-route launches; usage surfaces in billing UI data model.
Gates: importer unit tests (idempotency, missing-cost rows → needs_review);
live: drive spend through local LiteLLM → ledger rows → tiny grant exhausts
→ VK disabled → gateway launch blocked.

**PR 9 — Limits + auto top-up** (`09-limits-topups`)
Per-user budgets from credit state, org hard-cap vs overage, top-up worker →
Stripe (LLM meter/price ids added beside existing compute ones), budget
raise back into LiteLLM.
Gates: worker unit tests; Stripe test-mode end-to-end (staging); prod flip
only after a full staging cycle with real spend.

**PR 10 — Settings UI** (`10-settings-ui`)
Product pages per the design-system reference: Agents overview grid,
API-keys pool, per-agent page (cloud/local segmented control; Authentication
radio group gateway/api_key/native; harness settings; All-models table +
refresh). UI polish is explicitly NOT the bar here — build on the
`@proliferate/product-ui` settings primitives landing from the parallel UX
waves (`SettingsPageHeader`, `SettingsScopeTabs`, `SettingsEmptyState`, flat
rows); design-system stays reference-only, no token imports.
Gates: desktop typecheck + tests; manual pdev pass across all three routes ×
two surfaces.

**PR 11 — Admin + enterprise page** (`11-admin-policy`)
`org_agent_policy` CRUD (plan-gated), violations list from selections,
enterprise page section.
Gates: API tests incl. plan gating; UI shows violators when policy conflicts
with an existing selection.

**PR 12 — Onboarding** (`12-onboarding`)
First-run detection→adopt flow, install gates on overview, gateway+free
credits default for cloud/empty-local.
Gates: desktop tests; manual first-run on a clean profile (fresh
`ANYHARNESS_HOME`) with and without native auth present.

## 11. Autonomous Verification Playbook

Standing gates (every PR): server `uv run pytest -q`, `cargo test`
(touched crates minimum), SDK regen builds, desktop
`pnpm typecheck && pnpm test -- --run`, migration up/down on fresh DB.

Live checks available without asking: docker (local LiteLLM + Postgres),
`pdev` dev profiles (+ ngrok tunnel for E2B reachability), real E2B
sandboxes, gh/aws CLIs, staging deploys via the pipeline, Stripe test mode.
Prod deploys ride the existing staging→prod pipeline (if repo-shape checks
still block promotion, use the established Hotfix Production lane). Live
Stripe objects for PR 9 are created only after the staging cycle passes.

Rollout order in prod: LiteLLM service first (dark, `AGENT_GATEWAY_ENABLED`
off), teardown + schema next (drops are safe: Bifrost gateway was
default-off in prod), then feature PRs as they land.

## 12. End-to-End Acceptance Harness

Per-PR gates prove PRs; this proves the product. A checked-in scripted
suite at `scripts/agent-gateway-smoke/e2e/` (extends PR 2's smoke harness),
runnable against any environment (`--env local|staging|prod-dark`). Each
scenario is added by the PR that makes it possible and **every subsequent
PR merge re-runs the whole accumulated suite** — regressions surface at the
PR that caused them, not at the end.

| # | Scenario (proves) | Lands with |
| --- | --- | --- |
| E1 | Gateway data path: mint scoped VK → each harness CLI completes a turn through LiteLLM → spend log visible | PR 2 |
| E2 | Fresh signup → eager enrollment (team/user/VK in LiteLLM) → free credits granted, deduped via `free_cloud_allocation` | PR 3 (credits assert extends in PR 8) |
| E3 | Key pool: add key → select `api_key` for (claude, cloud) → selection readable via API | PR 4 |
| E4 | Cloud live sync: boot E2B workspace → state file present; flip route → file revision bumps + stale creds cleaned; session launched pre-flip finishes on old creds, next launch uses new | PR 5 |
| E5 | Render matrix: for each harness × {gateway, api_key} (+ native local): launch, model call succeeds, fail-closed error when no route resolvable | PR 6 |
| E6 | Catalog: refresh (harness, surface) → probe runs → snapshot changes → grid data updates; override survives refresh | PR 7 |
| E7 | Golden loop: new user → cloud workspace → Claude turn via gateway → importer runs → ledger row → credit debited → balance visible | PR 8 |
| E8 | Exhaustion: tiny grant → spend past it → VK disabled in LiteLLM → gateway launch blocked with typed error → `api_key` route still launches | PR 8 |
| E9 | Limits/top-up: org hard cap blocks at cap; overage org auto-charges (Stripe test mode) and LiteLLM budget rises | PR 9 |
| E10 | Admin flags: set org policy → conflicting member selection listed as violation; nothing blocked | PR 11 |
| E11 | Onboarding: clean `ANYHARNESS_HOME` with seeded native creds → detected + adopted; without → gateway default + free credits | PR 12 |

Environment ladder per PR: (1) full suite on local (docker LiteLLM +
pdev + ngrok'd E2B where needed) before merge; (2) suite minus
Stripe-live against staging after the staging deploy; (3) after prod
rollout steps, E1/E2/E7 against prod-dark with a throwaway account before
enabling `AGENT_GATEWAY_ENABLED` for real users. A failed rung reverts or
blocks promotion — the deploy-pipeline hotfix lane is for emergencies, not
for skipping rungs.

## 13. Open Risks

1. Codex → LiteLLM → Anthropic tool-call translation errors (settle in
   PR 2 smoke; fallback: OpenAI-family only for Codex gateway in v1).
2. Grok `grok-build` alias missing from LiteLLM (alias in LiteLLM config or
   Grok config override).
3. Claude Code streaming/tool-use fidelity through LiteLLM `/anthropic`
   passthrough — verify early, it's the flagship path.
4. OpenCode probe latency (~9.5s) — UI spinner, no blocking calls on the
   settings page load.
5. Workspace-flow branch not yet merged — PR 5 blocked on it; PRs 1–4 may
   conflict with it at merge time (both touch worker/cloud command paths);
   rebase burden accepted.
6. BYOK direct-everywhere means revoked raw keys persist in sandboxes until
   the next materialization pass — documented behavior, revisit if it bites.
