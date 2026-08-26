# Accounts

Status: current (grade B). System spec in the Organization Standard anatomy.
The surface-level product rules (sign-in methods, web beta, password auth,
reviewer accounts, surface UX) live in the companion document
[`../auth/README.md`](accounts.md); the server layering rules
(actor dependencies, org authorization, resource access, product policy) live
in [`specs/systems/identity/auth-surface.md`](auth-surface.md). This spec is the
owner; those two are its sections.

## 1. Purpose

Accounts turns a person into a `User`: sign-in (GitHub, Google, Apple,
email/password), linked provider identities and their encrypted grants,
session and token minting for web, mobile and desktop, product-readiness
gates, and the account-entry side effects (organization placement, agent
gateway enrollment, signup notification). It does not decide organization
standing (that is `organizations` via `permissions.py`) and does not own any
resource.

SSO was deleted end to end on 2026-08-25 (cull PR #2218); there are no
`sso_*` settings, tables, routes or client surfaces.

## 2. Owned state

[`db/models/auth.py`](../../../server/proliferate/db/models/auth.py):

| Table | Meaning |
| --- | --- |
| `user` (+ fastapi-users `oauth_account`) | The account: email, display name, GitHub login, avatar, `outreach_email`, `password_set_at`, `token_generation` (the "revoke all sessions" primitive). |
| `auth_identity` | Canonical `(provider, provider_subject)` identity linked to a user. |
| `provider_grant` | Encrypted provider access/refresh material + readiness per identity (GitHub readiness lives here). |
| `auth_challenge` | Short-lived OAuth/OIDC challenge (state/nonce/csrf hashes, PKCE, surface, purpose). |
| `desktop_auth_code` | Short-lived PKCE authorization code for the desktop exchange. |
| `password_login_attempt` | Throttle counters by email-hash and IP-hash buckets — counters only, never raw values. |

Not owned here: `instance_setup_token` (owned by `setup`, the first-run claim
flow) and `organization_membership` (owned by `organizations`).

## 3. Public surface

Routes, mounted under `/auth`
([`main.py`](../../../server/proliferate/main.py)):

```text
identity  POST /auth/{surface}/{provider}/start · GET /auth/{surface}/{provider}/callback
          GET  /auth/{provider}/callback                (shared provider callback; desktop gets an HTML handoff page)
          POST /auth/github/link/start
          POST /auth/web/apple/callback · POST /auth/mobile/apple/complete
          POST /auth/web/password/login · POST /auth/mobile/password/login · PUT /auth/password
          POST /auth/web/token · /auth/mobile/token
          POST /auth/web/session/bootstrap · /refresh · /logout · POST /auth/mobile/session/refresh
desktop   GET  /auth/desktop/methods · GET /auth/desktop/github/availability
          POST /auth/desktop/github/start · GET /auth/desktop/github/authorize|callback (compat)
          POST /auth/desktop/authorize                    (mint a PKCE auth code for a signed-in user)
          POST /auth/desktop/password/login · POST /auth/desktop/token · POST /auth/desktop/refresh
          POST /auth/desktop/poll                         (poll for the PKCE handoff by state; 202 while pending)
```

Python surface (MANIFEST): `proliferate.server.accounts`. The importable
authentication leaf below it — `proliferate.auth.dependencies`
(`current_active_user`, `current_limited_user`, `current_product_user`,
`current_organization_actor`, `optional_current_active_user`) and
`proliferate.auth.authorization` (the dependency-free vocabulary re-exported
by `permissions.py`) — is the surface every other system consumes.

SDK: [`cloud/sdk/src/client/auth.ts`](../../../cloud/sdk/src/client/auth.ts),
[`cloud/sdk-react/src/hooks/auth.ts`](../../../cloud/sdk-react/src/hooks/auth.ts).

## 4. Consumes

- `organizations`: `place_new_identity` (membership policy seam — hosted:
  personal default org; single-org: join the instance org or fail closed),
  `ensure_admin_email_role` (the ADMIN_EMAILS floor, asserted at every login).
- `agent_auth`: `schedule_agent_gateway_user_enrollment` after every
  successful sign-in.
- Capability `notifications`: signup Slack notification (deduped on the GitHub
  subject).
- Capability `lib/infra/encryption`: provider-grant ciphertext.
- Vendor leaves: `integrations/github` (profile sync), provider OAuth clients
  in `auth/identity/providers.py`.
- Config: `github_oauth_*`, `google_*`, `apple_*`, `jwt_secret`,
  `password_auth_enabled`, `password_auth_trusted_proxy_hosts`,
  `web_beta_allowed_emails|domains`, `single_org_mode`, `api_base_url`,
  desktop redirect schemes ([`constants/auth.py`](../../../server/proliferate/constants/auth.py)).

## 5. Laws

- **Identity resolution is one function.** Every provider callback (web,
  desktop, mobile; GitHub, Google, Apple) resolves its user through
  `resolve_provider_user`: an existing identity wins; on `link` purpose the
  challenge's user must be authenticated and a cross-linked identity merges
  only when exactly one side is product-ready (GitHub wins ties toward the
  ready account), otherwise 409 `identity_provider_already_linked`; a new
  identity with an email already on file 409s unless the provider is GitHub
  (which attaches). New users are placed by `place_new_identity` in the same
  transaction. The legacy desktop GitHub callback is the one path outside
  this function and re-asserts the same side effects itself.
- **Readiness is GitHub.** `current_product_user` requires a ready GitHub
  grant for hosted users; single-org instances bypass it. Free-tier credit
  grants stay GitHub-gated (anti-abuse). No hidden bypass for hosted users.
- **Tokens carry a generation.** Access and refresh tokens embed
  `token_generation`; a mismatch is a revoked token. Bumping the column is
  logout-everywhere.
- **Desktop is PKCE.** Browser completion mints a one-time
  `desktop_auth_code`; the app exchanges it with a verifier, or polls
  `/pending-token` by state; redirect URIs must use a configured desktop
  scheme; loopback host mismatches are rewritten so the CSRF cookie survives.
- **Web is beta-gated at session issue/refresh only**; desktop and mobile
  flows are not. Denials are a stable 403 code; provider-error callbacks
  return to the originating surface as `provider_error`, never a server error.
- **Password auth is controlled, not self-serve.** No public signup (hosted);
  generic failure copy; dummy verification for non-password accounts (no
  timing oracle); throttled by email hash and IP hash; `x-forwarded-for`
  trusted only from configured proxies; `PASSWORD_AUTH_ENABLED=false` kills
  it. `password_set_at` is the capability marker — never infer from the hash.
- **ADMIN_EMAILS is a floor asserted at every login** and inert in hosted
  mode (owned by `organizations`, invoked here).
- **Auth errors are typed** (`AuthFlowError(code, message, status)`); the
  desktop and identity error contracts are pinned by tests.

## 6. Emits

- Signup Slack notification (`SignupSlackNotification`, dedupe
  `github:<subject>`).
- Agent-gateway user enrollment (scheduled, consumed by `agent_auth`).
- Sign-in observability events
  ([`auth/sign_in_observability.py`](../../../server/proliferate/auth/sign_in_observability.py)).
- The resolved actor (`User`) and `WorkerAuthContext` is *not* emitted here —
  worker auth belongs to `seam/workers`.

## 7. Fences

- **`organizations`** own membership rows, roles, invitations, the instance
  org, ADMIN_EMAILS semantics and self-registration
  (`POST /auth/password/register` is mounted under `/auth` but owned there).
- **`setup`** owns the first-run claim (`/setup`, `instance_setup_token`).
- **`permissions.py`** (plane infra) owns request-time org standing and RLS
  context; accounts never resolves org roles.
- **`seam/workers`** owns machine actors (opaque worker bearer tokens).
- **`agent_auth`** owns the key vault and gateway identities minted at
  enrollment.
- **`integration_gateway`** owns third-party connection tokens; the
  `provider_grant` here is the *sign-in* provider's grant only (GitHub
  readiness), never an integration credential.
