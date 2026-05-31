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
  Current methods are GitHub, Apple, Google, and email/password.
- **Linked providers** are external OAuth identities and grants attached to the
  account. GitHub, Google, and Apple are linked providers. Email/password is not
  a linked provider.

GitHub remains the product-readiness provider. A password-only user is signed in
but limited until the existing GitHub readiness check succeeds. Do not add a
hidden bypass for normal users.

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

## Surface UX

Web signed out:

- Shows email/password as a default sign-in option.
- Keeps `Continue with GitHub` as the primary provider action because GitHub is
  still required for full product readiness.
- On password success, adopts the web session through `setSession`.
- If readiness is missing, the existing Connect GitHub gate is shown.

Mobile signed out:

- Shows native email/password fields and provider buttons.
- On password success, stores the refresh token through the existing SecureStore
  session path.
- If readiness is missing, the existing GitHub-required screen is shown.

Desktop:

- Keeps GitHub as the primary sign-in path.
- Account settings expose `Set password` / `Change password` for authenticated
  users.

Account settings:

- Show email/password separately from connected providers.
- Do not render email/password as a provider row.
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
