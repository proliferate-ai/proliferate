# Sandbox Access

Status: target. This document describes the accepted destination for the
caller contract of cloud sandbox access: whether a caller may reach a
sandbox, and how a caller reaches one. The body is written in the ideal
state. Every difference from `main` today is listed in
[Current gaps](#current-gaps); the list shrinks as follow-up PRs land, and
the label comes off when it is empty.

## Purpose

The sandbox access platform owns two questions and nothing else: **can I**
— the gating layers between a caller and a sandbox — and **how do I** — the
primitives and choreography that turn a cloud workspace id into live
runtime traffic. It absorbs the deployment-capability contract (formerly
`deployment-capabilities.md`, implemented and deleted) at its current truth,
contract v3.

Fences, one owner per concern:

- The box itself — states, provisioning, wake mechanics — belongs to
  [sandbox-lifecycle.md](sandbox-lifecycle.md). That document rules *when*
  a sandbox wakes ("the gateway gates on policy, E2B wakes on traffic");
  this one rules what a caller sees while it happens.
- The wire — the proxy route's internals, bearer swap, streaming laws —
  belongs to [sandbox-gateway.md](sandbox-gateway.md). This document
  treats the gateway as a black box with a URL and an error taxonomy; at
  the shared seams (the 402, the 409, the 60 s access cache) this
  document owns the caller-facing representation, gateway owns the
  server-side mechanism.
- Billing *math* — meters, credits, holds — belongs to
  [billing.md](billing.md). This document owns only the billing gate's
  wire representation.
- What is inside the box belongs to
  [sandbox-content.md](sandbox-content.md).
- `/meta` mechanics live here: the capability contract is the deployment
  gating layer, so its shape, derivation, and versioning are this
  document's to rule.

## Can I: three layers, one representation each

**The law: three gating layers, each with exactly one wire representation,
and nothing else may invent one.** A caller that handles these three shapes
handles every way access can be denied. Any new denial must be expressed
through an existing layer, not a new field.

| Layer | Question | Wire representation | Where |
| --- | --- | --- | --- |
| Deployment | Does this server offer managed cloud at all? | `capabilities.managedCloud.status` in `GET /meta` — an absence, never an error | [meta.py](../../../../server/proliferate/server/meta.py) |
| Subject | May this user spend right now? | HTTP 402, code `billing_credits_exhausted` \| `billing_start_blocked` | [billing/authorization.py](../../../../server/proliferate/server/billing/authorization.py) |
| Sandbox | Is the runtime reachable right now? | HTTP 409, code `cloud_sandbox_runtime_not_ready` | [cloud_sandboxes/service.py](../../../../server/proliferate/server/cloud/cloud_sandboxes/service.py) |

### The deployment layer

`GET /meta` returns a versioned capability contract
(`SELF_HOST_CAPABILITY_CONTRACT_VERSION = 3`,
[constants/deployment.py](../../../../server/proliferate/constants/deployment.py)).
The block relevant here:

```ts
type CapabilityStatus = "disabled" | "operator_configuration_required" | "ready";

githubRepositoryAccess: { status: CapabilityStatus;
                          provider: "github_app" | null;
                          displayName: string | null };
managedCloud:           { status: CapabilityStatus;
                          repositoryAuthority: "github_app" | null };
cloudWorkspaces: boolean;   // v1 compatibility projection only
```

Derivation is pure over operator config (`build_server_capabilities`, no
I/O, unit-tested against a `Settings` instance): GitHub App config complete
→ repository access `ready`, partial → `operator_configuration_required`,
absent → `disabled`; managed cloud is `ready` only when E2B provisioning is
configured *and* repository access is `ready`, because workspace mutations
enforce GitHub App authority server-side. `cloudWorkspaces` is `true` iff
`managedCloud.status == "ready"` — old clients fail closed for free.

Two laws carried over from the absorbed contract:

- **No action that cannot repair the state.** `operator_configuration_
  required` means only the operator can fix it; clients must not offer the
  user a reauthorization that would change nothing.
- **Statuses expose aggregates, never field-level secret presence.** The
  contract says "the App config is partial", never which secret is missing.

This layer never raises. Clients gate UI on the status — a `disabled`
deployment simply has no cloud surfaces — so a request that would need the
capability is never sent. Unknown future capability fields are ignorable by
contract.

### The subject layer

The billing gate fires where provider spend would start: sandbox
resume/start inside a materialization operation. Its one representation is
`CloudSandboxResumeBlockedError` — HTTP 402, `code` of
`billing_credits_exhausted` or `billing_start_blocked`, plus a detail body
carrying `decision_type` and optionally `reason` and `remaining_seconds`.
The materialization runner
([runner.py](../../../../server/proliferate/server/cloud/materialization/runner.py))
catches and logs it; everything above sees the typed 402.

### The sandbox layer

`load_cloud_sandbox_runtime_access` is the single choke point for turning a
sandbox row into runtime coordinates (base URL, bearer, data key). Any of
the three missing → HTTP 409 `cloud_sandbox_runtime_not_ready`. Readiness
is readable two ways, both DB-derived: on the workspace payloads
themselves (`pending | materializing | needs_rematerialization | ready |
archived | error`, derived client-side in
[cloud-workspace-status.ts](../../../../apps/packages/product-client/src/lib/domain/workspaces/cloud/cloud-workspace-status.ts))
and via `GET /workspaces/{id}/runtime-status`
([workspaces/api.py](../../../../server/proliferate/server/cloud/workspaces/api.py)),
which adds the runtime and sandbox status axes for one workspace. Neither
performs a live runtime call; the 409 is what a caller gets for jumping
the gun.

Per the lifecycle ruling, this layer is a *policy* gate, not a liveness
gate: a paused-but-permitted sandbox is forwarded to and wakes under the
traffic; the 409 means the access material genuinely does not exist yet,
not "try again once it wakes".

Adjacent `CloudApiError` codes (repository access, agent-gateway catalog,
…) are their platforms' business and are not access-gating
representations; a client must never treat an unrecognized code as one of
the three layers.

## How do I: the choreography

The caller's path from a cloud workspace id to runtime traffic:

1. **Ensure the sandbox row exists** — `POST /cloud-sandbox/ensure`
   ([cloud_sandboxes/api.py](../../../../server/proliferate/server/cloud/cloud_sandboxes/api.py)),
   billing-gated, never touches E2B (lifecycle's ensure-never-provisions
   law). This is the explicit entry point for flows that start from
   nothing; steady-state flows skip it because the row already exists.
2. **Resolve a connection** — `getResolvedCloudWorkspaceConnection`
   ([workspace-connection-retry.ts](../../../../apps/packages/product-client/src/lib/access/cloud/workspace-connection-retry.ts))
   loads the cloud workspace and builds gateway connection info
   ([cloud-sandbox-gateway.ts](../../../../apps/packages/product-client/src/lib/access/cloud/cloud-sandbox-gateway.ts)).
   Readiness is structural, not polled: a workspace with no stamped
   runtime workspace id throws typed `workspace_not_ready` (409); no cloud
   client throws `cloud_client_unavailable` (401).
3. **Retry flatly while not ready** — 750 ms fixed delay, 8 attempts, no
   backoff; retry on `workspace_not_ready`, any 5xx, or a network
   `TypeError`, rethrow on anything else. React Query's native `retry` is
   the loop
   ([use-cloud-workspace-connection.ts](../../../../apps/packages/product-client/src/hooks/access/cloud/use-cloud-workspace-connection.ts),
   `staleTime` 30 s) — there is no hand-rolled poller.
4. **Call the gateway** — the resolved connection is an ordinary
   AnyHarness client pointed at
   `/v1/gateway/cloud-sandbox/anyharness`; every AnyHarness call the
   product makes locally works identically through it.

### The token

There is no gateway-specific token. The credential is the product JWT
(7-day lifetime, [constants/auth.py](../../../../server/proliferate/constants/auth.py)),
fetched through one swappable provider pointer
([sandbox-gateway-access.ts](../../../../apps/packages/product-client/src/lib/access/cloud/sandbox-gateway-access.ts))
that each host arms at startup — desktop with its refreshing session
loader, web with the in-memory session token. The pointer is re-invoked
immediately before every gateway connection is used
(`withFreshCloudSandboxGatewayAccessToken`), so freshness is the
provider's problem and the gateway code never caches a credential.
WebSocket upgrades carry the same token in the
`proliferate-gateway-bearer` subprotocol
([gateway/access.py](../../../../server/proliferate/server/cloud/gateway/access.py)),
because WS clients cannot set headers. Server-side, gateway access
resolution (row → upstream URL + bearer) is cached per user for 60 s with
a per-user lock ([gateway/service.py](../../../../server/proliferate/server/cloud/gateway/service.py))
— the bound on how fast a destroy/recreate propagates to in-flight
callers.

### Worked example: worktree inventory on a cloud sandbox

The settings pane and composer status card list a cloud sandbox's
worktrees:

1. `useWorktreeSettingsTargets` selects cloud workspaces whose status is
   `ready` — the sandbox layer consulted from the row, no request sent for
   pending ones.
2. For each, `cloudWorkspaceConnectionQueryOptions` resolves a gateway
   connection (steps 2–3 above); a workspace that just lost its runtime id
   surfaces `workspace_not_ready` and the query retries on the flat
   schedule.
3. The AnyHarness client calls `GET /v1/worktrees/inventory` through the
   gateway with a freshly minted product token; if the VM was paused, it
   wakes under this very request (the ruled policy-gate behavior — today's
   liveness gate 409s instead; see Current gaps).

No ensure, no wake verb, no bespoke polling — the same three shapes, the
same one choreography.

## The client contract

- **One shared parser.** `ProliferateClientError`
  ([core.ts](../../../../cloud/sdk/src/client/core.ts)) carries `status`,
  `code`, `details`; one shared utility classifies it into the three
  gating layers plus "not a gate". Feature code branches on the
  classification, never on raw `.code ===` string comparisons scattered at
  call sites.
- **One capability parser.** The capability contract is parsed once, in
  product-client
  ([server-capability-contract.ts](../../../../apps/packages/product-client/src/lib/domain/capabilities/server-capability-contract.ts));
  desktop and web consume it through the package. Mobile consumes the same
  parser rather than maintaining its own version-branching copy.
- **Representations clients may branch on** — exactly the three layer
  shapes, the choreography's two typed client errors
  (`workspace_not_ready`, `cloud_client_unavailable`), and the workspace
  status enum. Nothing else on the wire is a client contract; in
  particular, a client must not branch on fields the server does not
  populate.

## Code map

```text
server/proliferate/
├── server/meta.py                          GET /meta, capability derivation (pure)
├── constants/deployment.py                 contract version
├── server/billing/authorization.py         the 402 gate (resume-blocked)
├── server/cloud/cloud_sandboxes/
│   ├── api.py                              ensure/get/destroy routes
│   └── service.py                          runtime-access choke point, the 409
└── server/cloud/gateway/
    ├── api.py                              HTTP + WS proxy routes, product auth
    ├── access.py                           WS token extraction, gateway auth
    └── service.py                          per-user access cache (60 s)
apps/packages/product-client/src/
├── lib/domain/capabilities/server-capability-contract.ts   the capability parser
├── lib/access/cloud/
│   ├── server-capabilities.ts              GET /meta fetch
│   ├── sandbox-gateway-access.ts           token provider pointer
│   ├── cloud-sandbox-gateway.ts            connection build, fresh-token wrap
│   └── workspace-connection-retry.ts       retry policy + typed errors
├── hooks/access/cloud/use-cloud-workspace-connection.ts    query options
└── lib/domain/workspaces/cloud/cloud-workspace-status.ts   status derivation
cloud/sdk/src/client/
├── core.ts                                 ProliferateClientError
└── cloud-sandboxes.ts                      ensure/get/destroy bindings
```

## Failure modes

- Deployment lacks managed cloud: no error ever fires — the capability
  status is `disabled` or `operator_configuration_required` and the client
  never renders the entry points.
- Billing hold at spend time: typed 402; the client shows the block with
  the decision detail; no retry helps until the subject state changes.
- Runtime access material missing: typed 409
  `cloud_sandbox_runtime_not_ready`; materialization repairs it, the
  gateway does not.
- Workspace not yet stamped with a runtime id: typed client-side
  `workspace_not_ready`, absorbed by the flat retry; visible only if
  8 × 750 ms elapses.
- Auth provider unarmed or session expired mid-flight: typed
  `cloud_client_unavailable` / auth failure from the gateway; the host's
  token provider is the repair.
- Paused VM under a gateway call: not a failure — traffic wakes it
  (lifecycle's ruling); latency of roughly a second, inside the retry
  budget.

## Proof

- Capability derivation: unit tests over `build_server_capabilities`
  against `Settings` instances
  ([test_meta_endpoint.py](../../../../server/tests/unit/test_meta_endpoint.py)).
- Gateway auth and proxying:
  [test_cloud_sandbox_gateway_proxy.py](../../../../server/tests/unit/test_cloud_sandbox_gateway_proxy.py),
  [test_cloud_sandbox_gateway_service.py](../../../../server/tests/unit/test_cloud_sandbox_gateway_service.py).
- Pending, landing with the gap PRs: shared-classifier unit tests; a
  contract test that the wire carries no unpopulated branchable fields.

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] `actionBlockKind` is a live wire field with a dead producer: the
      server serializes it always-`null` on two workspace models
      ([workspaces/models.py](../../../../server/proliferate/server/cloud/workspaces/models.py))
      while the client *branches on it* to decide whether to show the
      status screen
      ([cloud-workspace-status.ts](../../../../apps/packages/product-client/src/lib/domain/workspaces/cloud/cloud-workspace-status.ts));
      the client also keeps a `CloudStartBlockReason` union mirroring
      server constants that never reach the wire. Delete the field and the
      dead client branch — the 402 body is the subject layer's one
      representation — or wire it for real; the ruling is delete.
- [ ] `authorize_sandbox_start` is dead code (no callers since #823,
      documented as dead in three places); the live gate is the
      resume-blocked path. Delete it and its sibling
      ([billing/authorization.py](../../../../server/proliferate/server/billing/authorization.py)).
- [ ] Two hand-written capability parsers: product-client and mobile
      ([mobile-server-capabilities.ts](../../../../apps/mobile/src/lib/access/cloud/capabilities/mobile-server-capabilities.ts))
      each reimplement the v1/v2+ derivation. Collapse mobile onto the
      shared parser.
- [ ] Error classification is scattered: `workspace_not_ready` is
      constructed inline at two independent sites (product-client gateway
      resolver, mobile runtime resolver), and at least six modules branch
      on raw `ProliferateClientError.status`/`.code` locally. Build the
      one shared classifier and migrate branch sites onto it. (The mobile
      duplication is the same file as
      [sandbox-gateway.md](sandbox-gateway.md)'s duplicate-resolver gap —
      one fix PR closes both.)
- [ ] The workspace status derivation this document claims is split from
      its inputs: the 900 s stale threshold and the
      runtime-id-presence rule that turn a row into
      `materializing`-vs-`error` live only in
      [workspace-provisioning.md](workspace-provisioning.md), whose
      vocabulary (`ready`/`materializing`/`error`) predates this enum.
      Fold the derivation rules (threshold included) into this document
      and align the enums when that doc slims.
- [ ] `_runtime_status` maps sandbox statuses (`provisioning`, `stopped`)
      the enum and check constraint do not allow; the runtime-status
      shape is this document's, so the dead-branch deletion rides its fix
      PR (cross-listed from
      [sandbox-lifecycle.md](sandbox-lifecycle.md)).
- [ ] The sandbox layer is a liveness gate today, not a policy gate: the
      runtime gateway refuses 409 unless the row is already `ready`, so
      auto-resume never sees the traffic. Owned by
      [sandbox-lifecycle.md](sandbox-lifecycle.md)'s gap list; this
      document's choreography assumes the ruled behavior.
- [ ] `POST /cloud-sandbox/wake` is byte-identical to `ensure`; collapse
      to `ensure` as a hard rename. Owned by
      [sandbox-lifecycle.md](sandbox-lifecycle.md)'s gap list; listed here
      because the SDK bindings
      ([cloud-sandboxes.ts](../../../../cloud/sdk/src/client/cloud-sandboxes.ts))
      change with it.