- **`support`** owns outreach semantics; accounts only stores
  `outreach_email` via `PATCH /v1/users/me`.

## 8. Code map

```text
server/proliferate/server/accounts/**           MANIFEST.toml → this spec
  identity/{api,service}.py                     web/mobile/shared-callback account entry
  desktop/{api,service}.py                      desktop PKCE boundary
server/proliferate/auth/**                      importable auth leaf
  dependencies.py · authorization.py · tokens.py · jwt.py · oauth.py · passwords.py · pkce.py
  identity/{providers,service,sessions,store,password,web_beta,routing,types,models,legacy}.py
  desktop/{models,pages}.py · users.py · errors.py · api.py · profile_api.py · sign_in_observability.py
server/proliferate/db/models/auth.py
server/proliferate/db/store/{auth,users}.py
server/proliferate/constants/auth.py
server/scripts/provision_password_auth_user.py
cloud/sdk/src/client/auth.ts · cloud/sdk-react/src/hooks/auth.ts
apps/packages/product-client/src/components/auth/** · src/domain/auth/** · src/lib/domain/auth/**
apps/packages/product-client/src/components/settings/panes/AccountPane.tsx
apps/web/src/browser/auth/** · apps/mobile/src/components/auth/**
```

## 9. Proof

- Flows and contracts: `integration/test_auth_flow.py`,
  `integration/test_auth_oauth_provider_rejection.py`,
  `integration/test_auth_viewer_api.py`, `integration/test_web_beta_auth.py`,
  `integration/test_desktop_auth_gate.py`,
  `integration/test_desktop_auth_error_contract.py`,
  `integration/test_identity_auth_error_contract.py`.
- Identity resolution and password rules: `unit/test_auth_identity_service.py`,
  `unit/test_desktop_password_auth.py`, `unit/test_auth_errors.py`.
- Client: `apps/packages/product-client/src/components/auth/**` tests and
  `AccountPane` tests.

## Known gaps / follow-ups

- Password reset, email verification and public signup remain out of scope
  (see companion doc).
- The desktop GitHub compatibility callback duplicates the resolve-user side
  effects outside `resolve_provider_user`; folding it is a bucket-3 change.
- Apple sign-in usage is unmeasured; its removal was raised as decision ⑤ in
  the cull plan.
  > [!decision] PABLO DECIDES: keep Apple sign-in (App Store review needs a
  > reviewer path) or drop it and use a password reviewer account only.
  > Recommendation: keep until the mobile app's future is decided.
- Service subjects (agents acting as clients under an org) are an
  `organizations` decision, not an accounts one; accounts will only need to
  mint tokens for them.
