# GitHub

Status: target. Grade B system spec: mechanisms verified on `main`; the identity-of-work laws are written in the accepted destination (Core Architecture §11) and every delta from `main` is in [Current gaps](#current-gaps).

The GitHub system owns Proliferate's relationship with GitHub as **the identity of work**: the GitHub App a user authorizes, the App installations an organization (or user account) grants, which repositories those installations cover, and therefore *under whose name and authority* a run may read, clone, and push. Boundary law, repeated on both sides: **authority says who may push; identity says who the commit is by; the sandbox credential helper only serves what this system leased.**

## 1. Purpose

A repository is usable in Proliferate exactly when a current App authorization for the acting user meets an active installation covering that repository; both facts stay fresh without a user-visible refresh, and both failures are typed with the one action that repairs them (`reconnect` the App, or `install` it for that owner).

## 2. Owned state

[db/models/github_app.py](../../../server/proliferate/db/models/github_app.py):

| Table | Row meaning |
| --- | --- |
| `github_app_authorizations` | One user's GitHub App user authorization: GitHub user id/login, encrypted access + refresh tokens with both expiries, `status` (`ready` or revoked), granted permissions. |
| `github_app_installations` | One App installation on a GitHub account (`account_login`, `account_type`, `repository_selection ∈ {all, selected}`, permissions, `suspended_at`, `deleted_at`), optionally bound to an organization and the installing user. Unique on `github_installation_id`. |
| `github_app_installation_repositories` | Coverage cache: which repositories a `selected` installation covers, refreshed from webhooks and on-demand coverage fetches. |

Store: [db/store/github_app.py](../../../server/proliferate/db/store/github_app.py).

## 3. Public surface

Routes (user-authenticated unless noted), mounted from [github/api.py](../../../server/proliferate/server/github/api.py) via `cloud/api.py` and [main.py](../../../server/proliferate/main.py):

| Route | Serves |
| --- | --- |
| `GET /v1/cloud/github-app/user-authorization/start` | Signed-state redirect to GitHub's user-authorization page. |
| `GET /v1/cloud/github-app/user-authorization` | Authorization status (fresh, needs reauth, absent). |
| `GET /v1/cloud/github-app/accessible-repos` | Repositories the user's authorization can reach through active installations. |
| `GET /v1/cloud/github-app/repos/{owner}/{name}/authority` | The repo authority verdict for one repository (typed statuses, never a token). |
| `GET /v1/cloud/organizations/{org}/github-app/installation/start`, `GET …/installation` | Org-admin install start and status. |
| `GET /auth/github-app/user-authorization/callback`, `GET /auth/github-app/installation/callback`, `GET /integrations/github/callback`, `GET /auth/github-app/connected` | Provider callbacks (state-signed) and the "connected" page. |
| `POST /v1/cloud/webhooks/github-app` (GitHub-signed) | Installation lifecycle intake ([webhooks.py](../../../server/proliferate/server/github/webhooks.py)): `installation`, `installation_repositories`. |
| `GET /v1/cloud/repos`, `GET /v1/cloud/repos/{owner}/{name}/branches` | The repo catalog and branch listing ([repos/api.py](../../../server/proliferate/server/github/repos/api.py)). |

Python surface for other systems: `github.api`, `github.service`, `github.models`, plus the authority gate [`require_github_cloud_repo_authority`](../../../server/proliferate/server/github/repo_authority.py) → `GitHubCloudRepoAuthority` (actor login, GitHub user id, installation id, repository id, and the short-lived access token the caller may lease onward). Measured importers today: `cloud`, `cloud/materialization`, `cloud/repositories`, `cloud/workspaces`, `main.py` — all but `main.py` die with PR-Ab; the environments rebuild becomes the sole consumer of the gate.

SDK: [github-app.ts](../../../cloud/sdk/src/client/github-app.ts), [repos.ts](../../../cloud/sdk/src/client/repos.ts).

## 4. Consumes

- Vendor leaf [integrations/github/](../../../server/proliferate/integrations/github):
  App JWT, installation listing, user-token exchange/refresh, coverage
  fetch, webhook signature verification. No product logic lives there.
- accounts: the acting user; product-login GitHub OAuth account (see gaps —
  the repo catalog still reads it).
- organizations: admin checks for installation start.
- Settings `github_app_*` in [config.py](../../../server/proliferate/config.py)
  (app id, private key, client id/secret, webhook secret).

## 5. Laws

**Authority = current authorization ∧ covering installation.** [`require_github_cloud_repo_authority`](../../../server/proliferate/server/github/repo_authority.py) first ensures a fresh user authorization (refreshing under a per-user lock via [`ensure_fresh_github_app_authorization`](../../../server/proliferate/server/github/repo_authority.py)), then finds an active installation for the owner — `repository_selection=all` wins outright; `selected` consults the coverage cache and, on a miss, fetches coverage from GitHub and caches it. Missing installation → `github_app_installation_required` (409). Closes: cloning with a token that GitHub will reject.

**Reauthorization failures commit with the error.** A permanent refresh failure raises [`GitHubAppReauthorizationRequired`](../../../server/proliferate/server/github/errors.py) (`github_app_authorization_expired`, 409) and the router dependency [`commit_github_app_reauthorization_on_error`](../../../server/proliferate/server/github/transactions.py) commits the staged revoked state instead of rolling it back. Closes: an authorization that looks `ready` after GitHub has rejected it, retrying forever.

**Installation truth converges from webhooks and on-demand refresh.** `installation` and `installation_repositories` events update the rows; the callback and the authority gate refresh the installation cache from the App JWT when a lookup misses. Closes: a stale "not installed" after the user just installed.

**Callbacks are state-signed and actor-verified.** Every start mints a signed state (`_state_for_user_authorization`, `_state_for_installation`) with a validated `return_to` allow-list; the installation callback verifies the actor controls the installation before binding it to an organization ([`_verify_actor_controls_installation`](../../../server/proliferate/server/github/service.py)). Closes: binding someone else's installation to your org.

**Human-triggered runs act as the user; headless runs use bot identity with a required human approver.** PR authorship is review integrity: a person asked for the change, the person's name is on it. An automation with no human in the loop commits as the App's bot and needs an approver before merge. Closes: "who wrote this?" on an unattended PR.

**Task-environment GitHub auth derives from the organization installation, not a user's authorization leg.** A sandbox's credential lease is minted from this system's authority verdict for the run's subject; the lease is the only thing that leaves. Closes: a headless run holding a human's token.

## 6. Emits

- Repo authority verdicts (`GitHubRepoAuthorityResponse`: statuses that the
  add-repo flow renders as blockers/actions) — consumed by the client's
  repository picker and settings.
- `GitHubCloudRepoAuthority` (with the short-lived token) — consumed by
  environments to mint the sandbox credential lease.
- Installation status changes — consumed by the client through
  [use-github-app-state-invalidation.ts](../../../apps/packages/product-client/src/hooks/workspaces/cache/use-github-app-state-invalidation.ts).

## 7. Fences

- The sandbox credential helper, lease materialization onto the VM, and
  clone/fetch/push mechanics: environments
  ([SANDBOX/github-auth.md](sandbox-github-auth.md),
  [content.md](../environments/README.md)); this spec ends where the
  token leaves the authority gate.
- Product login via GitHub (who this Proliferate user *is*): accounts. Same
  provider, different relationship; they never substitute for each other.
- GitHub as a tool an agent calls (issues, PR comments through MCP):
  [integration_gateway.md](../integration_gateway/README.md). Not built; GitHub is not
  an integration definition today.
- Code-review and QA definitions that run on pull requests: catalogs/skills
  (pending the one-review-system ruling).

## 8. Code map

```text
server/proliferate/
├── db/models/github_app.py                     three tables
├── db/store/github_app.py                      authorizations, installations, coverage cache
├── integrations/github/                        vendor leaf: app_installations.py, app_user_tokens.py, repos.py, issues.py
└── server/github/
    ├── MANIFEST.toml
    ├── api.py                                  routers: github-app, organization, callbacks, setup callback, webhook
    ├── models.py                               wire models
    ├── service.py                              start/callback/status orchestration, signed state, actor verification
    ├── repo_authority.py                       the authority gate + authorization freshness + installation cache refresh
    ├── webhooks.py                             signature check, installation events
    ├── transactions.py · errors.py             commit-on-reauth-error, typed reauth error
    └── repos/                                  repo catalog + branches (api.py, service.py, models.py, access.py, domain/)

cloud/sdk/src/client/github-app.ts · repos.ts

apps/packages/product-client/src/
├── hooks/settings/workflows/use-github-app-installation.ts · use-github-app-user-authorization.ts
├── hooks/access/cloud/use-github-repository-picker-access.ts · auth/use-github-auth-availability.ts
├── hooks/workspaces/cache/use-github-app-state-invalidation.ts
└── lib/domain/settings/github-app-copy.ts
```

## 9. Proof

Unit: [test_github_app_service.py](../../../server/tests/unit/test_github_app_service.py), [test_github_app_repo_authority.py](../../../server/tests/unit/test_github_app_repo_authority.py), [test_github_repo_authority_gate.py](../../../server/tests/unit/test_github_repo_authority_gate.py), [test_github_app_callback_return.py](../../../server/tests/unit/test_github_app_callback_return.py), [test_repos_service.py](../../../server/tests/unit/test_repos_service.py). Integration: [test_github_app_reauthorization.py](../../../server/tests/integration/test_github_app_reauthorization.py). E2E helper: `tests/e2e/cloud/helpers/github.py`.

## Failure modes

| Condition | Typed result | Recovery |
| --- | --- | --- |
| No authorization, or refresh permanently failed | `github_app_authorization_expired` (409), row revoked | user reconnects the App |
| No active installation for the owner | `github_app_installation_required` (409) | org admin installs |
| `selected` installation not covering the repo | authority status `repository_not_covered` | admin widens the installation |
| App not configured in this deployment | `require_github_app_runtime_configured` refusal | operator sets `github_app_*` |
| Webhook signature invalid | `github_app_webhook_invalid` (401) | none — dropped |
| Catalog: user has no product GitHub login linked | `github_link_required` (400) | link GitHub (gap below) |

## Current gaps

- [ ] **Two credential stories.** The repo catalog and branch listing
      ([repos/service.py](../../../server/proliferate/server/github/repos/service.py))
      read the user's *product-login* OAuth token
      (`build_cloud_repo_credentials_for_user`), while the authority gate
      uses the App authorization. github-auth.md's invariant "App authority
      is the only GitHub repository credential" is target, not current.
      Strike by moving the catalog onto `accessible-repos` (App) and
      deleting the OAuth path.
- [ ] **Bot identity for headless runs** does not exist: every authority
      verdict is user-scoped (`token_kind`, `actor_login`). Needs an
      installation-token path (App JWT → installation access token) as a
      second `token_kind`, selected by run subject.
      > [!decision] PABLO DECIDES: the required human approver for
      > bot-authored PRs — enforce in Proliferate (the run result carries
      > `approver_required` and the merge verb checks it) or delegate to
      > GitHub branch protection. Recommendation: Proliferate-side, because
      > the approver must be attributable in the run record and GitHub
      > branch protection is per-repo configuration we do not control.
- [ ] **Org binding is optional.** `github_app_installations.organization_id`
      is nullable; installations made from a user-account flow float. The
      destination binds every installation to exactly one org (Law: org is
      the only billing/authority subject).
- [ ] **Importers.** Four of five measured importers are dark `cloud/`
      packages deleted by PR-Ab; environments becomes the consumer.
