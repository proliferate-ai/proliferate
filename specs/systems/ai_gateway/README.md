# AI gateway

Grade B system spec (code-verified on `main`, decisions marked; formerly `agent_auth/model-gateway.md` — split into its own system 2026-08-26; the code split out of `server/agent_auth/` rides the agent_auth build list). Owns all agent LLM traffic that Proliferate pays for or meters: the LiteLLM data plane, the enrollment that mints scoped virtual keys, the credit ledger that funds them, usage import, exhaustion enforcement, top-ups, and configuration verification. The harness remains the execution client; this system decides *whether* and *under whose budget* it may call a model.

Sibling specs, one owner per concern: [agent_auth](../agent_auth/README.md) picks *which* credential a harness launches with and delivers it; [integration_gateway](../integration_gateway/README.md) is the analogous gateway for company systems (MCP tools), not models; [billing](../billing/deep-dive.md) owns compute segments, plans, credits for compute, and the Stripe relationship; [harness launch options](../agent_auth/models.md) owns which models a target *advertises* — the gateway's model list is observed through the harness before any surface may offer it.

## 1. Purpose

A deployment can pay for and control inference on behalf of every organization member without any client, worker, or sandbox ever holding a provider credential. The outcome in one sentence: **every gateway request is made with a per-(org member, harness) virtual key whose access group limits the models it can see, whose team budget mirrors the org's remaining LLM credit, and whose spend is imported back into that org's ledger; unfunded means no key.**

## 2. Owned state

Only this system writes these rows ([db/models/agent_gateway.py](../../../server/proliferate/db/models/agent_gateway.py)):

| Table | Row meaning | Notable invariants |
| --- | --- | --- |
| `agent_gateway_enrollment` | One (org, member) enrolled into the org's LiteLLM team. `subject_kind`, `billing_subject_id`, `litellm_team_id`, `litellm_user_id`, `sync_status ∈ {pending, synced, failed}`, `budget_status ∈ {ok, exhausted, limit_reached}`. | Check constraints pin both status vocabularies. The team is the only budget layer; the row never carries `max_budget`. |
| `agent_gateway_enrollment_key` | One access-group-scoped virtual key per (enrollment, gateway-capable harness), with alias, token hash, `verification_status`. | Alias is deterministic per (enrollment, harness) so re-minting is idempotent. |
| `agent_llm_usage_event` | One imported LiteLLM spend-log row, keyed by `litellm_request_id` (unique), attributed to enrollment / billing subject / harness / model. | Idempotent insert; status `imported`. |
| `llm_credit_grant` | One credit-side ledger entry (`amount_usd`) on a billing subject: signup free credit or a purchased top-up. | Remaining credit = active grants − imported usage cost. |
| `agent_llm_usage_import_cursor` | Single-row poll cursor for the spend-log importer. | Advances only after the batch commits. |

Also owned: the data-plane configuration [server/litellm/config.yaml](../../../server/litellm/config.yaml) and its image [Dockerfile](../../../server/litellm/Dockerfile) — the reviewed source of truth for model names, upstream providers, and `model_info.access_groups`.

