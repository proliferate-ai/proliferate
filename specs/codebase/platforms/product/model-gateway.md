# Model Gateway

Status: target. This document describes the accepted destination for the
model gateway. The body is written in the ideal state. Every difference from
`main` today is listed in [Current gaps](#current-gaps); the list shrinks as
follow-up PRs land, and the label comes off when it is empty.

## Purpose

The model gateway gives harnesses access to a set of models whose inference
is paid for and controlled by whoever deploys Proliferate. It is a hosted
[LiteLLM Proxy](https://docs.litellm.ai/docs/simple_proxy) instance with a
custom model list. Proliferate's server is the gateway's control plane
(enrollment, keys, budgets, usage import) and is never in the inference
data path.

The gateway is one of the auth sources a user can select for a harness.
Which source a harness uses, `state.json` materialization, and fail-closed
launch behavior all belong to the agent-auth platform, not this document.

## The artifact

The gateway is defined by two files in `server/litellm/`:

- `config.yaml`: the model list, in LiteLLM's
  [proxy config format](https://docs.litellm.ai/docs/proxy/configs)
  (`model_list` entries with `model_name`, `litellm_params`, and
  `os.environ/<VAR>` key references). The single source of truth for which
  models exist, which upstream provider serves each, and which access
  groups each belongs to. Dev and prod both run this exact file.
- `Dockerfile`: layers `config.yaml` onto the pinned upstream LiteLLM
  image for deployed environments.

Config laws, enforced by review (the file's comments restate them):

- The model list is explicit. Unknown model names return 400 from the
  proxy, so every name a harness may pin (including dated ids like
  `claude-sonnet-4-5-20250929`) needs its own `model_name` entry.
- Aliases stay within one provider. A `model_name` may re-point to a
  cheaper or newer upstream id only when the same provider serves both; a
  cross-provider alias silently swaps the model a harness thinks it is
  talking to.
- Upstream ids are verified against the pinned LiteLLM version's model
  manifest, never invented. The manifest also prices spend for usage
  import; an unknown id can pass traffic while mispricing it.
- Every entry carries `model_info: {access_groups: [...]}` naming the
  harness group(s) it belongs to (`claude-code`, `codex`, `opencode`,
  `cursor`, `grok-cli`); see LiteLLM's
  [model access groups](https://docs.litellm.ai/docs/proxy/model_access_groups).
  This one reviewed file is therefore also the harness-to-model map; no
  client-side model filtering exists anywhere.
- No dev shims. Because dev and prod run this exact file, any local
  convenience placed in it ships to production verbatim. Two shims are
  banned by name:
  - [`mock_response`](https://docs.litellm.ai/docs/completion/mock_requests):
    a LiteLLM per-model setting (`litellm_params: {mock_response: "..."}`)
    that makes the proxy return that hardcoded string as the completion
    without calling any provider. Useful locally to test wiring with no
    API key; in production it would silently serve fake completions while
    everything looks healthy.
  - Cross-provider test aliases: pointing one provider's `model_name` at
    another provider's upstream so a harness "works" in dev without that
    provider's key. This happened: before PR #906, `grok-4` resolved to an
    Anthropic Haiku model because dev had no xAI key, so a user selecting
    grok was actually talking to Claude.
  If a dev setup needs either, it goes in a docker-compose override file
  that only dev loads (a second `-f` compose file replacing the mounted
  config); none is checked in today.

## Deployment

The same two files are consumed differently locally and deployed. The
asymmetry is intentional:

| | Local (`make server-litellm-up`) | Deployed (ECS) |
| --- | --- | --- |
| Image | Upstream `ghcr.io/berriai/litellm` as-is | Our image (upstream plus `COPY config.yaml`), built by `_deploy-litellm.yml`, pushed to ECR `proliferate-litellm` |
| Config | Bind-mounted read-only from the checkout: edit, restart, no build | Baked into the image, so the ECR digest is the reviewed config and rollback is the previous image |
| Secrets | Shell env via docker-compose passthrough | GitHub environment secrets to SSM SecureStrings to task-definition `valueFrom` (see below) |
| Database | `litellm-db` compose sidecar (postgres, local volume) | External database via `LITELLM_DATABASE_URL`, never part of any image |
| Updates | On file save | `deploy-staging.yml` change-detects `server/litellm/**`; prod follows the normal promote flow |

### Image pin

The upstream image is pinned as `vX.Y.Z@sha256:...`. The digest makes
builds reproducible (tags can be re-pointed), and the tag keeps the
reviewed version visible. `scripts/ci-cd/litellm-image-pin.test.mjs`
asserts the Dockerfile and `server/docker-compose.yml` carry the identical
pin and fails any bump that skips review. Bumping the pin is the
highest-risk gateway change, since it swaps the code serving all inference
and the pricing manifest; the procedure is in
[gateway-models.md](../../../developing/operating/gateway-models.md).

### Secrets

The deploy workflow is the only writer. Nothing is ever set by hand on ECS
or SSM. Source of truth is the GitHub environment secret
(`AGENT_GATEWAY_MANAGED_<PROVIDER>_API_KEY`, `LITELLM_MASTER_KEY`,
`LITELLM_DATABASE_URL`). Every deploy re-pushes all of them to SSM under
`/proliferate/{env}/litellm/*` and re-renders the task definition, so a
hand-edit survives only until the next deploy and then silently reverts.
Rotation is therefore "update the GitHub secret, rerun the deploy" and
nothing else. The `MANAGED` prefix distinguishes our inference-spend keys
from users' BYOK keys (agent-auth's vault). Bedrock is the exception: no
key in cloud (the ECS task role carries
`proliferate-gateway-bedrock-invoke`), optional `GATEWAY_AWS_*` env vars
locally.

### Database

The proxy's Postgres holds its state: virtual keys, teams, budgets, spend
logs. It is why key issuance survives restarts and why the proxy is not a
freely-recreatable stateless container.

## Account model

One LiteLLM [team](https://docs.litellm.ai/docs/proxy/users) per billing
subject; the budget lives on the team and mirrors the subject's remaining
credit. Inside the team, one
[virtual key](https://docs.litellm.ai/docs/proxy/virtual_keys) per
(subject, harness), each granted its harness's access group by name
(`{"models": ["claude-code"]}` at `/key/generate`). The key is the whole
differentiator: one deployment, one public URL, and what a key can see and
invoke is determined proxy-side by its group grant and team budget.

- `GET /v1/models` with a harness key returns only that harness's models,
  so discovery-based CLIs (grok) see the right list with no client logic.
- Invoking an out-of-group model returns 403 `key_model_access_denied`.
- Spend from every key in the team aggregates against the team budget.
  LiteLLM can enforce further
  [budget layers](https://docs.litellm.ai/docs/proxy/users)
  (key, user, team member) simultaneously; only the team layer is used
  here. When org-wide gateway access arrives (parked until team-wide
  automations), the expected shape is one team per Proliferate org with
  per-member keys; whether members get individual caps (LiteLLM
  team-member budgets, open-source) is unruled. LiteLLM's organizations
  entity above teams is enterprise-licensed and not assumed here.
- Per-harness spend attribution falls out of per-key spend rows for free.

### Billing integration

The gateway does not meter spend; the billing platform's LLM credit ledger
does ([billing.md](billing.md) owns grants and Stripe). The invariant
behind the division of labor: the ledger is the meter, the LiteLLM budget
is a mirror, and disabling the virtual key is the enforcement act.

Each LiteLLM layer owns exactly one concern, and money never attaches to
keys:

| LiteLLM entity | Maps to | Owns |
| --- | --- | --- |
| team | billing subject | money: pooled budget mirror, overage-uncapped mode, reactivation |
| user | the person | per-member caps within a team, when org billing needs them |
| key | (subject, harness) | access: group grant and per-harness spend attribution; never a budget |

Two consequences billing can rely on:

- The gateway's primitives to billing are subject-level: enroll, set
  budget, disable, reactivate — each fanning out to the subject's N keys
  internally. Billing code never counts keys, so key granularity can
  change without touching billing.
- Per-member caps, if org billing adopts them, are LiteLLM team-member
  budgets scoped to the org team — not LiteLLM user-level budgets. The
  same LiteLLM user spans a member's personal team and org team, so a
  user-level budget would wrongly bind personal spend against an org cap.
  Org enrollment already mints each member's key under their own LiteLLM
  user for attribution, so adding a member cap later is one API call, not
  a re-enrollment.

- The credit ledger on the billing subject is authoritative: grants (free
  credits, top-ups) minus imported spend debits.
- The usage importer pages the proxy's `/spend/logs`, resolves each row's
  virtual key back to an enrollment and billing subject, and writes
  deduped debit rows. After importing it reconciles every affected
  subject: at zero remaining credit it disables the subject's virtual
  keys and marks the enrollment exhausted, so gateway launches fail
  closed. Re-enabling happens the same way in reverse when credit
  returns.
- The LiteLLM team budget mirrors the ledger; it is a backstop against
  importer lag, not the meter. Capped subjects get their remaining credit
  as the team budget, floored at a small positive value when exhausted
  (LiteLLM reads a budget of 0 as uncapped). Subjects with no credit
  grants run against a configured default budget; for them the mirror is
  the only cap.
- Overage-enabled subjects get no proxy budget at all: the proxy is
  uncapped for them, and the guardrail is the ledger plus the top-up
  loop. When such a subject drops below the top-up threshold, a Stripe
  charge lands as a new credit grant and reactivates the enrollment
  (keys unblocked, budgets raised).

Enrollment is the idempotent provisioning of this shape for one subject:
ensure the team (with budget), the LiteLLM user, and the per-harness keys;
encrypt the raw keys (Fernet) on the enrollment row; track a sync status.
Virtual keys have no user-facing CRUD anywhere; they exist only through
enrollment and surface only inside rendered `state.json`. Free-credit
grants run before sync so the LiteLLM budget mirrors the resulting balance.

## Control plane vs data plane

Two base URLs in server config, one per plane:

- `agent_gateway_litellm_base_url`: private control-plane address. Only our
  server calls it, only with the master key, to mint and rotate keys,
  update team budgets, and import spend.
- `agent_gateway_litellm_public_base_url`: data-plane address handed to
  harnesses via `state.json`. A harness in a sandbox calls it directly with
  its virtual key; the proxy checks key, group, and team budget, then
  forwards upstream with our provider key. No inference byte touches
  `api.proliferate.com`.

```text
control plane (session setup):   server ──master key──► LiteLLM admin API
data plane (every request):      harness ──virtual key──► LiteLLM ──► provider
```

## API surface

`/v1/cloud/agent-gateway/` owns exactly the gateway-account relationship:

- `GET /enrollment`: the subject's provisioning state (team, keys, sync
  status).
- `GET /capabilities`: deployment-level discovery. `gateway_enabled`
  (self-hosts may run no gateway), `public_base_url`, and enrollment
  status; the settings UI reads this to decide whether to offer the
  gateway as an auth option.

Nothing else. BYOK key vault, auth selections, `state.json`, and org policy
are `/v1/cloud/agent-auth/` (agent-auth platform); per-user probed model
snapshots are the model-catalog platform. Renames are hard cutovers with no
alias windows: all consumers are first-party (pre-launch ruling).

## Code map

| Layer | Path | Owns |
| --- | --- | --- |
| Artifact | `server/litellm/` | config.yaml + Dockerfile; what the proxy serves |
| Integration client | `server/proliferate/integrations/litellm/` | Raw HTTP client for the proxy admin API (keys, teams, spend). The only code that talks to the proxy. |
| Gateway account | `server/proliferate/server/cloud/agent_gateway/` | Enrollment, budgets, top-ups, free credits, usage import, signup hook. The account subset only: auth selections and model snapshots belong to their own platforms. |

Deploy pipeline: `.github/workflows/_deploy-litellm.yml` (build, secret
push, task-def render), gated per environment by `deploy-staging.yml`
change detection and the promote flow.

## Failure modes

- Out-of-group model: 403 `key_model_access_denied` from the proxy.
- Unknown model name: 400 from the proxy (explicit-list law).
- Exhausted team budget: the proxy rejects. The subject's remaining-credit
  mirror floors at a near-zero cap rather than 0, which LiteLLM would read
  as uncapped.
- Enrollment sync failure: the enrollment row carries the error state. Key
  minting is idempotent per deterministic alias; orphaned keys from a
  crash are purged and re-minted.
- Gateway not deployed (`gateway_enabled` false): the gateway auth option
  is not offered and nothing fails at session start.

## Proof

- `scripts/ci-cd/litellm-image-pin.test.mjs`: pin consistency (CI).
- Gateway smoke (`scripts/agent-gateway-smoke/`): end-to-end reachability
  per harness.
- Scoped-key verification: mint a key granted one group, assert
  `GET /v1/models` returns exactly that group and an out-of-group invoke
  403s. Verified live against the pinned image (v1.93.0, 2026-07-24).

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] `config.yaml` entries carry no `access_groups` tags.
- [ ] Enrollment mints one unscoped key per subject (it sees all models)
      instead of per-harness group-scoped keys; existing enrollments need
      rotation at migration.
- [ ] Harness-to-model filtering is client-side (the Rust
      `provider_for_model` prefix-matcher and catalog
      `gatewayPolicy.providers`); both delete once proxy-side grants land.
- [ ] `state.json`'s gateway payload carries one key, not a per-harness key
      map (contract change owned by agent-auth).
- [ ] `/v1/cloud/agent-gateway/` still carries the BYOK vault, selections,
      state, org policy, and catalog routes; `api.py`/`service.py`/
      `models.py` split along the same three-domain line.
- [ ] Team-budget aggregation across multiple keys is standard LiteLLM but
      not yet live-proven on the pinned image (a short check before the
      enrollment code PR freezes).
- [ ] Enrollment copies `max_budget` onto the virtual key as well as the
      team; keys must stop carrying budgets (the team cap already
      aggregates, and N per-key copies of the mirror would drift).
- [ ] Sessions for org members hand out the personal enrollment's key (the
      state renderer and budget gate both resolve the personal
      enrollment), so org members' gateway spend lands on their personal
      subject today; org enrollment rows exist but are not what sessions
      use.
