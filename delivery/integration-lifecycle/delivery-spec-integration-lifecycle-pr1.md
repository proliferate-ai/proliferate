# Delivery specification: integration lifecycle PR1 — additive lifecycle schema

Status: frozen delivery specification.
Approved design: integration connection lifecycle ADR, decisions 1, 4, and 5;
high-level sequencing PR1.
Base revision: integration lifecycle PR0 squash-merged at
`12518cb173d74bec51ea31c1aa7bd29a976dc74e`.

## Outcome

The database can represent authorization work separately from committed
connections and can pin the revisions under which a connection was granted.
This slice is additive and inert: existing endpoints, OAuth callbacks, refresh,
gateway use, and disconnect keep their current behavior until later slices
adopt the new records.

## Scope

- Add an immutable `cloud_integration_definition_security_revision` table.
  Each row captures one definition's security-relevant auth kind, OAuth-client
  mode, and serialized launch/auth configuration under a monotonic revision.
- Add lifecycle fields to OAuth clients: monotonic `revision` and
  `lifecycle_state` (`candidate`, `active`, `retiring`, or `retired`). Preserve
  all current rows as active revision 1. Replace the old mutable-key uniqueness
  constraint with revision uniqueness plus a partial unique index allowing at
  most one active revision per definition, issuer, and redirect URI.
- Add `cloud_integration_authorization_attempt` with owner, definition,
  optional current connection, purpose, method, monotonic generation, terminal
  state, expiry, starting grant/credential versions, pinned definition/client
  revisions, normalized credential audience, non-secret settings and scope
  snapshots, staged encrypted credential fields, failure code, and timestamps.
  Enforce one generation per owner+definition and at most one non-terminal
  attempt for that pair.
- Add nullable `attempt_id` to OAuth flows so later code can bind browser work
  to the domain attempt while the legacy `account_id` path remains valid.
- Add `grant_version`, `credential_version`, pinned definition/client revision,
  normalized audience, and effective-scope snapshot to integration accounts.
  Backfill both new versions from the existing `auth_version`; leave revision
  pins nullable for the explicit legacy-compatibility window.
- Add ORM models and store-record projections for the new schema without
  changing read/write behavior.
- Add typed server management response models for provider availability,
  committed connection, current attempt, and one primary plus secondary
  actions. Do not expose a route or assemble responses in this slice.

## Schema contract

- Attempt purpose: `connect`, `reauthorize`, `rotate`.
- Attempt method: `oauth2`, `api_key`, `none`.
- Attempt status: `active`, `exchanging`, `validating`, `succeeded`, `failed`,
  `cancelled`, `expired`, `superseded`.
- Non-terminal attempt statuses are `active`, `exchanging`, and `validating`.
- A staged credential is never plaintext; ciphertext and format are both null
  or both non-null.
- Every attempt pins a definition-security revision and non-empty normalized
  audience. Connect attempts have no account or starting versions; replacement
  attempts require all three. Non-terminal states have no `closed_at`, while
  every terminal state has one. Deleting a connection cascades its replacement
  attempts rather than violating their required account binding.
- Management primary actions are `connect`, `reconnect`,
  `open_authorization`, or `none`; secondary actions are `cancel` and
  `disconnect`.
- Existing `auth_version`, account statuses, OAuth-flow statuses, API schemas,
  and foreign-key delete behavior remain unchanged.

## Non-goals

- No attempt creation, stage-and-swap, callback CAS, refresh-version split,
  per-operation admission, disconnect cutoff, revocation, provider probe, or UI
  behavior.
- No destructive migration, legacy placeholder cleanup, SDK regeneration, or
  production deploy.
- No new feature flag: absence of call sites keeps the schema dark.

## Acceptance

- A real-Postgres migration upgrade from the prior head preserves representative
  definitions, OAuth clients, flows, and accounts while producing the expected
  lifecycle backfill.
- A downgrade restores the prior schema and preserved legacy values.
- Database constraints reject duplicate attempt generations, concurrent
  non-terminal attempts, invalid states, invalid staged-secret pairs, and two
  active OAuth-client revisions for the same key.
- ORM metadata and schema assertions include every new table, column, index,
  constraint, and foreign key.
- Store-record unit tests prove new persisted fields are projected without
  exposing or decrypting secret material.
- Focused unit/integration tests, migration-head validation, server boundary
  checks, documentation checks, Ruff, mypy on changed modules, and
  `git diff --check` pass.
