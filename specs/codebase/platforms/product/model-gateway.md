# Model Gateway

Status: target. This document describes the accepted destination for the model gateway. The body is written in the ideal state. Every difference from `main` today is listed in [Current gaps](#current-gaps); the list shrinks as follow-up PRs land, and the label comes off when it is empty.

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
  harness group(s) it belongs to. Group names are exactly the harness
  `harness_kind` identifiers of the gateway-capable harnesses (`claude`,
  `codex`, `opencode`, `grok`) — no translation table; see LiteLLM's
  [model access groups](https://docs.litellm.ai/docs/proxy/model_access_groups).
  This one reviewed file is therefore also the harness-to-model map; no
  client-side model filtering exists anywhere. `cursor` is deliberately
  absent from the vocabulary: it is native-only (no gateway recipe exists
  for it), so no model belongs to a `cursor` group and no `cursor` virtual
  key is ever minted.
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

**Orgs are the only billing subject.** There is no personal subject and no
self-pay/company-pay split: a "personal org" is simply the default org
created at signup that nobody else has joined, and it bills like any other
org. One law downstream of that: the whole account shape has exactly one
form.

One LiteLLM [team](https://docs.litellm.ai/docs/proxy/users) per org
(`org-<uuid>`) — the org's wallet; the budget lives on the team and mirrors
the org's remaining credit. One LiteLLM user per **(org, member)**
(`org-<org>-user-<uuid>`) — never one global user spanning orgs, so any
user-scoped LiteLLM control is org-scoped by construction. Under each
member's LiteLLM user, one
[virtual key](https://docs.litellm.ai/docs/proxy/virtual_keys) per
(member, gateway-capable harness), each granted its harness's access group
by name (`{"models": ["claude"]}` at `/key/generate`). The key is the whole
differentiator: one deployment, one public URL, and what a key can see and
invoke is determined proxy-side by its group grant and team budget.

- `GET /v1/models` with a harness key returns only that harness's models,
  so discovery-based CLIs (grok) see the right list with no client logic.
- Invoking an out-of-group model returns 403 `key_model_access_denied`.
- Spend from every key in the team aggregates against the team budget.
- Per-member, per-harness spend attribution falls out of per-key spend rows
  for free; charts read our imported ledger, never the proxy.
- Per-member caps, when wanted, are one call per member — either a LiteLLM
  team-member budget or a budget on the member's per-org LiteLLM user (the
  two are equivalent now that users never span orgs). The forbidden shape
  is a budget on any identity that spans teams. LiteLLM's organizations
  entity above teams is enterprise-licensed and not assumed here.

**Which org pays (v1): the user's default org, always.** Sessions resolve
the default org's enrollment; there is no per-workspace payer resolution
and no funded-org fallback logic. Billing a session to the org that owns
its workspace is the parked end state (it requires the delivered
`state.json` to carry per-org key material — an agent-auth contract change
— and is deferred with it).

**An unfunded org fails closed.** An org with no credit grant and no
explicitly configured budget gets no gateway: the state renderer withholds
key material and launches refuse with a typed error. No "no ledger means
unlimited" branch, and never a literal `0` budget handed to LiteLLM (which
reads 0 as *uncapped*). This is safe because every default org is funded by
the signup grant; a genuinely unfunded org is an honest "billing not set
up" state, not a trap.

### Billing integration

The gateway does not meter spend; the billing platform's LLM credit ledger
does ([billing.md](billing.md) owns grants and Stripe). The invariant
behind the division of labor: the ledger is the meter, the LiteLLM budget
is a mirror, and disabling the virtual key is the enforcement act.

Each LiteLLM layer owns exactly one concern, and money never attaches to
keys:

| LiteLLM entity | Maps to | Owns |
| --- | --- | --- |
| team | the org | money: pooled budget mirror, overage-uncapped mode, reactivation |
| user | (org, member) | identity + optional per-member caps, org-scoped by construction |
| key | (org, member, harness) | access: group grant and spend attribution; never a budget |

Two consequences billing can rely on:

- The gateway's primitives to billing are org-level: enroll, set budget,
  disable, reactivate — each fanning out to the org's N member keys
  internally. Billing code never counts keys, so key granularity can
  change without touching billing.
- Credit grants are the only funding interface: the free signup grant
  (landing on the human's default org, deduped per GitHub identity — one
  grant per human, and creating orgs mints nothing), top-up grants, and
  seat-minted grants (paid seats → grants, `source='seat'`, idempotent by
  `source_ref`; the seat→grant wiring itself belongs to billing's separate
  pass — this platform only consumes the resulting ledger rows). A joining
  member never brings their free grant into an org; it stays on their
  default org forever, which is what keeps invite-farming worthless.

- The credit ledger on the org's billing subject is authoritative: grants
  (free credits, seats, top-ups) minus imported spend debits.
- The usage importer pages the proxy's `/spend/logs`, resolves each row's
  virtual key back to an enrollment and billing subject, and writes
  deduped debit rows. After importing it reconciles every affected
  subject: at zero remaining credit it disables the subject's virtual
  keys and marks the enrollment exhausted, so gateway launches fail
  closed. Re-enabling happens the same way in reverse when credit
  returns.
- The LiteLLM team budget mirrors the ledger; it is a backstop against
  importer lag, not the meter. Funded orgs get their remaining credit as
  the team budget, floored at a small positive value when exhausted
  (LiteLLM reads a budget of 0 as uncapped). An org with no grants and no
  explicitly configured budget is not mirrored at a default — it is
  unfunded, and unfunded fails closed (no key material, typed launch
  refusal).
- Overage-enabled subjects get no proxy budget at all: the proxy is
  uncapped for them, and the guardrail is the ledger plus the top-up
  loop. When such a subject drops below the top-up threshold, a Stripe
  charge lands as a new credit grant and reactivates the enrollment
  (keys unblocked, budgets raised).

Enrollment is the idempotent provisioning of this shape for one
(org, member): ensure the org team (with budget), the member's per-org
LiteLLM user, and the member's per-harness keys; encrypt the raw keys
(Fernet) on enrollment rows; track a sync status whose fingerprint covers
the expected key-set shape, so adding a gateway-capable harness (or
changing the identity scheme) flips enrollments to `pending` and the next
pass re-mints. Virtual keys have no user-facing CRUD anywhere; they exist
only through enrollment and surface only inside rendered `state.json`.
Free-credit grants run before sync so the LiteLLM budget mirrors the
resulting balance.

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
- Team-budget aggregation: spend from every key in a team aggregates against
  that team's budget (the mechanism the whole per-harness-key account model
  depends on) — confirmed standard LiteLLM behavior, live-verified against
  the pinned image (v1.93.0, 2026-07-25) ahead of B2's per-(subject,harness)
  minting.

Org-only account model (named, binary assertions; the unification corridor
is done when they are green — IDs are stable, tests reference them by name):

- **D1** Signup produces: team `org-<id>`, LiteLLM user
  `org-<org>-user-<id>`, one key per gateway-capable harness (cursor
  absent), and the free grant on the default org's billing subject.
  (enrollment pytest)
- **D2** A second account on the same GitHub identity gets no grant, and
  creating additional orgs mints nothing. (free-credits pytest)
- **D3** An unfunded org: the renderer withholds key material, launches
  refuse with the typed error, and LiteLLM never receives a literal `0`
  budget. This assertion *replaces* the "no grant means unlimited" tests,
  which must be deleted, not kept green. (budget + renderer pytest)
- **D4** Spend through a member's harness key lands in the imported ledger
  attributed to (user, org, harness, model), and the team aggregate equals
  the sum across member keys — live-verified against the staging proxy.
  (usage-import pytest + live run)
- **D5** Spend-to-zero disables keys and withholds material → typed
  refusal; a top-up grant reactivates → launch succeeds. (release
  scenarios, rewired to org subjects)
- **D6** The migration re-parents a personal enrollment onto the default
  org, re-mints keys under the per-org LiteLLM user, revokes the old keys,
  is idempotent on re-run, and a session launched after it works.
  (migration pytest + intent test)
- **D7** Adding a gateway-capable harness kind flips enrollments to
  `pending` and the next pass mints exactly the missing key. (enrollment
  fingerprint pytest)
- **D8** `get_gateway_enrollment_for_user` resolves the default org
  unconditionally; the funding guard and the name-ordered org choice are
  gone from the codebase (grep-gated). (budget pytest + grep gate)

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] The Rust `provider_for_model` prefix-matcher is a provisional stand-in
      for provider-tagged catalog model entries; it now only labels enriched
      gateway-model / launch-option rows for the UI (the client-side
      `gatewayPolicy.providers` filter it used to back is gone — B5 — now
      that LiteLLM access-group tags enforce harness-to-model scoping
      server-side).
