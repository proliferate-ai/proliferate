# Sandbox GitHub Auth

Status: target. This document describes the accepted destination for GitHub
repository authority in cloud sandboxes: how a sandbox gets permission to
clone, fetch, and push, and nothing else. The body is written in the ideal
state. Every difference from `main` today is listed in
[Current gaps](#current-gaps); the list shrinks as follow-up PRs land, and
the label comes off when it is empty.

## Purpose

This platform owns GitHub *authority* for cloud sandboxes: the GitHub App
authorization that grants repository access, the short-lived credential
lease materialized onto the VM, and the credential helper that serves it to
git. Boundary law: authority says who may push; identity (who the commit is
by) belongs to [content.md](content.md).

Fences, one owner per concern:

- Product GitHub OAuth — who is this Proliferate user — is product
  identity, not repository authority; the two are separate relationships
  with the same provider and never substitute for each other.
- Clone/fetch/push mechanics and the disk they land on:
  [content.md](content.md). This document ends where the
  token leaves the helper.
- The sandbox and its materialization channel:
  [lifecycle.md](lifecycle.md).
- The product wire to the runtime:
  [gateway.md](gateway.md) — git traffic deliberately never
  takes it (the proxied-vs-direct map there); git goes sandbox → GitHub
  directly, authenticated by this platform's lease.
- The add-repo UI's step choreography (which blocker shows which action)
  consumes this platform's authority statuses; its screens belong to the
  product system docs.

## Invariants

- **One credential story: App authority is the only GitHub repository
  credential.** Every repository fact the product shows for cloud flows —
  the repo catalog, branch listings, coverage checks — is read with App
  tokens. The user's product GitHub OAuth account is login identity only
  and is never used as a repository credential; a user with no
  installation sees a single "Install the GitHub App" action, and
  GitHub's own installation screen is the repository picker. (Ruling:
  the pre-App OAuth browsing path buys a marginally smoother first run
  at the price of a second credential flow with different scope
  semantics, forever.)
- The sandbox never holds durable authority: no App private key, no OAuth
  client secret, no refresh token, no long-lived token. It holds one
  short-lived user-to-server token lease (`github_app_user_to_server`,
  power bounded by user permissions AND App permissions), user-scoped, per
  provider — not per workspace.
- Cloud stores the durable authorization and refresh authority; the
  sandbox stores only the lease files.
- The credential helper is dumb: it reads the current token file and
  prints git-credential output. It never calls Cloud or GitHub, so a
  sandbox with a stale lease degrades to auth-failed git, never to a
  credential-minting agent.
- Repo authority is enforced before Cloud materializes or exposes a repo;
  mutations re-check (`require_github_cloud_repo_authority`) rather than
  trusting a prior status response.
- Tokens are redacted everywhere: logs, exception strings, tracing,
  command output, test output.
- No client — Desktop, Web, SDK — ever receives a raw GitHub token, App
  refresh token, App private key, or token-file contents.

## Authorization: the product gate

Two GitHub relationships, deliberately separate:

- **User authorization** of the GitHub App (signed-state OAuth flow):
  grants Cloud a user-to-server refresh capability, stored server-side.
- **Installation** of the App on the org/repo: grants the repositories.

Routes live in
[github_app/api.py](../../../server/proliferate/server/github/api.py):
start/status/callback for each flow, plus GitHub's Setup-URL callback (no
signed state; it can only complete an installation the signed flows
began), plus the accessible-repos and per-repo authority endpoints.

These two relationships are also two of the three legs of the sandbox
provisioning trigger: when user authorization, installation, and org
membership all hold for a (user, org) pair, the completing callback
schedules that pair's eager sandbox bootstrap —
[lifecycle.md](lifecycle.md)'s chain-completion law; this
document only owns the authority events themselves.

Authority status for a repository
([github_app/models.py](../../../server/proliferate/server/github/models.py))
is one of: `authorized`, `needs_reauth`, `missing_authorization`,
`missing_installation`, `not_covered`, `missing_user_repo_access`,
`operator_configuration_required`, `error`. The no-unrepairable-action law
from [access.md](access.md) applies verbatim: operator
misconfiguration repairs operator-side (`action: null`), missing human
repository access repairs on GitHub, and only genuinely-expired user
authorization offers "Reconnect GitHub App".

Expiry is detected at use, not by polling: a token refresh failing marks
the authorization `needs_reauth` in its own committed transaction
(`commit_github_app_reauthorization_on_error`, wired into the routes that
exercise authority), so the status flips even when the triggering request
rolls back.

## The lease on the VM

Repository materialization writes three artifacts under
`/home/user/.proliferate`
([paths.py](../../../server/proliferate/server/cloud/materialization/paths.py),
[materialize/github_credentials.py](../../../server/proliferate/server/cloud/materialization/materialize/github_credentials.py)):

- `git/github.com/token` — the current user-to-server token, mode 600;
  only the first line is ever read.
