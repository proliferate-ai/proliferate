# Product Auth

Status: authoritative for Proliferate product account sign-in, linked provider
identity, password credentials, and product-readiness gates.

Scope:

- `server/proliferate/auth/**`
- `apps/web/src/components/auth/**`
- `apps/mobile/src/components/auth/**`
- `apps/desktop/src/components/settings/panes/AccountPane.tsx`
- `apps/packages/product-domain/src/auth/**`
- `apps/packages/product-ui/src/auth/**`
- `cloud/sdk/src/client/auth.ts`

## Model

Proliferate has two related but distinct auth concepts:

- **Sign-in methods** let a person authenticate to the Proliferate account.
  Current methods are GitHub, Apple, Google, SSO, and email/password.
- **Linked providers** are external OAuth identities and grants attached to the
  account. GitHub, Google, Apple, and SSO identities are linked providers.
  Email/password is not a linked provider.

GitHub remains the product-readiness provider. A password-only user is signed in
but limited until the existing GitHub readiness check succeeds. Do not add a
hidden bypass for normal (hosted, multi-tenant) users.

There are two carve-outs to the GitHub readiness gate in `current_product_user`:

- Single-org (self-hosted) instances have no GitHub OAuth app configured, so the
  gate admits password-only accounts when `settings.single_org_mode` is true,
  same as its sibling `current_organization_actor`.
- A user who arrived through an organization's SSO connection passes without a
  linked GitHub identity. The org relationship is the vetting: the connection is
  admin-configured and membership is enforced on every SSO login, so an
  org-scoped SSO identity backed by an active membership stands in for the
  GitHub link. The exact check is
  `user_has_active_organization_sso_membership`: an `sso_identity` row with a
  non-null `organization_id` joined to an active `organization_membership` in
  that org. A deployment-scoped SSO identity (org id null) does not qualify.

Hosted keeps the GitHub readiness gate for everyone else, unconditionally.
Endpoints that genuinely need a GitHub token (repo import, App install, etc.)
still enforce that at their own point of use, not through this gate, and
free-trial credit grants stay GitHub-gated (GitHub identity is the anti-abuse
signal for free credits). SSO passing the readiness gate does not change either.

The cloud sandbox gateway WebSocket authenticates its own product user rather
than going through `current_product_user` (it reads the bearer token off the
WebSocket handshake). It carries the same `settings.single_org_mode` carve-out
so reaching your own sandbox over the gateway works on self-hosted instances;
hosted still requires GitHub readiness there.

## Web Beta Access

Hosted web access is beta-gated. The server enforces the gate when issuing or
refreshing a web session; Desktop and Mobile OAuth/token flows are not blocked
by this web-only policy.

Beta membership is configured with:

- `WEB_BETA_ALLOWED_EMAILS` for exact email addresses
- `WEB_BETA_ALLOWED_DOMAINS` for all emails at an exact domain

Both lists are comma-separated and normalized case-insensitively. A user is
eligible when their account email matches either an exact email or the domain
after `@`. Existing users do not bypass the web beta gate. If the beta allowlist
is not configured, the server does not apply the web beta restriction for local
and unconfigured deployments.

Denied web sessions return a stable `403` error code. OAuth callback denials
redirect back to the web auth error route with the same stable code so the web
app can render beta-specific copy and point the user to Desktop.

## Email/Password

Email/password auth is a controlled sign-in method for accounts that already
exist or are provisioned operationally. Public password signup is intentionally
not exposed.

Server routes:

- `POST /auth/web/password/login`
  - body: `{ "email": string, "password": string }`
  - response: `AuthSessionResponse` without a JSON refresh token
  - sets the existing HttpOnly web refresh cookie and CSRF cookie
- `POST /auth/mobile/password/login`
  - body: `{ "email": string, "password": string }`
  - response: `AuthSessionResponse` with a refresh token for SecureStore
- `PUT /auth/password`
  - authenticated limited-user route
  - body: `{ "currentPassword"?: string, "newPassword": string }`
  - requires `currentPassword` when a password is already set

Password credentials are marked by `user.password_set_at`. Do not infer password
capability from `user.hashed_password`, because OAuth-only users use a sentinel
hash string and must not authenticate with password login.

New password hashes use FastAPI Users' `PasswordHelper`, which currently emits
Argon2id hashes through `pwdlib`. Verification may upgrade older supported
hashes when `PasswordHelper` returns an updated hash.

## Abuse And Failure Behavior

Password login failures must return generic copy:

```text
Email or password is incorrect.
```

Unknown email, inactive user, OAuth-only user, and wrong password all use the
same 401 response. The service also runs a dummy password verification for
accounts that cannot authenticate so those paths do not become a cheap timing
oracle.

Repeated failures are throttled by both normalized email hash and client IP
hash. The throttle table stores counters only, not raw email addresses,
passwords, or request bodies. Once a bucket is blocked, the user sees:

```text
Too many attempts. Wait a moment, then try again.
```

`PASSWORD_AUTH_ENABLED=false` is the operational kill switch. The default is on
because login still only works for accounts with an explicit password marker.
`x-forwarded-for` is trusted only for loopback/local calls or proxy IPs and
CIDRs listed in `PASSWORD_AUTH_TRUSTED_PROXY_HOSTS`.

