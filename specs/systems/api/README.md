# API

Status: target. The agent-first `/v1` front door does not exist on `main`;
the body is written in the ideal state and [Current gaps](#current-gaps) is
the whole build. Source: Core Architecture §5 (API surface), the
agents-are-clients law, and the primitives index.

## 1. Purpose

One public contract through which humans, CI, the Slack app, the CLI, and
agents create and steer work. Product MCP and the CLI are thin veneers over
it; the GitHub Action is just a caller with `--wait`. Agents are the
highest-volume, worst-behaved clients, so the contract is built for them
first: self-teaching, typed, idempotent, blocking where they need to block,
and rate/spend-limited as part of the contract rather than despite it.

## 2. Owned state

| Table | Rows mean | Key fields |
| --- | --- | --- |
| `api_token` | one bearer credential | `id`, `organization_id`, `subject` (user \| service), `hash` (never the token), `scopes[]`, `budget_envelope`, `expires_at`, `parent_token_id` (delegation chain), `revoked_at`, `last_used_at` |
| `idempotency_key` | one create request's identity | `(token_id, key)`, canonical request hash, `resource_ref`, `expires_at` |
| `device_code` | a pending human/CLI login | code pair, `expires_at`, resolved subject |

## 3. Public surface

Frozen at `/v1`; additive only. Eight verbs:

| Verb | Route | Notes |
| --- | --- | --- |
| Mint token | `POST /v1/tokens` | device-code flow for humans; **delegation** from any authed context mints a child token with narrower scopes, smaller envelope, earlier expiry |
| Create run | `POST /v1/runs` | idempotency key required; body = definition ref or ad-hoc prompt, arguments, placement hints, envelope request, `parent_run_id` implied by the caller's run context |
| Get run | `GET /v1/runs/{id}` | status, envelope remaining, spawn edges |
| Wait run | `GET /v1/runs/{id}/wait?timeout=` | blocks until terminal or timeout; returns the run + result when terminal |
| Cancel tree | `POST /v1/runs/{id}/cancel` | cancels descendants first |
| Send prompt | `POST /v1/runs/{id}/prompts` | appended to the run's session through the courier; idempotent on key |
| List runs | `GET /v1/runs?…` | org-scoped, filter by subject / definition / status / parent |
| Get result | `GET /v1/runs/{id}/result` | the immutable result document |

Plus the agent-first bar:

- `GET /v1/agent` — a self-teaching prose document: the verbs, the error
  taxonomy with remediation strings, the token model, worked examples.
  Readable with a bare token; the same text ships as the **skill file**
  (`catalogs/skills/…`) so a markdown snippet dropped into any repo lets an
  existing Claude Code / Codex hire Proliferate cloud agents.
- Typed errors: `{code, message, remediation, retryable}`; every `4xx` names
  the verb that fixes it.
- Idempotency keys on every create; replays return the original resource.
- Blocking `wait` verbs; no client-side polling loops required.
- Rate limits (per token) and spend limits (per envelope) returned in
  headers on every response.

Veneers, same contract: `proliferate` CLI and `proliferate mcp`
(`apps/cli/`, one binary); the GitHub Action.

## 4. Consumes

| Dependency | Owner | Used for |
| --- | --- | --- |
| `create_run`, `wait_run`, `cancel_tree`, `record_result`, `attenuate` | [runs.md](../automations/runs.md) | every run verb |
| invocation freeze + canonical identity | [automations.md](../automations/README.md) | `POST /v1/runs` normalizes into the same frozen invocation as every trigger |
| courier | seam (target) | prompt delivery into a running session |
| subjects, org membership, service subjects | accounts / organizations | token subjects |
| spend / credit | billing ([BILLING.md](../billing/deep-dive.md)) | envelope enforcement at the billing gate |
| existing error base | [api_errors.py](../../../server/proliferate/server/api_errors.py), [errors.py](../../../server/proliferate/errors.py) | the typed-error envelope grows a `remediation` field |
| existing route auth | [auth/dependencies.py](../../../server/proliferate/auth/dependencies.py) | bearer resolution gains an `api_token` path beside product-user JWTs |

## 5. Laws

**Agents are clients.** No internal channel does anything a token cannot;
a run spawning a child hits this API with a delegated token. This is what
makes every use case land as rows and endpoints on one lane.

**Delegation only attenuates.** A child token's scopes ⊆ parent's, envelope
≤ parent's remaining, expiry ≤ parent's. `attenuate` (runs) is the one
function; a token cannot mint more than it holds.

**Tokens are hashed, scoped, expiring, revocable.** The plaintext is shown
once at mint; revoking a parent revokes its delegation chain.

**Every create is idempotent.** Same key + same canonical body → the
original resource (`200`); same key + different body → `409`. Keys expire.

**Errors carry their remediation.** A typed error names the verb or setting
that fixes it; a bare status code is a bug filed against this spec.

**`/v1` is frozen.** New capability is a new verb or an additive field;
never a changed meaning. Breaking changes are `/v2`.

**Limits are part of the contract.** Rate and spend headers on every
response; a refused request says which limit and when it resets.

## 6. Emits

`token.minted`, `token.delegated`, `token.revoked`, `api.request`
(audited: token, verb, resource, outcome, limit state). Consumed by billing
(spend), the runs triage projection, and security review.

## 7. Fences

| Not owned here | Owner |
| --- | --- |
| Run semantics, envelope math, results, spawn tree | [runs.md](../automations/runs.md) |
| Product MCP *inside* an environment (subagent tools, workspace tools) | runtime `subagents` / product MCP — a different surface; it may *call* this API |
| Human sign-in, sessions, refresh tokens | product auth ([auth/README.md](../identity/accounts.md)) |
| Machine-access proxy (terminals, files, previews) | runtime gateway (target) |
| Company-system tools and grants | integration gateway (target) |
| The Slack app's webhooks and thread bindings | product Slack (target) — a caller of this API |

## 8. Code map

Target locations (※ new):

```text
server/proliferate/server/api/          ※ MANIFEST · api.py (the eight verbs + /v1/agent)
                                           · tokens/ (mint, delegate, revoke, device code)
                                           · idempotency.py · limits.py · errors.py · agent_doc.md
server/proliferate/db/models/api.py     ※ api_token · idempotency_key · device_code
apps/cli/                               ※ `proliferate` + `proliferate mcp`, veneer only
catalogs/skills/proliferate-api/        ※ the skill file (same text as GET /v1/agent)
```

Adjacent code the build reuses: the JWT/bearer plumbing in
[auth/jwt.py](../../../server/proliferate/auth/jwt.py) and
[auth/dependencies.py](../../../server/proliferate/auth/dependencies.py); the
`CloudApiError` envelope in
[api_errors.py](../../../server/proliferate/server/api_errors.py); the
validation-error redaction in [main.py](../../../server/proliferate/main.py).

## 9. Proof

Pinning tests to write with the system: delegation cannot widen any axis
(property test over scopes/envelope/expiry); revoking a parent revokes the
chain; idempotent create under concurrency; `wait` returns at terminal or
timeout, never hangs; every error response validates against the typed
envelope and carries `remediation`; `GET /v1/agent` renders the same text as
the skill file (snapshot); rate-limit headers present on every route.

## Current gaps

The entire system is a gap. It is step 4 of the build order and the piece
Friday's GitHub Action reuses wholesale.

> [!decision] PABLO DECIDES: token storage — a new `api_token` table with
> opaque hashed bearers (recommended: scopes, envelope, expiry and delegation
> chain are first-class columns; revocation is a row update) vs stateless
> JWTs with claims (rejected: delegation chains and revocation need state).

> [!decision] PABLO DECIDES: human token mint — device-code flow (recommended:
> works for CLI and CI, no browser callback into a terminal) vs reuse the
> desktop OAuth loopback.

> [!decision] PABLO DECIDES: the verb list is frozen at these eight for `/v1`
> (recommended) or grows definition CRUD now (rejected: definitions stay a
> product-UI concern until the marketplace ruling).

> [!decision] PABLO DECIDES: route prefix — `/v1/...` at the API origin
> (recommended; the agent-facing surface should not carry the internal
> `/v1/cloud/` history) vs the existing `{api_prefix}/v1` mounting.

> [!decision] PABLO DECIDES: `GET /v1/agent` authored by hand in
> `agent_doc.md` and served verbatim (recommended: prose quality is the
> product) vs generated from OpenAPI.
