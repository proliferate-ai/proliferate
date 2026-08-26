# AI gateway

Managed model access: a deployment pays for and controls inference on behalf of every organization member without any client, worker, or machine ever holding a provider credential. The harness remains the execution client; this system decides *whether* and *under whose budget* it may call a model. (Formerly `agent_auth/model-gateway.md` — split into its own system 2026-08-26; the code split out of `server/agent_auth/` rides the agent_auth build list.)

The one-sentence contract: **every gateway request is made with a per-(org member, harness) virtual key whose access group limits the models it can see, whose team budget mirrors the org's remaining LLM credit, and whose spend is imported back into that org's ledger; unfunded means no key.**

This spec reads as ground truth; differences from `main` are collected in the transitional section at the end.

## 0 · Scope

**The folder census:** the gateway files inside `server/agent_auth/` (enrollment, free_credits, budget, usage_import, topups, verification, migration, signup_hook, worker — marked `⇒ ai_gateway` in the agent_auth code map) · the gateway stores in `db/store/agent_gateway/` (enrollments, enrollment_keys, credits, usage) · the five gateway tables in `db/models/agent_gateway.py` · the data plane at `server/litellm/` (config.yaml + Dockerfile) · the vendor leaf `integrations/litellm/` · `server/ai_magic/` as the control plane's own inference consumer.

**Responsibilities:** enroll every (org, member) into the org's LiteLLM team · mint one scoped virtual key per (member, gateway-capable harness) · fund those keys from the org's LLM credit ledger (signup grants, top-ups) and fail closed when the ledger is empty · import spend idempotently and attribute it · verify observed model access against the declared config.

**Fences:**

| Not owned here | Owner | The line |
| --- | --- | --- |
| Which credential a harness launches with, delivery, application, seats | [agent_auth](../agent_auth/README.md) | this system hands agent_auth an opaque key + base URL and a budget predicate; agent_auth renders and refuses in plain words |
| Compute billing, plans, segments, Stripe relationship | billing | top-ups charge *through* billing; the LLM ledger is this system's |
| Which models a target *advertises* | harnesses ([models.md](../agent_auth/models.md)) | the gateway's model list is observed through the harness before any surface may offer it |
| Company-systems gateway (MCP tools) | integration_gateway | the analogous gateway for tools, not models |

**Rules of the road:**