## Organization SSO Sign-In

The org-SSO backend (connection model, discovery/start endpoints, OIDC callback,
JIT membership) was fully built before this slice. What was missing was a way for
a user to reach it: web and desktop cold login only ever probed deployment-scope
SSO, and org SSO was reachable only through the desktop invite deep link. This
slice adds the user-facing entry points. It does not change the OIDC flow itself.

Entry points, one shape across surfaces:

- Web auth screen shows a quiet `Sign in with SSO` link (shown when the
  deployment is not itself SSO-gated). It opens `/login`, a page with a single
  field for the organization's workspace slug.
- `/login/<slug>` prefills that field. This is the URL an admin pastes into their
  onboarding docs (for example `app.proliferate.ai/login/acme`).
- The slug resolves to an `organizationId`, then the page calls the existing
  `startSsoAuth` start flow with that org (and connection) id. No new SSO
  machinery.
- Desktop mirrors this: a `Sign in with SSO` affordance on cold login reveals a
  slug field and drives the existing native SSO machinery (system browser +
  `proliferate://auth/callback` deep link).
- Web `/join/:orgId` signs the user in on the web when the org has SSO enabled
  (it discovers by org id and starts the SSO flow; JIT membership and invite
  acceptance happen in the SSO callback). It only falls back to the Desktop
  handoff when the org has no usable SSO.

Slug resolution:

- Organizations carry a `slug`: a lowercase, URL-safe, unique handle generated
  from the org name at creation (partial unique index on `organization.slug`;
  existing rows backfilled). It is derived, not user-editable in this slice.
- `GET /auth/sso/discover?slug=<slug>` resolves the slug to its org's enabled
  SSO connection and returns only what the start flow needs (`organizationId`,
  `connectionId`, `protocol`, connection `displayName`). It never returns the
  org name or other org metadata.
- Slug lookup is explicit user input, so it does not reopen the deliberate
  email -> org-connection enumeration protection
  (`test_discover_sso_ignores_org_connections_without_explicit_org_context`
  stays green; there is still no email-domain discovery of org connections).

Enumeration protection on the slug channel: a nonexistent slug, an org with no
SSO, and an org whose SSO is disabled all return the identical generic response
(`enabled: false`, `reason: "not_available"`, no ids), so a caller cannot cycle
slugs to learn which organizations exist or which have SSO configured. Only a
slug that resolves to an actually-enabled connection returns the ids needed to
start. The client surfaces one generic message ("check the sign-in link your
admin shared") for every non-enabled outcome.

## Surface UX

Web signed out:

- Shows `Continue with GitHub` as the primary provider action.
- Shows `Continue with Google` as the secondary visible provider action.
- Shows web beta copy before sign-in.
- Shows a `Sign in with SSO` link to the org-slug login page (see Organization
  SSO Sign-In), except when the deployment is itself SSO-gated.
- Does not currently show Apple or email/password sign-in on the web auth page.
- If readiness is missing, the existing Connect GitHub gate is shown.
- If web beta access is denied, shows a beta-only rejection state with Desktop
  app handoff and alternate-account actions.

Mobile signed out:

- Shows native email/password fields and provider buttons.
- On password success, stores the refresh token through the existing SecureStore
  session path.
- If readiness is missing, the existing GitHub-required screen is shown.

Desktop:

- Keeps GitHub as the primary sign-in path.
- Cold login also offers a `Sign in with SSO` affordance that asks for the org
  workspace slug and drives the existing native SSO flow (see Organization SSO
  Sign-In).
- Account settings expose `Set password` / `Change password` for authenticated
  users.
- Organization join deep links may arrive before Desktop is authenticated.
  Desktop should start the normal sign-in path and preserve the join target so
  the organization invitation flow resumes after authentication.

Account settings:

- Show email/password separately from connected providers.
- Do not render email/password as a provider row.
- Show connected SSO identities by provider display name, protocol-backed
  account email, and SSO icon.
- GitHub readiness remains its own status.

## Reviewer Accounts

For App Store review, create a dedicated reviewer account with email/password
and make the account product-ready before submitting the app. The preferred
path is a limited GitHub account already linked to the Proliferate user and
scoped to safe review repositories.

Use the provisioning script for local or operational setup:

```bash
read -r -s PROLIFERATE_REVIEWER_PASSWORD
uv --directory server run python scripts/provision_password_auth_user.py \
  --email reviewer@example.com \
  --password-env PROLIFERATE_REVIEWER_PASSWORD \
  --display-name 'App Review'
```

The script creates or updates the user password marker. It does not make the
account product-ready by itself; link GitHub through the normal product flow or
through a deliberate admin process.
It also supports interactive password entry with no password flag, and
`--password-stdin` for secret-manager pipelines.

## Out Of Scope For This Slice

- Public password signup.
- Password reset and email verification flows.
- A GitHub-free demo mode for normal users.
- Desktop email/password sign-in on the first screen.

Build reset and verification before making password accounts self-serve.