Not owned (agent_auth's rows, same package today): `agent_api_key`, `agent_auth_selection`, `agent_auth_delivery_ack`, `agent_auth_harness_settings`, `org_agent_policy`.

## 3. Public surface

HTTP, mounted under `/v1/cloud/agent-gateway` by `cloud/api.py` from [agent_auth/api.py](../../../server/proliferate/server/agent_auth/api.py) (`gateway_account_router`):

| Route | Serves |
| --- | --- |
| `GET /v1/cloud/agent-gateway/capabilities` | Whether the gateway is enabled for this deployment and which harnesses may take a gateway source. |
| `GET /v1/cloud/agent-gateway/enrollment` | The caller's enrollment (sync/budget status) for the settings surface. |

Python, the only functions other systems may call:

| Function | Caller | Contract |
| --- | --- | --- |
| [`ensure_signup_enrollment`](../../../server/proliferate/server/agent_auth/enrollment.py), [`ensure_org_enrollment`](../../../server/proliferate/server/agent_auth/enrollment.py) | accounts / organizations, via [`signup_hook.py`](../../../server/proliferate/server/agent_auth/signup_hook.py) after commit | Durable row first (idempotent), LiteLLM shape second, failure marks `failed` for the backfill. Never raises into an auth flow. |
| [`is_gateway_budget_available`](../../../server/proliferate/server/agent_auth/budget.py) | agent_auth's renderer, at launch | The launch-gating predicate: a gateway source materializes only when this is true. |
| [`create_llm_topup_grant`](../../../server/proliferate/server/agent_auth/topups.py) | billing (Stripe invoice paid) | Records the grant and reactivates anything it re-funds. |
| [`get_remaining_credit_usd`](../../../server/proliferate/db/store/agent_gateway/credits.py), [`llm_cost_usd_timeseries`](../../../server/proliferate/db/store/agent_gateway/usage.py) and siblings | billing usage API | Read-only ledger projections. |
| `start_/stop_agent_gateway_*` in [worker.py](../../../server/proliferate/server/agent_auth/worker.py) | [main.py](../../../server/proliferate/main.py) lifespan | Four loops: enrollment backfill, usage import, verification, top-ups. |

SDK: [cloud/sdk/src/client/agent-gateway.ts](../../../cloud/sdk/src/client/agent-gateway.ts).

## 4. Consumes

- [integrations/litellm](../../../server/proliferate/integrations/litellm/client.py)
  — the vendor leaf: team/user/key admin API and spend-log reads under the
  master key.
- Settings `agent_gateway_*` in [config.py](../../../server/proliferate/config.py):
  enabled flag, LiteLLM base URLs and master key, default org budget, free
  credit, margin percent, importer/verification/top-up intervals and
  thresholds, top-up Stripe price id, policy minimum plan.
- billing: the Stripe charge for a top-up
  ([`_charge_llm_topup`](../../../server/proliferate/server/agent_auth/topups.py))
  and the `free_cloud_allocation` anti-abuse guard consumed by
  [free_credits.py](../../../server/proliferate/server/agent_auth/free_credits.py).
- organizations: active membership rows are what the backfill enrolls.

## 5. Laws

**Organizations are the only gateway and billing subject.** One LiteLLM team per org (`org-<uuid>`), one LiteLLM user per (org, member) (`org-<org>-user-<uuid>`), never one global user spanning orgs. A personal experience is a one-member default org, not a separate payer. Closes: a client-supplied user-only key selecting a different payer. Enforced in [enrollment.py](../../../server/proliferate/server/agent_auth/enrollment.py); pre-cut residue is converged by [migration.py](../../../server/proliferate/server/agent_auth/migration.py) on every backfill tick, never inline in alembic.

**One virtual key per (member, gateway-capable harness), scoped to that harness's access group.** `GET /v1/models` through that key returns only its group; out-of-group inference is denied proxy-side. Closes: a harness seeing a model it cannot bill for. Enforced by the key mint in [`_sync_one_harness_key`](../../../server/proliferate/server/agent_auth/enrollment.py) and the access groups in [config.yaml](../../../server/litellm/config.yaml). Which harnesses are gateway-capable is the constant tuple in [constants/agent_gateway.py](../../../server/proliferate/constants/agent_gateway.py), consumed by agent_auth's selection rules.

**Unfunded fails closed.** The team budget mirrors remaining credit ([`_remaining_credit_budget_raw`](../../../server/proliferate/server/agent_auth/enrollment.py)); zero credit withholds key material and [`is_gateway_budget_available`](../../../server/proliferate/server/agent_auth/budget.py) refuses the launch with a typed reason rather than letting the harness run on different credentials. Closes: silent fallback to native credentials.

**Usage import is idempotent and cursor-driven.** Each importer tick reads LiteLLM spend logs from `last_seen − overlap`, inserts by `litellm_request_id` once, marks up provider spend by the configured margin ([`apply_llm_margin`](../../../server/proliferate/server/agent_auth/usage_import.py)), and advances the cursor only after commit. Closes: double-billing on importer restart.

**Exhaustion disables keys; credit reactivates them.** When a subject's imported cost reaches its grants, [`_enforce_subject_exhaustion`](../../../server/proliferate/server/agent_auth/usage_import.py) disables every child key and flips `budget_status=exhausted`; an org LLM cap does the same as `limit_reached`. A top-up grant ([topups.py](../../../server/proliferate/server/agent_auth/topups.py)) re-mints or unblocks the keys and rewrites the team budget. Closes: a spent org continuing to accrue provider cost.

**Master credentials never leave the server.** Product clients and workers receive only a scoped virtual key, and only through agent_auth's materialization path. Closes: master-key exfiltration via a sandbox.

**Verification never overwrites a last-known-good on error.** The verification loop ([verification.py](../../../server/proliferate/server/agent_auth/verification.py)) diffs each key's observed model set against the access group declared in `config.yaml`; a transient LiteLLM error records no verdict. Closes: a blip flapping the settings surface to "misconfigured".

**Free credit is one grant per human, ever.** Deduped through `free_cloud_allocation` on the linked GitHub identity; a joining member never brings a grant into another org. Closes: invite-farming for credit.

## 6. Emits

- Enrollment capability and status (`/capabilities`, `/enrollment`,
  [`get_capabilities`](../../../server/proliferate/server/agent_auth/service.py))
  — consumed by agent_auth to decide whether a `gateway` source is legal and
  by the settings pane's evidence view.
- The LLM ledger (grants, usage events, remaining credit) — consumed by
  billing's usage API and invoices.
- Spend attribution on every minted key
  ([`enrollment_key_metadata`](../../../server/proliferate/server/agent_auth/enrollment.py)):
  enrollment, subject, harness — the tags usage import resolves back.

## 7. Fences

- Selections, the key vault, `state.json` delivery, per-harness application
  and org agent-model policy: [agent_auth](../agent_auth/README.md).
  This spec consumes the gateway-capable harness list; it never filters models
  client-side.
- Compute segments, plans, Stripe customers, compute credits:
  [billing](../billing/deep-dive.md). Top-ups charge *through* billing.
- Which models a harness advertises and session live configuration:
  [MODELS.md](../agent_auth/models.md).
- Registry auth vocabulary and readiness projection:
  [agent-distribution.md](../harnesses/distribution.md).

### Control-plane inference (`ai_magic`) — a section, not a system

[server/ai_magic](../../../server/proliferate/server/ai_magic/service.py) serves three prompted conveniences (`POST /v1/ai_magic/session-titles/generate`, `/workspace-names/generate`, `/commit-messages/generate`) with rate limits from [constants/ai_magic.py](../../../server/proliferate/constants/ai_magic.py). It owns no durable state and calls [integrations/anthropic.py](../../../server/proliferate/integrations/anthropic.py) directly, bypassing the gateway — so its spend is deployment-paid and unattributed. It fails the granularity test (no owned state, no laws of its own) and is therefore fenced here as the gateway's control-plane consumer.

> [!decision] PABLO DECIDES: route `ai_magic` through the gateway (a
> deployment-owned virtual key, spend attributed to the org that asked) or
> keep it as direct, deployment-paid Anthropic calls. Recommendation: route
> through the gateway once per-run keys exist (below) so every LLM dollar has
> one ledger; until then leave it direct — it is three small endpoints.

## 8. Code map

The gateway lives inside the `agent_auth` package today (one MANIFEST, one folder, two specs). Ordered by the path a credit travels:

```text
server/proliferate/
├── constants/agent_gateway.py                  gateway-capable harness tuple, key kinds (shared with agent_auth)
├── db/models/agent_gateway.py                  five gateway tables (+ agent_auth's four)
├── db/store/agent_gateway/
│   ├── enrollments.py · enrollment_keys.py     row CRUD, key hashes
│   ├── credits.py                              grants, ledger moves, remaining credit
│   ├── usage.py                                idempotent usage insert, cursor, cost projections
│   └── records.py · mappers.py                 record types
├── integrations/litellm/                       vendor leaf: admin + spend-log client
├── server/agent_auth/
│   ├── signup_hook.py                          after-commit enrollment scheduling (accounts/orgs call this)
│   ├── enrollment.py                           team/user/key provisioning, drift reopen, backfill
│   ├── migration.py                            pre-org-only residue converger (runs first each tick)
│   ├── free_credits.py                         signup grant, GitHub-identity dedup
│   ├── budget.py                               launch-gating predicate
│   ├── usage_import.py                         spend-log importer, margin, exhaustion + org caps
│   ├── topups.py                               Stripe top-up, grant, reactivation
│   ├── verification.py                         observed-vs-declared access-group diff
│   ├── worker.py                               the four background loops (started in main.py)
│   ├── api.py                                  gateway_account_router (+ agent_auth's routers)
│   ├── service.py                              get_capabilities / get_enrollment (+ agent_auth service)
│   └── models.py                               AgentGatewayCapabilitiesResponse, AgentGatewayEnrollmentResponse
└── server/ai_magic/                            control-plane inference consumer (section above)

server/litellm/config.yaml · Dockerfile         the data plane: models, providers, access groups
cloud/sdk/src/client/agent-gateway.ts           SDK client
```

> [!decision] PABLO DECIDES: split `server/agent_auth/` into `agent_auth/`
> and `model_gateway/` folders (each with its own MANIFEST and one spec) in
> sweep Wave 2, or keep one folder with two specs. Recommendation: split —
> the seam is already drawn file-by-file above, the stores are already
> separate modules, and rule 2 ("every system folder carries a MANIFEST")
> currently makes `agent_auth`'s manifest claim both systems.

> [!decision] PABLO DECIDES: per-run virtual keys and budget envelopes
> (Core Architecture §9 deltas) — the run primitive asks this system to mint a
> key scoped to (org, run) with the run's envelope as its budget, and spend
> imports tagged (class, workflow, run, subject). Options: (a) mint per run
> at placement and delete at terminal; (b) mint per (member, harness) as
> today and enforce envelopes only at import time. Recommendation: (a) — it
> is the only shape where the proxy hard-stops a runaway subagent fan-out
> mid-run, and key mint/delete is already idempotent by alias.

## 9. Proof

Unit: [test_agent_gateway_enrollment.py](../../../server/tests/unit/test_agent_gateway_enrollment.py), [test_agent_gateway_usage_import.py](../../../server/tests/unit/test_agent_gateway_usage_import.py), [test_agent_gateway_topups.py](../../../server/tests/unit/test_agent_gateway_topups.py), [test_litellm_integration.py](../../../server/tests/unit/test_litellm_integration.py), [test_litellm_config_access_groups.py](../../../server/tests/unit/test_litellm_config_access_groups.py) (the reviewed `config.yaml` is pinned here).

Integration: [test_agent_gateway_enrollment.py](../../../server/tests/integration/test_agent_gateway_enrollment.py), [test_agent_gateway_enrollment_keys.py](../../../server/tests/integration/test_agent_gateway_enrollment_keys.py), [test_agent_gateway_key_lifecycle.py](../../../server/tests/integration/test_agent_gateway_key_lifecycle.py), [test_agent_gateway_migration.py](../../../server/tests/integration/test_agent_gateway_migration.py), [test_agent_gateway_usage_credits.py](../../../server/tests/integration/test_agent_gateway_usage_credits.py), [test_agent_gateway_topups.py](../../../server/tests/integration/test_agent_gateway_topups.py), [test_agent_gateway_topup_fixes.py](../../../server/tests/integration/test_agent_gateway_topup_fixes.py), [test_agent_gateway_verification.py](../../../server/tests/integration/test_agent_gateway_verification.py), [test_agent_auth_org_member_gateway.py](../../../server/tests/integration/test_agent_auth_org_member_gateway.py), [test_billing_limit_enforcement_llm.py](../../../server/tests/integration/test_billing_limit_enforcement_llm.py).

## Failure modes

| Condition | Observable | Recovery |
| --- | --- | --- |
| LiteLLM unreachable at enrollment | row `sync_status=failed` | backfill loop retries every `agent_gateway_backfill_interval_seconds` |
| Subject out of credit | keys disabled, `budget_status=exhausted`, launch refused with typed reason | top-up (auto if `agent_gateway_llm_topup_price_id` set and threshold crossed) |
| Org LLM cap hit | `budget_status=limit_reached` | admin raises the cap; next import tick reactivates |
| Key sees wrong models | `verification_status=misconfigured` with delta | fix `config.yaml`, redeploy proxy |
| Importer restart mid-batch | none — overlap window + unique request id | automatic |

## Known gaps / follow-ups

- Folder split (decision above); the AGENT_AUTH.md gap list already carries
  the same "module split" item from the URL-prefix split.
- Per-run keys and envelopes do not exist; budgets today are per org team and
  per member cap only.
- `ai_magic` spend is unattributed (decision above).
- Verification is default-off (`agent_gateway_verification_enabled=false`).