- **Organizations are the only gateway and billing subject.** One LiteLLM team per org, one LiteLLM user per (org, member); a personal experience is a one-member default org, never a separate payer.
- **Unfunded fails closed.** Zero credit withholds key material; the launch refusal (agent_auth's, in plain words) names the reason.
- **Master credentials never leave the server.** Clients, workers, and machines receive only scoped keys through agent_auth's delivery.
- **Proxy-side enforcement, never client-side filtering.** A key's access group is what limits its models; no UI filter substitutes.

## 1 · Cells

### the control plane (`server/agent_auth/` gateway files, splitting out)

- **Owns:** the five tables below, the enrollment/key lifecycle, the ledger, the importer, verification, and the four background loops.
- **Doors:**
    - `GET /v1/cloud/agent-gateway/capabilities` — is the gateway enabled, which harnesses may take a gateway source. The settings pane and onboarding read it.
    - `GET /v1/cloud/agent-gateway/enrollment` — the caller's sync/budget status, for the settings surface.
    - `ensure_signup_enrollment` / `ensure_org_enrollment` — accounts and organizations call these after commit via `signup_hook.py`; durable row first, LiteLLM shape second, failure marks `failed` for the backfill. Never raises into an auth flow.
    - `is_gateway_budget_available` — the launch-gating predicate; agent_auth's renderer consults it and withholds gateway sources when false.
    - `gateway_profile` (the minted key + base URL for a harness) — consumed by agent_auth's renderer as an opaque value.
    - `create_llm_topup_grant` — billing calls it when a top-up invoice is paid; records the grant and reactivates what it re-funds.
    - `get_remaining_credit_usd`, `llm_cost_usd_timeseries` and siblings — read-only ledger projections for the billing usage API.
- **Consumes:** `integrations/litellm` (admin + spend-log client under the master key) · billing (Stripe charge for top-ups; the `free_cloud_allocation` anti-abuse guard) · organizations (membership rows drive the backfill) · the `agent_gateway_*` settings in config.py.

### the data plane (`server/litellm/`)

- **Owns:** the LiteLLM instance's reviewed configuration — model names, upstream providers, `model_info.access_groups` — and its image. The instance sits in the request path (harness → LiteLLM → provider); LLM traffic never touches the Python server.
- **Doors:** the proxy URL itself, and `GET /v1/models` scoped by each key's access group; out-of-group inference is denied proxy-side.
- **Consumes:** upstream provider credentials (deployment-owned, e.g. the deployment's AWS role for Bedrock models).

### `ai_magic` — the control plane's own inference consumer

Three direct endpoints today; routes through the gateway once per-run keys exist (open ruling, PR #2247 discussion).

## 2 · Data

The five tables, one row meaning each (full DDL rides the code split; column detail in [db/models/agent_gateway.py](../../../server/proliferate/db/models/agent_gateway.py)):

| Table | One row is | Load-bearing invariants |
| --- | --- | --- |
| `agent_gateway_enrollment` | one (org, member) in the org's LiteLLM team: `subject_kind`, `billing_subject_id`, `litellm_team_id`, `litellm_user_id`, `sync_status ∈ {pending, synced, failed}`, `budget_status ∈ {ok, exhausted, limit_reached}` | the team is the only budget layer; the row never carries `max_budget` |
| `agent_gateway_enrollment_key` | one access-group-scoped virtual key per (enrollment, gateway-capable harness): alias, token hash, `verification_status` | alias is deterministic per (enrollment, harness), so re-minting is idempotent |
| `agent_llm_usage_event` | one imported LiteLLM spend-log row, keyed by unique `litellm_request_id`, attributed to enrollment / billing subject / harness / model | idempotent insert |
| `llm_credit_grant` | one credit-side ledger entry (`amount_usd`): signup free credit or a purchased top-up | remaining credit = active grants − imported usage cost |
| `agent_llm_usage_import_cursor` | the single-row importer cursor | advances only after the batch commits |

Also owned: [config.yaml](../../../server/litellm/config.yaml) — the reviewed source of truth for model names, providers, and access groups; unknown model names fail, cross-provider aliases are forbidden (they silently change semantics), and every model carries the harness access group allowed to invoke it.

## 3 · Flows

**Flow 1 — Enrollment.** Signup or org-membership change → `signup_hook` schedules after commit → durable enrollment row (`pending`) → LiteLLM team/user/keys provisioned → `synced`; any LiteLLM failure marks `failed` and the backfill loop retries on its interval. `migration.py` converges pre-org residue first on every tick. Account creation never waits on LiteLLM — enrollment is fire-and-forget, and agent_auth re-renders when sync completes.

**Flow 2 — Key mint.** One virtual key per (member, gateway-capable harness), alias-deterministic, access-group-scoped (`_sync_one_harness_key`). The key reaches a machine only inside agent_auth's rendered document; this system never delivers.

**Flow 3 — Funding and exhaustion.** Remaining credit = grants − imported cost, mirrored onto the LiteLLM team budget. Zero remaining: keys disabled, `budget_status=exhausted`, `is_gateway_budget_available` turns false, agent_auth withholds gateway sources at render and refuses launches with the reason. A top-up (Stripe, through billing) records a grant and reactivates. Org caps produce `limit_reached` the same way; the next import tick after a raise reactivates.

**Flow 4 — Usage import.** The importer reads spend logs from `last_seen − overlap`, inserts by unique request id (idempotent across restarts), applies margin, attributes to (subject, harness, model), and enforces exhaustion + org caps as it goes.

**Flow 5 — Verification.** On its interval (default-off today), diff each key's *observed* model list against the declared access group; a mismatch marks `verification_status=misconfigured` with the delta — the fix is config.yaml + redeploy, never a client-side patch.

## 4 · Structure

```text
server/proliferate/
├── constants/agent_gateway.py                  gateway-capable harness tuple (shared with agent_auth)
├── db/models/agent_gateway.py                  the five gateway tables (+ agent_auth's)
├── db/store/agent_gateway/
│   ├── enrollments.py · enrollment_keys.py     row CRUD, key hashes
│   ├── credits.py                              grants, ledger moves, remaining credit
│   ├── usage.py                                idempotent usage insert, cursor, cost projections
│   └── records.py · mappers.py                 record types
├── integrations/litellm/                       vendor leaf: admin + spend-log client
├── server/agent_auth/                          ⇒ server/ai_gateway/ (the code split)
│   ├── signup_hook.py                          after-commit enrollment scheduling
│   ├── enrollment.py                           team/user/key provisioning, drift reopen, backfill
│   ├── migration.py                            pre-org-only residue converger (first each tick)
│   ├── free_credits.py                         signup grant, GitHub-identity dedup
│   ├── budget.py                               the launch-gating predicate
│   ├── usage_import.py                         spend-log importer, margin, exhaustion + org caps
│   ├── topups.py                               Stripe top-up, grant, reactivation
│   ├── verification.py                         observed-vs-declared access-group diff
│   ├── worker.py                               the four background loops (started in main.py)
│   ├── api.py                                  gateway_account_router (co-hosted with agent_auth's)
│   ├── service.py                              get_capabilities / get_enrollment
│   └── models.py                               AgentGatewayCapabilitiesResponse, AgentGatewayEnrollmentResponse
└── server/ai_magic/                            control-plane inference consumer

server/litellm/config.yaml · Dockerfile         the data plane: models, providers, access groups
cloud/sdk/src/client/agent-gateway.ts           SDK client
```

Settings (config.py `agent_gateway_*`): enabled flag, LiteLLM base URLs + master key, default org budget, free credit amount, margin percent, importer/verification/top-up intervals and thresholds, top-up price id, policy minimum plan.

Proof: the unit and integration suites named per concern — enrollment, usage import, top-ups, litellm integration, config access groups (the reviewed config.yaml is pinned by `test_litellm_config_access_groups.py`), key lifecycle, migration, verification, org-member gateway, LLM limit enforcement — under `server/tests/{unit,integration}/test_agent_gateway_*` and siblings.

Failure modes: LiteLLM unreachable at enrollment → `sync_status=failed`, backfill retries · out of credit → keys disabled, exhausted, typed launch refusal, top-up reactivates · org cap → `limit_reached`, raise + next tick reactivates · key sees wrong models → `misconfigured` with delta, fix config.yaml · importer restart mid-batch → nothing, the overlap window + unique id absorb it.

---

## Delta vs prod

*Transitional — deleted at convergence.*

| This spec says | Prod today | The change |
| --- | --- | --- |
| Its own folder `server/ai_gateway/` with its own MANIFEST | Gateway files co-resident in `server/agent_auth/`; one manifest claims both systems | The code split (on the agent_auth build list) |
| A signup grant funds every new org | The grant can silently never run: the founder org had no allocation row at all from creation to 2026-08-26 (cause in the signup path, unfound; fixed with a $25 admin grant) | Find the signup-hook miss; alert on orgs with zero grants after signup |
| Verification runs | `agent_gateway_verification_enabled=false` | Enable once config.yaml settles |
| Per-run virtual keys with envelope budgets | Keys are per (member, harness); budgets are org team + member cap | Open ruling (PR #2247 discussion): mint per run at placement — the only shape where the proxy hard-stops a runaway fan-out mid-run |
| `ai_magic` routes through the gateway | Three direct endpoints, spend unattributed | After per-run keys (open ruling) |

## Build list

- [ ] Code split into `server/ai_gateway/` + manifest + recompose (with agent_auth's build list)
- [ ] The blocked-signup-grant repair path (delta row 2) — also the live founder-org fix
- [ ] Enable verification once config.yaml settles
- [ ] Per-run keys + envelopes (pending the ruling) · then ai_magic through the gateway
