# Delivery specification: integration lifecycle PR3 — admission, cutoff, and revocation

Status: frozen delivery specification.
Approved design: integration connection lifecycle ADR, decisions 4–6;
high-level sequencing PR3.
Base revision: integration lifecycle PR2 squash-merged at
`3b602dbe754163082dd37d48152636e0e8c06259`.

## Outcome

Every gateway provider operation is admitted from the current committed
connection under its database lock before provider I/O. Authority changes and
credential rotations have independent monotonic versions. Disconnect makes
local use impossible in one transaction, invalidates reusable authority, and
retains only bounded encrypted material for asynchronous upstream revocation.

## Scope

- Make `grant_version` the authority binding for tool-schema caches and action
  approvals. Rename their application-level persisted and wire snapshots from
  auth version to grant version while preserving values, but keep the PR2
  physical column names and deprecated response alias through the mixed-version
  rollout window so N-1 server tasks and clients remain compatible. Regenerate
  the Cloud SDK with both response fields; PR5 owns removing the compatibility
  alias after qualification.
- Keep legacy `auth_version` as the compatibility revision. Credential refresh
  always advances `credential_version` and `auth_version`; it advances
  `grant_version` only for a legitimate effective-scope narrowing. Attempt
  replacement always advances the credential revision and advances the grant
  revision only when definition/client/audience/scope/settings authority
  changes.
- Add credential-version compare-and-swap for OAuth refresh. A losing refresher
  reloads the committed winner only when the admitted grant and pinned
  authority are unchanged. Client/issuer/audience/scope expansion, disconnect,
  or replacement loses closed without persisting stale credentials.
- Add a short-lived in-memory operation lease created under the committed
  account row lock. Admission verifies owner, ready/enabled state, visible
  definition, effective org policy, active membership for org-scoped grants,
  pinned definition security shape, and pinned OAuth-client identity/lifecycle.
  The request transaction is committed before any token or MCP network call.
- Use admission for gateway `tools/list` and `tools/call`. Bind cache reads and
  post-I/O writes to `grant_version`; a cutoff after admission may let already
  started I/O finish but cannot recreate a cache or other reusable authority.
  Persistent MCP sessions receive no bypass.
- Replace account deletion with one cutoff transaction that acquires the same
  owner+definition lifecycle lock, supersedes nonterminal attempts, cancels
  active flows, revokes active approvals, deletes the tool cache, creates a
  revocation receipt/job when applicable, deletes the account, and enqueues the
  job through the transactional background outbox.
- Add a `cloud_integration_revocation_job` with issuing definition/client
  snapshots, bounded encrypted revocation material, safe status/error fields,
  attempt timestamps, and a hard 24-hour deadline. No plaintext token enters
  the database, broker payload, logs, or telemetry.
- Add standard OAuth token revocation plus the Slack user-token revocation
  surface. OAuth discovery/config may supply a revocation endpoint; providers
  without one terminalize as unsupported after local destruction. The worker
  uses the issuing provider-client revision, retries safe provider failures,
  and destroys ciphertext on success, unsupported completion, or deadline.

## Lifecycle contract

- Admission linearizes with disconnect on the account row. A request whose
  admission lock wins may start provider I/O; a request whose admission begins
  after cutoff observes no account and performs zero provider I/O.
- New pinned connections fail closed on a missing/mismatched definition
  revision, audience, provider client, retired client, membership, or policy.
  Explicit nullable PR1 legacy pins remain readable only during the documented
  compatibility window and are removed by PR5 migration.
- A refresh write requires the admitted account id, grant version, credential
  version, definition revision, and provider-client revision to remain exact.
  Scope expansion is never written. Scope narrowing commits a new grant and
  forces the caller through a fresh admission before MCP provider I/O.
- Tool caches and approvals never depend on `credential_version`; token-only
  refresh does not invalidate them. Grant changes do invalidate them by version
  mismatch, and disconnect explicitly terminalizes/deletes them.
- Disconnect returns success after the cutoff transaction commits, independent
  of provider availability. The outbox contains only the revocation job UUID.
  Revocation ciphertext is cleared on every terminal state and cannot outlive
  the 24-hour deadline.
- Revocation is idempotent. A crash after upstream success may repeat the
  provider request, but never restores local access or extends retained-secret
  lifetime.

## Non-goals

- No ProductClient visual migration, provider readiness scheduler, dashboard,
  production deployment, user-offboarding policy, encryption rewrap, or
  removal of the nullable legacy-pin compatibility path.
- No customer credential, live provider write, browser automation, Docker, or
  AnyHarness/Rust proof. Provider calls are mocked in tier-2 tests.
- No reusable durable lease table. The account lock establishes the admission
  boundary; post-I/O persistence uses exact-version CAS.

## Acceptance

- Real-Postgres interleaving tests prove disconnect after admission may let the
  already-admitted call finish without recreating cache state, while admission
  after disconnect performs zero provider I/O.
- Tests reject org-policy denial, membership loss, definition/client/audience
  mismatch, and retired client before provider I/O; legacy null pins remain
  compatible only where explicitly asserted.
- Refresh races prove one credential-version winner, loser reload, no grant
  churn for token-only refresh, grant advance for scope narrowing, zero write
  for scope expansion, and no persistence after cutoff.
- Attempt replacement tests prove credential-only rotation preserves
  `grant_version` while authority changes advance it.
- Disconnect tests prove attempts/flows/approvals/cache are invalidated and the
  account is absent in the same commit; the outbox contains no secret.
- Revocation tests prove issuing-client use, standard and Slack request shapes,
  retry behavior, unsupported completion, idempotency, terminal secret
  destruction, and hard-deadline destruction.
- Migration upgrade/downgrade preserves approval/cache version values and the
  N-1 physical column contract, and has one Alembic head. Focused
  unit/integration tests, Cloud SDK generation/build,
  server Ruff/mypy/boundary/docs/max-lines/design-attribution checks, and
  `git diff --check` pass.
