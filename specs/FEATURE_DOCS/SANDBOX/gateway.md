# Sandbox Gateway

Status: superseded. The legacy cloud sandbox stack this document describes
was deleted by the cull sweep (delivery/cull-sweep/delivery-spec-delete-dark-cloud.md,
part 2): sandboxes, workspaces, materialization, secrets, the runtime gateway,
and the billing reconciler are gone. Kept for the design record until the
environments system spec replaces it; the code map below no longer resolves.

Status: target. This document describes the accepted destination for the
wire between product clients and a cloud sandbox's runtime. The body is
written in the ideal state. Every difference from `main` today is listed in
[Current gaps](#current-gaps); the list shrinks as follow-up PRs land, and
the label comes off when it is empty.

## Purpose

The sandbox gateway owns the wire: how product bytes reach the AnyHarness
runtime inside a user's cloud sandbox, and which traffic deliberately never
takes that wire. It is one HTTP+WebSocket proxy route on the Cloud server
that swaps the caller's product credential for the sandbox's runtime
credential and forwards — nothing more. Everything the wire carries is
someone else's contract.

Fences, one owner per concern:

- Whether a caller *may* reach a sandbox — capability, billing, and
  readiness gating as the client experiences it — belongs to
  [access.md](access.md), including the client-side
  choreography, retry policy, and token provider. This document owns the
  wire those checks guard; where both docs touch the same seam (the 402,
  the 409, the 60 s access cache), access owns the caller-facing
  representation and this document owns the server-side mechanism.
- The lifecycle consequence of traffic (a paused VM waking under a
  forwarded request) belongs to
  [lifecycle.md](lifecycle.md): the gateway gates on
  policy, E2B wakes on traffic, materialization repairs.
- What answers on the far end — the AnyHarness HTTP API, sessions,
  terminals, worktrees — belongs to the AnyHarness structure docs
  ([specs/anyharness/README.md](../../anyharness/README.md)).
  The gateway is path-blind: it forwards `{path}` verbatim.
- Model inference traffic never touches this wire or this server;
  [specs/FEATURE_DOCS/MODELS.md](../MODELS.md) owns that plane.
- The integration gateway — AnyHarness calling *into* Cloud as an MCP
  client — is the reverse direction and belongs to
  [../../codebase/platforms/product/integrations.md](../../codebase/platforms/product/integrations.md); it appears here only in the
  proxied-vs-direct map.
- GitHub credentials on the sandbox belong to
  [github-auth.md](github-auth.md).

## The wire, one picture

```text
product client                    Cloud server                     E2B VM
─────────────────────────────────────────────────────────────────────────
AnyHarnessClient ── product JWT ──▶ /v1/gateway/cloud-sandbox/anyharness/{path}
                                    │ resolve the caller's sandbox for the
                                    │   request's org context
                                    │ billing gate (402 if held)
                                    │ load runtime access (409 if absent)
                                    │ swap: strip product auth,
                                    │       attach runtime bearer
                                    └──────── Bearer <runtime> ──▶ AnyHarness :port
```

One route serves every method and both transports
(`gateway/api.py` (deleted, cull part 2),
mounted at `/v1/gateway` in
[main.py](../../../server/proliferate/main.py)):

- `api_route("/cloud-sandbox/anyharness/{path:path}")` — GET, POST, PUT,
  PATCH, DELETE, HEAD, OPTIONS; authenticated by the standard product-user
  dependency (the product session JWT).
- `websocket("/cloud-sandbox/anyharness/{path:path}")` — the same product
  JWT, delivered WebSocket-fashion: preferred as the
  `proliferate-gateway-bearer` subprotocol pair, `Authorization` header
  accepted (`gateway/access.py` (deleted, cull part 2)).
  Auth failure closes 1008 before any upstream connection exists.

There is no sandbox id in the URL and no way to name one: the gateway
always resolves *the caller's own sandbox*
(`gateway/service.py` (deleted, cull part 2)
→ `cloud_sandboxes/service.py` (deleted, cull part 2)),
keyed by owner plus the request's org context (which workspace's traffic
this is — lifecycle's per-(user, org) account model). Reaching someone
else's sandbox is unrepresentable on this wire, not merely forbidden.

## The wire laws

- **The client never learns the sandbox's address.** The E2B host URL and
  the AnyHarness bearer live only in the `cloud_sandbox` row (encrypted at
  rest, decrypted at forward time,
  `db/store/cloud_sandboxes.py` (deleted, cull part 2));
  the resolved access object never crosses the API boundary. A leaked
  product token is revocable (`token_generation` bump); a leaked runtime
  bearer would be a direct line to the VM, so no client ever holds one.
- **One wire.** Every product byte to a cloud runtime — REST, chat SSE,
  terminal WebSocket, file reads, worktree inventory, on web, desktop, and
  mobile — crosses this one route. There is no second proxy and no
  side-channel; direct-to-E2B exists only in release-test tooling.
- **The swap is total.** Inbound `authorization`, `cookie`, and hop-by-hop
  headers are stripped; the runtime bearer is attached fresh
  (`gateway/proxy.py` (deleted, cull part 2)).
  Inbound `access_token` query params are stripped on HTTP; on WebSocket
  the *upstream* URL carries the swapped runtime token as `access_token`
  because the runtime authenticates sockets that way. Nothing the client
  sent can impersonate anything upstream.
- **No database across the stream.** The auth/access transaction commits
  before the proxy enters the transport lifetime — a chat stream can stay
  open for hours and must not pin a pool checkout or a sandbox lock. Both
  routes carry the comment and a dedicated test pins the ordering
  (`test_cloud_sandbox_gateway_transaction_lifetime.py` (deleted, cull part 2)).
- **The gateway gates on policy, not liveness.** It refuses when the
  caller may not reach the sandbox (billing hold → 402) or when runtime
  access was never materialized (→ 409); it does not check whether the VM
  is awake. A paused VM's address stays valid, so forwarded traffic wakes
  it (E2B `auto_resume`) — forwarding is the wake, per lifecycle's ruling.
- **Same client on both sides of the wire.** A gateway connection is the
  ordinary AnyHarness client with a different base URL and token
  ([client-cache.ts](../../../anyharness/sdk-react/src/lib/client-cache.ts));
  `runtimeAccessKind: "direct" | "proliferate-gateway"` is display
  metadata, never a behavioral branch in the client. This is what keeps
  every runtime feature cloud-capable by construction.

## Access resolution and the bearer swap

`ensure_cloud_sandbox_gateway_access` resolves per request
(`gateway/service.py` (deleted, cull part 2)):

1. Billing gate: an exhausted owner is refused before any row is staged
   (402, `billing_credits_exhausted` | `billing_start_blocked`, with
   `decision_type`/`reason` detail —
   ``billing/authorization.py`` — deleted in #2243, dark cloud-billing authorizer).
   Successful decisions are cached for at most 5 seconds because the
   authorizer builds the full billing snapshot and evaluates compute
   budgets; denials are never cached.
2. Ensure the sandbox row exists, committed before access resolves (rows
   are free; ensure never provisions — lifecycle's law. The early commit
   keeps the sandbox id stable across the 409 rollback below, so repair
   claims dedupe).
3. Load runtime access: `anyharness_base_url` plus the bearer and data-key
   ciphertexts. Any of the three missing is a typed 409
   `cloud_sandbox_runtime_not_ready`, and that cold resolution also
   schedules the one background materialization that repairs the row —
   the mechanism, its stampede guards, and its tradeoffs are lifecycle's
   cold-access law ([lifecycle.md](lifecycle.md)), not
   restated here. The gateway never provisions and never waits: it
   schedules and returns the 409; what the caller sees while the repair
   runs is [access.md](access.md)'s contract.
4. Cache the resolved access per user for 60 seconds behind a per-user
   asyncio lock, so a burst of parallel requests (a workspace opening
   chat, files, and terminals at once) resolves once. Every transition
   that clears or retires runtime access invalidates this entry
   immediately. (Failures are never cached, so the repair trigger sits on
   the cache-miss path by construction.)

The swap itself is mechanical: HTTP gets `Authorization: Bearer <runtime>`;
WebSocket gets the runtime token as the upstream `access_token` query
param. The data key rides the same columns but is not the gateway's — the
materialization connect path consumes it.

## Streaming

The proxy's transport settings encode one intent: **streams may be
infinite, handshakes may not.**

- HTTP: `httpx` with connect 10 s, write 30 s, pool 10 s, and read
  *unbounded* — a session SSE stream is a legitimately infinite response.
  Responses stream chunk-through (`stream=True`, raw iteration), and a
  cleanup-response subclass guarantees the upstream client closes even
  when the downstream client vanishes mid-stream. A client disconnect
  before the body is read returns 499.
- SSE half-close: exactly one upstream protocol error — the pinned h11
  "incomplete chunked read" message on a `text/event-stream` response —
  is treated as end-of-stream instead of an error, because the session
  client reconnects from its durable `after_seq` and a retry inside an
  already-started response could replay bytes. The string match is pinned
  to the locked h11/httpcore/httpx versions and guarded by a regression
  test.
- WebSocket: full bidirectional pump — two tasks, first-completed cancels
  the other; upstream connect times out at 10 s; 20 s ping keepalive both
  directions; upstream close codes propagate to the client; anything
  unexpected closes 1011.

What rides which transport is the runtime's contract, not the gateway's,
but the two that matter: chat is **SSE over plain HTTP** (
[sdk/streams/sessions.ts](../../../anyharness/sdk/src/streams/sessions.ts)
fetches `/v1/sessions/{id}/stream` with an `accept: text/event-stream`
header — same bearer, no upgrade), and terminals are **real WebSockets**
([sdk/streams/terminals.ts](../../../anyharness/sdk/src/streams/terminals.ts))
with the auth transport pivot: `"query"` against a local runtime,
`"protocol"` (the `proliferate-gateway-bearer` subprotocol) through the
gateway, because a browser cannot set headers on a WebSocket and a token
in a URL would cross infrastructure logs.

## The client contract

Resolution from a cloud workspace to a live connection is one chain
([cloud-sandbox-gateway.ts](../../../apps/packages/product-client/src/lib/access/cloud/cloud-sandbox-gateway.ts),
`workspace-connection-retry.ts`):

1. `GET /v1/cloud/workspaces/{id}` — the product record
   ([content.md](content.md), one workspace, two records).
2. Guard: no stamped `anyharnessWorkspaceId` is a typed client-side 409
   `workspace_not_ready` — the retryable "still materializing" signal.
3. Mint the gateway token — the product session token through the
   host-armed provider pointer; the token model, its refresh semantics,
   and the retry policy (what retries, how often, how long) are
   [access.md](access.md)'s contract, not restated here.
4. The connection object: gateway base URL, the token, workspace id,
   `runtimeAccessKind: "proliferate-gateway"`,
   `webSocketAuthTransport: "protocol"`. Every consumer renames
   `accessToken` → `authToken` and hands it to the same generic client.
   Nothing else rides it — in particular no generation counter: staleness
   after a VM replacement is handled by re-resolution on failure, not by
   a version field (gap below).

Long-open transports re-resolve on failure — a terminal socket dropping
invalidates the cached connection and refetches; chat SSE reconnects with
exponential backoff capped at 15 s from its last durable sequence. Before
any fresh connect, `withFreshCloudSandboxGatewayAccessToken` re-mints just
the token, so a cached-but-stale credential never opens a socket.

## Proxied vs direct

Every channel that crosses the sandbox boundary, and why it is on the
side it is on:

| Channel | Direction | Wire | Why |
| --- | --- | --- | --- |
| AnyHarness API, chat SSE, terminal WS, files, worktrees | client → sandbox | **Proxied** (this route) | Clients must never hold the sandbox address or runtime bearer |
| Model inference | agent in sandbox → LiteLLM | **Direct** (public LiteLLM URL + per-user virtual key via `state.json`) | Inference bytes never touch the API server; keys are budgeted per user ([specs/FEATURE_DOCS/MODELS.md](../MODELS.md)) |
| Git fetch/push | sandbox → GitHub | **Direct** (HTTPS + credential-helper lease) | The helper reads a local token file, no network hop through Cloud ([github-auth.md](github-auth.md)) |
| Integrations (Slack, Linear, …) | agent in sandbox → Cloud MCP endpoint → provider | **Proxied inbound** (`/integration-gateway/mcp`, gateway grant token) | Third-party OAuth tokens never enter the sandbox; Cloud executes the provider call ([../../codebase/platforms/product/integrations.md](../../codebase/platforms/product/integrations.md)) |
| Materialization scripts | server → sandbox | **E2B exec channel** (provider SDK, API key) | Control plane; server-only credentials ([lifecycle.md](lifecycle.md)) |
| Lifecycle events + compute usage | E2B → server | **Signed webhooks** (HMAC) | Provider truth arrives pushed and verified |
| LLM spend | server → LiteLLM control plane | **Server-side pull** (`/spend/logs`, master key) | Nothing inside the sandbox reports usage |

The asymmetry has one rule under it: **credentials stay where they are
revocable.** The runtime bearer stays on the server, provider OAuth tokens
stay on the server, the LiteLLM virtual key goes to the sandbox because it
is per-user, budgeted, and individually killable, and the GitHub lease
goes to the sandbox because it is short-lived and scoped. Direct attach to
the managed cloud sandbox (client → VM without the server in the path) is
not built and not scheduled: the claiming substrate that would have
authorized it was reverted (#803), and nothing today needs the server out
of the data path.

## Code map

```text
server/proliferate/
├── main.py                                   mounts /v1/gateway
├── server/cloud/gateway/
│   ├── api.py                                HTTP + WS routes, commit-before-stream
│   ├── access.py                             WS product-token auth (subprotocol/header/query)
│   ├── proxy.py                              header swap, streaming pumps, SSE guard
│   └── service.py                            access resolution + 60 s per-user cache
├── server/cloud/cloud_sandboxes/service.py   billing gate, ensure row, runtime-access load
└── db/store/cloud_sandboxes.py               access columns: stamped by materialization,
                                              cleared by reset/provider-loss
apps/packages/product-client/src/
├── lib/access/cloud/
│   ├── cloud-sandbox-gateway.ts              connection resolution + token refresh
│   ├── sandbox-gateway-access.ts             host-armed token pointer
│   └── workspace-connection-retry.ts         typed retry policy (8 retries × 750 ms)
└── providers/CloudAnyHarnessRuntimeProvider.tsx  per-request bearer injection
anyharness/sdk/src/streams/
├── sessions.ts                               chat SSE (header auth, after_seq resume)
└── terminals.ts                              terminal WS (query | protocol auth transport)
apps/mobile/src/lib/access/anyharness/cloud-sandbox-runtime.ts  mobile resolver
```

## Failure modes

- Runtime access not materialized: typed 409
  `cloud_sandbox_runtime_not_ready`; the cold resolution schedules the
  repair materialization (lifecycle's cold-access law), so retrying the
  409 converges instead of looping.
- Billing hold: typed 402 before any forward; the VM is never touched.
- Upstream unreachable (VM killed, host stale): typed 502
  `cloud_sandbox_gateway_unreachable`; the client's connection refetch
  re-resolves through the row, which provider-loss handling has by then
  reset ([lifecycle.md](lifecycle.md)).
- Paused VM: not a failure — the forwarded request wakes it; the first
  request pays roughly a second of resume latency.
- Provisioning unconfigured (self-host without E2B): typed 503
  `e2b_template_not_configured`.
- Bad product token: HTTP 401 via the standard dependency; WebSocket
  closes 1008 pre-upstream.
- Client vanishes mid-request: 499 before the body, guaranteed upstream
  cleanup mid-stream.
- Upstream WS dies: its close code propagates; unexpected proxy errors
  close 1011; the client's stream registry reconnects through a fresh
  resolution.

## Proof

- Proxy mechanics (swap, stripping, streaming, SSE guard):
  `test_cloud_sandbox_gateway_proxy.py` (deleted, cull part 2).
- Access resolution and cache:
  `test_cloud_sandbox_gateway_service.py` (deleted, cull part 2),
  `test_cloud_sandbox_gateway_access.py` (deleted, cull part 2).
- Cold access schedules exactly one repair (sequential polling and
  concurrent callers, destroyed rows excluded, ready rows untouched):
  `test_cloud_sandbox_cold_access_repair.py` (deleted, cull part 2).
- Commit-before-stream ordering:
  `test_cloud_sandbox_gateway_transaction_lifetime.py` (deleted, cull part 2).
- WS Sentry-context hygiene:
  `test_cloud_sandbox_gateway_ws_sentry.py` (deleted, cull part 2).
- Client connection contract:
  [cloud-sandbox-gateway.test.ts](../../../apps/packages/product-client/src/lib/access/cloud/cloud-sandbox-gateway.test.ts).

Corridor F — wire deletions and budgets. Named, binary assertions; the
corridor is done when they are green. IDs are stable — tests reference
them by name:

- **F1** `runtimeGeneration` is deleted end to end — wire payloads,
  the access dataclass, client cache keys, the store constant; grep-gate
  on both spellings outside migrations. The client tests keyed on it are
  deleted, not kept green.
- **F2** The two retry budgets hold: 2 s × 45 for
  `cloud_sandbox_runtime_not_ready`, 750 ms × 8 for
  `workspace_not_ready` —
  `workspace-connection-retry.test.ts`
  survives ([access.md](access.md)'s client contract).
- **F3** A WebSocket offering only `?access_token=` closes 1008; the
  subprotocol is the only accepted transport; the legacy-acceptance test
  is deleted. (gateway pytest)
- **F4** Mobile consumes the shared connection resolver and capability
  parser; grep-gate: the duplicate mobile resolver stays deleted.
  (frontend tests)
- **F5** Resolution takes the request's org context; another user's —
  or another org's — sandbox stays unrepresentable. (pytest; lands with
  lifecycle's E3)

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] Gateway resolution has no org-context input: it resolves the
      caller's single per-user sandbox only, which is consistent with
      today's one-sandbox-per-user account model but not with the ruled
      per-(user, org) model; the resolution seam grows the context input
      with lifecycle's account-model migration
      ([lifecycle.md](lifecycle.md)).
- [ ] `runtimeGeneration` still exists as a hardcoded-0 field: serialized
      on sandbox payloads
      (`cloud_sandboxes/models.py` (deleted, cull part 2)),
      carried on `CloudSandboxGatewayAccess`, stamped as a constant by the
      store, and baked into client cache keys (worktree query keys, the
      materialization cache, terminal stream controller) where it can
      never vary. Delete it end to end — wire field, dataclass, client
      keys, store constant — and grep-gate the name. Ruling: staleness
      after VM replacement is already handled by re-resolution on
      failure; a version field nobody bumps is dead weight.
- [ ] WebSocket auth still accepts `?access_token=` inbound
      (`gateway/access.py` (deleted, cull part 2),
      kept as legacy); product tokens do not belong in URLs. Clients all
      send the subprotocol transport now — drop the query path.
- [ ] Mobile duplicates the connection resolver
      ([cloud-sandbox-runtime.ts](../../../apps/mobile/src/lib/access/anyharness/cloud-sandbox-runtime.ts))
      instead of sharing product-client's, so the wire contract (path
      constant, connection shape, retry policy) exists twice. Fold it
      into the shared resolver.
