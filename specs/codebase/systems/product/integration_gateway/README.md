# Integration gateway

Status: target. Grade B system spec: the mechanism sections below are
verified against `main`; the laws are written in the accepted destination
(Core Architecture §7) and every difference from `main` is listed in
[Current gaps](#current-gaps). Decisions still owed are marked
`PABLO DECIDES`.

The integration gateway is **the only path from an agent to a company
system**. It owns two halves that share one MANIFEST and one spec:

- **connections** — the auth relationship between an organization (or one of
  its members) and a provider: definitions, OAuth, credentials at rest,
  health, management, admission, revocation, and durable action approvals;
- **gateway** — the MCP surface a runtime mounts, which resolves a caller to
  its ready connections and proxies tool calls with control-plane-held
  credentials.

The one-line split it must never lose: **connection ≠ grant ≠ tool-call
event.** A connection is a converging row about a credential; a grant is what
a subject may do with it on a given run; a tool-call event is the audited fact
that it did.

## 1. Purpose

An agent inside any environment (desktop or cloud) can act on Linear, Slack,
GitHub-as-tool, or any MCP-speaking provider without a credential ever
entering the environment, and a human can see, repair, approve, and revoke
that access from one place. Failure is typed and names the repair verb;
nothing is repaired lazily inside a tool call.

## 2. Owned state

Tables, all written only by this system
([db/models/integrations.py](../../../../../server/proliferate/db/models/integrations.py),
[integration_authorization.py](../../../../../server/proliferate/db/models/integration_authorization.py),
[integration_revocation.py](../../../../../server/proliferate/db/models/integration_revocation.py),
[cloud/integration_approvals.py](../../../../../server/proliferate/db/models/cloud/integration_approvals.py)):

| Table | Row meaning |
| --- | --- |
| `cloud_integration_definition` | A provider definition: seed (from [seeds.py](../../../../../server/proliferate/server/integration_gateway/connections/seeds.py), reconciled at boot) or org-custom. Carries the typed launch/auth config parsed by [config.py](../../../../../server/proliferate/server/integration_gateway/connections/config.py). |
| `cloud_integration_policy` | Org enable/disable overlay on a definition. |
| `cloud_integration_account` | **The connection.** One connected instance of a definition for an owner; encrypted credential bundle, `status` (`ready` is the only usable value), `enabled`, `auth_version` (bumped on every credential write). |
| `cloud_integration_definition_security_revision` | Pinned OAuth-client / endpoint revision a connection was granted under; admission validates against it. |
| `cloud_integration_authorization_attempt` | Attempt-owned connect/reconnect work (`active → exchanging → validating → terminal`), stage-and-swap onto the account. |
| `cloud_integration_oauth_client` | Static or dynamically-registered OAuth client per definition. |
| `cloud_integration_oauth_flow` | Short-lived OAuth state, hashed. |
| `cloud_integration_revocation_job` | Disconnect-time provider revocation, bounded retries, deadline. |
| `cloud_integration_tool_schema_cache` | Per-account `tools/list` cache, valid only at matching `auth_version` inside the TTL. |
| `cloud_integration_tool_call_event` | **The tool-call event.** One audit row per proxied call, success or failure. |
| `cloud_integration_action_approval` / `_event` | One exact external-action request with immutable actor/account/worker/session snapshots (deliberately not FKs) and its append-only evidence. |

Runtime worker identity, enrollment, heartbeat and the gateway bearer token
(`cloud_runtime_worker*`, `cloud_integration_gateway_token`) are **not**
owned here — see Fences.

## 3. Public surface

All routes mount under `/v1/cloud` via
[cloud/api.py](../../../../../server/proliferate/server/cloud/api.py).

Connections, user-authenticated
([connections/api.py](../../../../../server/proliferate/server/integration_gateway/connections/api.py)):

| Route | Serves |
| --- | --- |
| `GET /integrations/catalog` | Definitions visible to the caller with their connect schema. |
| `GET /integrations/health` | One [`HealthVerdict`](../../../../../server/proliferate/server/integration_gateway/connections/health.py) per visible definition: `ready · needs_auth · needs_reauth · disabled_by_user · disabled_by_org · error`; OAuth accounts claiming `ready` are actively probed. |
| `GET /integrations/management` | The authoritative per-definition management item: availability, connection summary, latest attempt, and the exact primary/secondary actions the UI may render ([management.py](../../../../../server/proliferate/server/integration_gateway/connections/management.py)). |
| `POST /integrations/authentications` | Start a connect/reconnect: api-key definitions validate and swap; OAuth definitions open an attempt + flow. |
| `DELETE /integrations/accounts/{id}` | Disconnect: one transaction makes local use impossible, invalidates authority, stages revocation. |
| `GET /integrations/oauth/flows/{id}`, `POST …/cancel`, `POST /integrations/authorization-attempts/{id}/cancel` | Flow/attempt observation and cancellation. |
| `GET /integrations/oauth/callback` | Provider callback; completes the attempt, swaps credentials, renders the desktop deep-link or web completion page ([pages.py](../../../../../server/proliferate/server/integration_gateway/connections/pages.py)). |
| `GET/POST /integrations/admin/organizations/{org}/definitions`, `POST …/definitions/{id}/enabled` | Org-admin custom definitions and enable/disable policy. |

Approvals, user-authenticated
([action_approvals/api.py](../../../../../server/proliferate/server/integration_gateway/connections/action_approvals/api.py)):
`GET /integrations/action-approvals`, `GET …/{id}`, `POST …/{id}/approve|reject|revoke`.
A worker, gateway bearer, or MCP session can never call these.

Gateway, worker-authenticated
([gateway/api.py](../../../../../server/proliferate/server/integration_gateway/gateway/api.py)):
`GET|POST /integration-gateway/mcp` — JSON-RPC exposing exactly three virtual
tools ([virtual_tools.py](../../../../../server/proliferate/server/integration_gateway/gateway/domain/virtual_tools.py)):
`integrations.list_providers`, `integrations.list_tools`,
`integrations.call_tool`.

Python surface for other systems (per the MANIFEST): `connections.api`,
`connections.service`, `connections.models`, `connections.access`,
`gateway.api`, `gateway.service`, `gateway.models`. Measured importers today:
`background` (revocation task), `cloud` (router shell), `main.py` (seed sync).

SDK: [integrations.ts](../../../../../cloud/sdk/src/client/integrations.ts),
[integration-action-approvals.ts](../../../../../cloud/sdk/src/client/integration-action-approvals.ts).

## 4. Consumes

- The gateway **grant**: [`require_integration_gateway_grant`](../../../../../server/proliferate/server/integration_gateway/gateway/dependencies.py)
  resolves the bearer to a non-revoked worker's
  [`IntegrationGatewayGrant`](../../../../../server/proliferate/db/store/runtime_workers.py)
  (owner user, organization, worker, runtime kind) and revalidates org
  membership per request. The identity is materialized by the seam; this
  system only reads it.
- Vendor leaves, never product logic:
  [integrations/integration_oauth](../../../../../server/proliferate/integrations/integration_oauth/)
  (discovery, DCR, tokens, revocation),
  [integrations/mcp_remote.py](../../../../../server/proliferate/integrations/mcp_remote.py)
  (upstream MCP transport).
- organizations: active membership and admin checks.
- Encryption at rest: [lib/infra/encryption](../../../../../server/proliferate/lib/infra/encryption/).
- Settings `cloud_mcp_*` in [config.py](../../../../../server/proliferate/config.py),
  including the Slack qualification gate `cloud_mcp_slack_distribution_ready`
  (delivery [PR0](../../../../../delivery/integration-lifecycle/delivery-spec-integration-lifecycle-pr0.md)).

## 5. Laws

**Credentials never enter the environment.** The runtime holds only a gateway
bearer; `integrations.call_tool` decrypts, renders headers, and calls the
provider inside the control plane
([`resolve_launch`](../../../../../server/proliferate/server/integration_gateway/connections/access.py),
[`call_provider_tool`](../../../../../server/proliferate/server/integration_gateway/gateway/service.py)).
Closes: a compromised sandbox exfiltrating a provider token.

**Identity is materialized once; capability is resolved per call.** Worker
enrollment (seam) proves *who*; every tool call re-derives *what* from the
current committed connection and policy:
[`admit_provider_operation`](../../../../../server/proliferate/server/integration_gateway/connections/admission.py)
locks the ready account row, checks org policy and active membership,
validates the pinned security revision, and issues a lease before any
provider I/O. Changing what a run may do is a row update effective on the
next call — no re-materialization. Closes: stale capability surviving a
revoke.

**The connection is a converging row.** A connection is
`(org, provider, subject)` with `subject ∈ {org-install, user, bot}`, a
status vocabulary `{connected, degraded, needs_reauth, revoked}`, and a
receipt-style `last_error`. It converges through three legs — provider
webhooks (passive), a scheduled probe (active: a cheap call proving the token
works), and fail-closed usage (the gateway never lazily repairs mid-call; it
returns a typed error naming the repair verb). Closes: the one row nobody
owned converging, which was the historical source of integration pain.

**Provisioning is user-present and never inline in the usage path.** Connect
and reconnect are attempt-owned, stage-and-swap
([oauth/service.py](../../../../../server/proliferate/server/integration_gateway/connections/oauth/service.py),
delivery [PR2](../../../../../delivery/integration-lifecycle/delivery-spec-integration-lifecycle-pr2.md)):
failed, cancelled, expired, superseded or stale work can neither create a
first connection nor damage a working one. A token refresh inside
[`ensure_provider_access`](../../../../../server/proliferate/server/integration_gateway/connections/access.py)
is the single sanctioned in-path mutation and is compare-and-swap on
`auth_version`. Closes: two concurrent refreshes clobbering each other.

**Authority and credential rotations are independently monotonic.** A
credential write bumps `auth_version`; a definition security change bumps its
revision; an approval or cache bound to an older version cannot be consumed
or served. Closes: an approval granted for yesterday's workspace being
delivered with today's.

**Health rolls up into readiness.** A definition whose connection is
`needs_reauth` shows blocked *before* anything runs on it — the management
projection's `primary=reconnect` today; the automation-definition readiness
roll-up in the destination. Closes: the silent 3 a.m. failure.

**Tool policy is exact, argument-blind, and data-only.**
[`decide_tool_call`](../../../../../server/proliferate/server/integration_gateway/gateway/domain/tool_policy.py)
classifies the canonical `(provider, tool)` pair before account resolution:
Slack reads execute, Slack external actions require approval, unknown Slack
tools fail closed; other providers pass through. Agent arguments never
participate in the decision. Closes: prompt-injected tool names bypassing
approval.

**Approvals are born at the control plane and are exact, one-time, and
clock-bounded.** A gated action creates (or converges on) one durable
`pending` request bound to user, org, account `auth_version`, worker, signed
gateway session, workspace, session, provider, tool, and the SHA-256 of the
canonical arguments; 600 s TTL on the database clock; every transition is
compare-and-set; consumption succeeds once
([action_approvals/service.py](../../../../../server/proliferate/server/integration_gateway/connections/action_approvals/service.py)).
Approvals work even when the event pipe is degraded because they never ride
it. Closes: replayed or double-consumed approvals.

**Every call is an audited event.** Success, provider failure, policy denial
and transport failure all write `cloud_integration_tool_call_event`. Closes:
an unexplained external side effect.

**Disconnect is one transaction plus a bounded job.**
[`stage_revocation_for_disconnect`](../../../../../server/proliferate/server/integration_gateway/connections/revocation.py)
makes local use impossible and enqueues provider revocation through the
background outbox with a retry ceiling and a deadline sweep. Closes: a
"disconnected" token that still works at the provider.

**Expose generously at list time, enforce at call time.** Some harnesses
cache MCP tool listings per session, so the listing is the account's cached
schema and the call is where policy and admission bite; a session restart is
accepted on grant *broadening*. Closes: a harness holding a stale, narrower
tool list forever.

**Two Slack relationships, never conflated.** Slack-as-tool (this system:
gateway-held connection, agent speaks, audited per call) is not the product
Slack app ([slack.md](../slack/README.md): trigger + client, server speaks).

## 6. Emits

- `cloud_integration_tool_call_event` rows — consumed by audit/analytics.
- Health verdicts and the management projection — consumed by the settings
  surfaces and the chat composer's integrations control.
- Pending approvals — consumed by every session surface that renders
  approve/deny (chat today; Slack buttons and mobile in the destination).
- Typed error codes, all `CloudApiError` subclasses with a remediation
  string: `integration_provider_not_found`, `integration_provider_disabled`,
  `integration_membership_required`, `integration_provider_unavailable`,
  `missing_static_oauth_client`, `integration_tool_approval_required`,
  `integration_tool_not_allowed`, `integration_gateway_session_required`,
  `integration_action_payload_invalid`
  ([gateway/errors.py](../../../../../server/proliferate/server/integration_gateway/gateway/errors.py)).

## 7. Fences

- Worker enrollment, heartbeat, the gateway bearer token and the
  `integration-gateway.json` credential file the worker writes: the **seam**
  ([server/seam/workers](../../../../../server/proliferate/server/seam/workers/),
  today documented in
  [integrations.md § Runtime Worker Identity](../../../platforms/product/integrations.md)).
- Mounting the gateway as an MCP server inside a session:
  [mcp-runtime.md](../../../platforms/product/mcp-runtime.md).
- Model credentials and LLM traffic: [model_gateway.md](../model_gateway/README.md).
- GitHub App installations and repository authority: [github.md](../github/README.md).
  GitHub is not an integration definition; its App is the identity of work.
- Product-identity OAuth (who this Proliferate user is): accounts.
- Vendor wire clients: [server integrations structure](../../../../server/integrations.md).
- Rendering approval buttons and composer chrome: the client surfaces that
  own composition (chat, settings).

## 8. Code map

```text
server/proliferate/
├── db/models/
│   ├── integrations.py                          definition, policy, account, oauth client/flow, tool cache, call event
│   ├── integration_authorization.py             security revisions, authorization attempts
│   ├── integration_revocation.py                revocation jobs
│   └── cloud/integration_approvals.py           approval + event
├── db/store/integrations/                       one module per table (accounts, definitions, policies, oauth_*, authorization_attempts,
│                                                definition_security_revisions, revocation_jobs, tool_cache, tool_call_events, action_approvals)
├── integrations/integration_oauth/ · mcp_remote.py   vendor leaves
└── server/integration_gateway/
    ├── MANIFEST.toml                            one manifest for both halves
    ├── connections/
    │   ├── seeds.py                             seed definitions, reconciled by main.py at boot
    │   ├── config.py                            typed definition config ⇄ JSON, MCP URL rendering
    │   ├── api.py · models.py · service.py      routes, wire models, catalog/authenticate/remove/admin
    │   ├── oauth/                               flow start/status/cancel/callback, clients (static + DCR), scope policy, return surfaces
    │   ├── management.py                        the authoritative management item + actions
    │   ├── health.py                            verdicts with active OAuth probe
    │   ├── access.py                            credential bundle → headers/query, CAS refresh, launch triple
    │   ├── admission.py                         per-operation lease under the account lock
    │   ├── revocation.py                        disconnect staging, bounded job, deadline sweep
    │   ├── tools.py                             tools/list cache by auth_version
    │   ├── transactions.py · pages.py
    │   └── action_approvals/                    request/list/transition/consume, CAS + TTL, product-safe presentation
    └── gateway/
        ├── api.py                               GET/POST /integration-gateway/mcp
        ├── dependencies.py                      bearer → IntegrationGatewayGrant
        ├── service.py                           three virtual tools, per-call admission + audit
        ├── errors.py · models.py
        └── domain/                              execution_session (HMAC-bound session token), tool_policy, virtual_tools, tool_args, json_rpc

cloud/sdk/src/client/integrations.ts · integration-action-approvals.ts

apps/packages/product-client/src/
├── hooks/access/cloud/integrations/             catalog, health, actions, oauth flow, admin definitions
├── hooks/cloud/facade/use-cloud-integrations.ts · hooks/cloud/derived/use-composer-integrations-state.ts
├── lib/domain/cloud/{integrations,integration-reauth,composer-integrations}.ts
├── lib/domain/settings/{integrations-presentation,org-integrations-presentation}.ts
├── components/settings/panes/{UserIntegrationsPane,OrganizationIntegrationsPane}.tsx · panes/integrations/
└── components/workspace/chat/input/ComposerIntegrationsControl.tsx
```

## 9. Proof

Integration: [test_cloud_integrations_api.py](../../../../../server/tests/integration/test_cloud_integrations_api.py),
[test_cloud_integration_catalog_api.py](../../../../../server/tests/integration/test_cloud_integration_catalog_api.py),
[test_cloud_integration_health_api.py](../../../../../server/tests/integration/test_cloud_integration_health_api.py),
[test_integration_management_api.py](../../../../../server/tests/integration/test_integration_management_api.py),
[test_integration_authorization_lifecycle.py](../../../../../server/tests/integration/test_integration_authorization_lifecycle.py),
[test_integration_admission_cutoff.py](../../../../../server/tests/integration/test_integration_admission_cutoff.py),
[test_integration_refresh_races.py](../../../../../server/tests/integration/test_integration_refresh_races.py),
[test_integration_provider_access.py](../../../../../server/tests/integration/test_integration_provider_access.py),
[test_integration_oauth_scope_policy.py](../../../../../server/tests/integration/test_integration_oauth_scope_policy.py),
[test_integration_revocation_lifecycle.py](../../../../../server/tests/integration/test_integration_revocation_lifecycle.py),
[test_integration_revocation_redelivery.py](../../../../../server/tests/integration/test_integration_revocation_redelivery.py),
[test_cloud_integration_gateway_api.py](../../../../../server/tests/integration/test_cloud_integration_gateway_api.py),
[test_cloud_integration_gateway_audit.py](../../../../../server/tests/integration/test_cloud_integration_gateway_audit.py),
[test_cloud_integration_gateway_policy_api.py](../../../../../server/tests/integration/test_cloud_integration_gateway_policy_api.py),
[test_cloud_integration_gateway_tool_policy_api.py](../../../../../server/tests/integration/test_cloud_integration_gateway_tool_policy_api.py),
[test_cloud_integration_action_approvals_api.py](../../../../../server/tests/integration/test_cloud_integration_action_approvals_api.py),
[test_cloud_integrations_admin_api.py](../../../../../server/tests/integration/test_cloud_integrations_admin_api.py).

Unit: [test_integration_config.py](../../../../../server/tests/unit/test_integration_config.py),
[test_integration_lifecycle_contracts.py](../../../../../server/tests/unit/test_integration_lifecycle_contracts.py),
[test_cloud_integration_oauth.py](../../../../../server/tests/unit/test_cloud_integration_oauth.py),
[test_cloud_integration_oauth_clients.py](../../../../../server/tests/unit/test_cloud_integration_oauth_clients.py),
[test_cloud_integration_oauth_scope_policy.py](../../../../../server/tests/unit/test_cloud_integration_oauth_scope_policy.py),
[test_cloud_integration_oauth_surfaces.py](../../../../../server/tests/unit/test_cloud_integration_oauth_surfaces.py),
[test_cloud_integration_gateway_tool_policy.py](../../../../../server/tests/unit/test_cloud_integration_gateway_tool_policy.py),
[test_integration_gateway_execution_session.py](../../../../../server/tests/unit/test_integration_gateway_execution_session.py).

## Failure modes

| Condition | Typed result | Recovery |
| --- | --- | --- |
| Provider not connected / disabled by org / membership lapsed | `integration_provider_not_found` · `_disabled` · `integration_membership_required` (MCP tool error, audited) | connect; admin enables; rejoin |
| Token expired, refresh fails, or scopes outside the ceiling | health `needs_reauth`, management `primary=reconnect` | user reconnects (attempt-owned) |
| Slack app not distribution-qualified | `integration_provider_unavailable` before any client-store I/O | operator flips `CLOUD_MCP_SLACK_DISTRIBUTION_READY` |
| Gated action without an action-capable session | `integration_gateway_session_required` | runtime mounts with the signed session |
| Gated action with a session | `integration_tool_approval_required` + pending approval | human approves; delivery per the frozen Slack slice |
| Approval past `expires_at` | terminal `expired` on next observation, consume refused | request again |
| Provider revocation endpoint down at disconnect | job retries with backoff until the deadline, then sweep marks it | none needed locally — local use already impossible |

## Current gaps

Deltas between the destination above and `main`, each strikable by one PR:

- [ ] **Subjects.** `cloud_integration_account` is keyed by owner *user* only;
      the org owner-scope value is reserved but unused, and `bot` /
      `org-install` subjects do not exist. Headless runs therefore have no
      credential they may legally hold (Law 6: headless never holds human
      credentials). Needs the subject column, the org-install connect flow,
      and admission by subject.
      > [!decision] PABLO DECIDES: who connects on behalf of an automation —
      > (a) an org admin connects an `org-install` subject once and grants
      > reference it; (b) the automation's creator's user connection is
      > delegated with attenuation. Recommendation: (a); it is the only shape
      > that survives the creator leaving the org.
- [ ] **Grants as first-class rows.** Capability today is "owner's ready
      accounts ∩ org policy"; there is no `(subject, run)` grant object
      declared on a definition. Needs the grant table and the automations
      seam change (both specs, one PR).
- [ ] **Status vocabulary.** Accounts carry `status='ready'` + `enabled`;
      the destination's `{connected, degraded, needs_reauth, revoked}` with
      `last_error` is projected at read time by `health.py`, not stored.
- [ ] **Convergence legs.** The probe runs at `GET /health` request time,
      not on a schedule, and there is no provider-webhook leg. Needs a
      scheduled probe task in the background system and per-provider
      webhook intake (Slack app events, GitHub is already separate).
- [ ] **Readiness roll-up.** No automation-definition readiness consumes
      health; the management projection is the only roll-up.
- [ ] **Approval surfaces.** Only the chat surface renders approvals; Slack
      Block Kit and mobile are the [slack.md](../slack/README.md) / clients' work.
- [ ] **Slack external-action delivery.** The frozen next slice
      (`slack_send_message` only, `chat:write`, typed action, `approvalId`
      wrapper, bound-revision credential load) is specified in
      [integrations.md § Frozen next Slack delivery slice](../../../platforms/product/integrations.md)
      and not built; no gated action is delivered today.
      > [!decision] PABLO DECIDES: keep that frozen slice as-is, or fold
      > delivery into the grant model above so *every* approval-gated tool
      > delivers the same way (typed action → approval → consume → deliver).
      > Recommendation: fold — one delivery path, Slack is just the first
      > provider with a typed action.
- [ ] **Folder shape.** `connections/` still carries the pre-extraction
      module names; the destination's `grants/`, `tools/`, `approvals/`
      subfolders (Target Tree) land with the grant work, not before.
- [ ] **Stale importer.** The MANIFEST's `cloud` importer disappears with
      the cloud router shell (PR-Ab); the routers re-mount from `main.py`.