- `git/github.com/meta.json` — provider, token kind, actor login/id, lease
  id, `issuedAt` / `expiresAt` / `refreshAfter`.
- `bin/proliferate-git-credential-helper` — POSIX sh
  ([source](../../../install/proliferate-git-credential-helper)):
  answers only `get`, only `https`, only `github.com`; prints
  `username=x-access-token` plus the token file's first line; on any other
  input it exits silently so git falls through rather than hanging.

The same step configures global git config idempotently and self-tests the
helper before trusting it: invoke the helper with a github.com query, grep
for the expected username and a nonempty password, then set
`credential.https://github.com.helper` and the two SSH→HTTPS `insteadOf`
rewrites (`git@github.com:`, `ssh://git@github.com/`) so agent-written SSH
remotes transparently use the lease.

**Refresh is server-push at the point of need.** Every repository
materialization (workspace create, repo-environment save, sandbox
bootstrap preclone, workflow delivery — the trigger list in
[content.md](content.md)) first runs
`ensure_fresh_github_app_authorization` and rewrites the lease files with a
fresh token (`expiresAt` from GitHub, else issued + 8 h; `refreshAfter` =
`expiresAt` − 30 min). There is no refresh daemon on the VM and none is
wanted: the helper never mints, nothing on the sandbox pulls, and a lease
is only ever as old as the last materialization. The accepted consequence
— git run *between* materializations can outlive the lease — fails as
ordinary git auth failure, and the repair is any materialization-triggering
action; the product surface must say so (gap below).

## Failure modes

- Missing/expired user authorization at repo setup: typed 409 with the
  repair action ("Connect/Reconnect GitHub App"); nothing materializes.
- Installation missing or repo not covered: typed status with the install/
  grant action; a repo is never presented as usable without coverage; a
  member who cannot install gets an admin-request path, not a dead button.
- Operator never configured the App: `operator_configuration_required`,
  action `null` — the deployment-layer absence, per the access spec.
- Token refresh fails at materialization: authorization marked
  `needs_reauth` (independently committed), materialization fails typed;
  the next attempt after reauth succeeds.
- Lease expires mid-session: git fails with auth errors inside the
  sandbox; the helper stays silent by design; any materialization repairs.
- VM dies: the lease dies with it; the replacement VM gets a fresh lease
  at its first materialization ([content.md](content.md)'s
  fresh-start ruling). Nothing durable was on the disk, so there is
  nothing to revoke.

## Proof

- Repo authority gating and reauth-on-error:
  [github_app service tests](../../../server/tests/unit/) (see
  `test_github_app_*`).
- Credential materialization and helper self-test: exercised by the
  managed-cloud materialization integration tests
  ([server/tests/integration/](../../../server/tests/integration/)).
- End-to-end: the product smoke — add covered repo → workspace → terminal
  `git fetch`/`git push --dry-run` through the sandbox — with the negative
  case (repo removed from the installation → typed `not_covered` before
  any clone).

Corridor G — one credential story. Named, binary assertions; the
corridor is done when they are green. IDs are stable — tests reference
them by name:

- **G1** The repo catalog and branch listings serve on App tokens;
  grep-gate: `repos/domain/github_credentials` stays deleted; the
  zero-installation state renders the install CTA. (pytest + frontend
  test)
- **G2** An expired lease surfaces typed, naming the repair (any
  materialization-triggering action); raw git auth noise never reaches
  the user as the only signal. (pytest + frontend copy test)
- **G3** One installation-completion function behind thin route
  entrypoints. (pytest)

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] A parallel pre-App credential path survives: the repo catalog and
      branch-listing routes still build credentials from the user's
      product OAuth account
      ([repos/domain/github_credentials.py](../../../server/proliferate/server/github/repos/domain/github_credentials.py),
      consumed by
      [repos/service.py](../../../server/proliferate/server/github/repos/service.py))
      even though the add-repo dialog already reads the App-token
      accessible-repos catalog. Migrate the catalog and branch routes
      onto App tokens, delete the OAuth credential builder (grep-gate:
      `repos/domain/github_credentials` stays deleted), and render the
      zero-installation state as the install CTA. Ruling: one credential
      story — App authority is the only repository credential.
- [ ] Lease staleness between materializations has no product surface: a
      sandbox older than its lease fails raw git auth with no typed signal
      and no named repair. Type it and point at the repair (any
      materialization-triggering action).
- [ ] Three callback routes overlap: the installation callback and the
      Setup-URL callback complete installations through near-identical
      paths ([github_app/api.py](../../../server/proliferate/server/github/api.py)).
      Consolidate on one completion function with thin entrypoints.
- [ ] The status enum outgrew its consumers: `operator_configuration_
      required` and `error` exist in
      [models.py](../../../server/proliferate/server/github/models.py)
      but predate some client status handling; sweep client switch sites
      for exhaustiveness.
