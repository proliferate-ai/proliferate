# Delivery specification: integration lifecycle PR2 — stage, swap, and management

Status: frozen delivery specification.
Approved design: integration connection lifecycle ADR, decisions 1–4;
high-level sequencing PR2.
Base revision: squash-merged integration lifecycle PR1 at
`2f5e62a41e84a18741730efeed3d1c7417344a10`.

## Outcome

Connecting or replacing integration credentials is attempt-owned and
stage-and-swap. Failed, cancelled, expired, superseded, or stale work cannot
create a first connection or damage a working one. The server exposes one
authoritative management item and action set per visible definition while the
legacy catalog, health, authentication, OAuth-flow, and account routes remain
available during the ProductClient compatibility window.

## Scope

- Add transactional authorization-attempt mutations with one
  owner+definition advisory lock: supersede prior non-terminal generations,
  create the next generation, advance state, clear staged ciphertext on every
  terminal path, and commit only the current generation.
- Lazily create an immutable definition-security revision when the current
  auth kind, client mode, or serialized launch/auth config differs from the
  latest snapshot. Every new attempt pins it.
- Change first OAuth connect to create only an attempt and flow. Reauthorize
  keeps the committed account ready and unchanged while browser work is
  pending. Bind the flow to the attempt and pin the exact active OAuth-client
  record, normalized resource audience, requested scopes, and settings.
- Exchange OAuth codes outside the commit transaction. Validate the callback
  against the attempt's pinned definition/client/audience and requested
  scopes, stage only encrypted credential material, then atomically create or
  replace the account if generation and starting account versions still
  match. A stale callback fails closed and cannot commit.
- Add a typed `credential_validation` definition field. Current API-key seeds
  declare harmless MCP `tools/list` validation. Stage the encrypted key and
  settings on an attempt, validate without persisting a connection mutation,
  then atomically swap; providers without an approved validator fail closed.
- Create and immediately succeed an attempt for explicit no-auth bindings so
  all first connections use the same commit boundary.
- Add `GET /v1/cloud/integrations/management` and
  `POST /v1/cloud/integrations/authorization-attempts/{attempt_id}/cancel`.
  Management returns availability, committed connection/health, latest
  attempt, authorization URL when reopenable, and exactly one primary action
  plus allowed secondary actions. It expires stale work by server time.
- Keep Slack unavailable in both management and start unless the PR0
  deployment/distribution gate is satisfied. Existing connections remain
  visible and disconnectable regardless of provider availability.
- Extend and regenerate the Cloud SDK contract. The legacy authentication
  response makes `account` nullable for a first OAuth attempt and adds the
  attempt identity; existing ProductClient OAuth code does not depend on the
  account field.

## Lifecycle contract

- Start discovery/validation may perform provider I/O before taking the short
  commit lock, but no database transaction is held across that I/O.
- `connect` starts without an account or versions. `reauthorize` and `rotate`
  pin the committed account plus its starting grant and credential versions.
- Starting generation N supersedes every older non-terminal attempt and its
  active OAuth flow. Only N may commit.
- OAuth callback claim moves attempt and flow to exchanging. Candidate scope,
  audience, definition revision, and OAuth-client revision must equal the
  pinned values before commit.
- API-key validation moves the attempt to validating; validation failure
  terminalizes it with a product-safe code and destroys staged ciphertext.
- A first success creates one ready account. Replacement success swaps
  ciphertext, settings, revision pins, audience, and effective scopes and
  advances the legacy/grant/credential versions together during this
  compatibility slice. PR3 separates their semantics.
- Terminal attempt statuses have a close time and no staged ciphertext.
  Terminal OAuth flows remain readable through the legacy flow endpoint.
- Management action precedence is: unavailable/disabled → no primary;
  non-terminal OAuth attempt → open authorization; other non-terminal attempt
  → no primary; no connection → connect; unhealthy connection → reconnect;
  healthy connection → no primary. Cancel and disconnect are independent
  secondary actions when valid.

## Non-goals

- No runtime grant/credential split, refresh CAS change, per-operation
  admission, disconnect cutoff, upstream revocation, synthetic readiness
  scheduler, production deploy, or ProductClient visual migration.
- No live-provider test, customer credential, provider write, or browser
  automation. Tier 2 stops before authentication routes that perform provider
  I/O; tier-1 server tests mock the provider validation boundary.
- No removal of legacy routes, `auth_version`, `setup_required` compatibility
  reads, or old flow response fields.

## Acceptance

- Real-Postgres HTTP tests prove failed first OAuth and API-key connects create
  no account; failed replacements preserve account ciphertext, versions,
  settings, status, and pins byte-for-byte.
- Interleaving tests prove a newer generation supersedes an older flow and a
  late callback cannot overwrite the winner. A starting-version mismatch also
  rejects commit.
- OAuth success pins the exact definition/client/audience/scope snapshots and
  first success creates the account only at callback commit.
- API-key validation uses the declared harmless operation, commits only after
  success, and clears staged secret material on both success and failure.
- Cancel, expiry, reload, provider-unavailable, org-disabled, ready,
  needs-reauth, and replacement-pending management fixtures each return the
  frozen action matrix without secret fields or contradictory actions.
- Legacy OAuth flow status/cancel and callback browser-safe error behavior stay
  green; existing catalog/health clients remain valid.
- Cloud SDK generation is clean; focused unit/integration tests, server lint
  and type diagnostics, boundary/docs/max-lines/design-attribution checks, and
  `git diff --check` pass.