- [ ] `api.py`/`service.py`/`models.py` still share one `agent_gateway`
      package across the gateway-account and agent-auth domains (S1 split
      only the URL prefixes: BYOK vault, selections, state, and org policy
      now answer under `/v1/cloud/agent-auth/`, while this document's
      `/v1/cloud/agent-gateway/` narrowed to enrollment + capabilities as
      specified); the matching Python module split is still pending. Catalog
      routes already live in their own `agent_models` module
      (model-catalog.md §Cloud routes).
- [ ] No product-server route emits `agent_gateway_credits_exhausted`
      ([budget.py](../../../../server/proliferate/server/cloud/agent_gateway/budget.py)).
      Exhaustion is enforced — the usage importer disables the LiteLLM virtual
      keys, and the agent-auth state render withholds key material so the
      runtime fails closed at launch — but neither wall answers a request with
      that code, so a client cannot distinguish "exhausted" from a generic
      gateway failure on the product surface. The release scenarios still
      classify the string off the proxy response
      (`managed-cloud-fixture-smoke-1.ts`, `t3-bill-4.ts`). The code's only
      product-server producer was the server-side catalog prober, which the
      model-catalog re-key deleted.
- [ ] **The account model is not org-only yet.** Personal enrollments
      (`subject_kind='user'`, `user-<uuid>` teams) exist beside org rows;
      the free signup grant lands on a personal billing subject; and both
      enrollment paths mint the same shared LiteLLM user id
      (`user-<uuid>`, `enrollment.py`) rather than per-(org, member)
      identities. The unification: delete the personal subject shape,
      re-parent existing personal teams onto each user's default org, move
      grants to the org subject, mint per-org LiteLLM users, and re-mint
      keys under them (the enrollment fingerprint machinery absorbs the
      re-mint as ordinary shape drift).
- [ ] **The interim funding-follows-attribution guard deletes with the
      unification.** Today a member's org enrollment governs only when the
      org subject is funded, else the personal enrollment
      ([budget.py](../../../../server/proliferate/server/cloud/agent_gateway/budget.py)
      `get_gateway_enrollment_for_user`, including the unstable
      first-membership-by-org-name choice); under the ruling, sessions
      always resolve the default org's enrollment, and the guard — plus its
      "no grant means unlimited" branch — is replaced by the fail-closed
      unfunded-org law in the body.
