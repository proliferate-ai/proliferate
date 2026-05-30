# Running Locally

Status: authoritative for running Proliferate in local development.

Use dev profiles for full-stack development. A profile owns ports, database,
runtime state, desktop app home, and generated Tauri dev identity for one local
run. The low-level profile contract lives in
[`docs/dev/reference/dev-profiles.md`](reference/dev-profiles.md); this runbook
is the day-to-day path.

## Quick Start

From a repo worktree:

```bash
make dev-init PROFILE=<name>
make dev PROFILE=<name>
```

On Pablo's machine, the shell helper is:

```bash
pdev <name>
```

`pdev` initializes the profile, ensures the profile database exists, rebuilds
the repo, and starts the same profile-aware dev stack. It is a local shell
convenience, not a repo contract.

## What Starts

`make dev PROFILE=<name>` starts:

- AnyHarness runtime on the profile's `ANYHARNESS_PORT`
- Proliferate server on the profile's `PROLIFERATE_API_PORT`
- Desktop renderer on the profile's `PROLIFERATE_WEB_PORT`
- Hosted web app on the profile's `PROLIFERATE_HOSTED_WEB_PORT`
- automation worker against the same profile database
- Tauri desktop app with generated profile identity

Profile state lives under:

```text
~/.proliferate-local/dev/profiles/<name>/
```

AnyHarness runtime state lives under:

```text
~/.proliferate-local/runtimes/<name>/
```

List profiles and assigned ports:

```bash
make dev-list
```

## Local Env Loading

The profile launcher reads:

```text
.env
.env.local
server/.env
server/.env.local
```

Then it writes a profile-specific `launch.env` that includes API, web, mobile
web, CORS, AnyHarness, and runtime-home values.

Use committed example files to discover available variables, but keep real
secrets in ignored local env files.

## Local Stripe

Use local Stripe only for billing flows. First create or refresh test-mode
Stripe resources:

```bash
make stripe-setup-test
```

That command creates the local test product, Pro price, overage meter, overage
price, and refill price, then writes non-secret IDs to `server/.env.local`.
It does not write Stripe API keys or webhook secrets.

Start the full stack with Stripe webhook forwarding:

```bash
make dev PROFILE=<name> STRIPE=1
```

This does three useful things:

- reads the Stripe CLI test key into the backend process when
  `STRIPE_SECRET_KEY` is otherwise unset
- runs `stripe listen` for checkout/subscription/invoice events
- injects the listener's `STRIPE_WEBHOOK_SECRET` into the backend process

Use the Stripe test card:

```text
4242 4242 4242 4242
any future expiration
any CVC
```

The billing-specific runbook is
[`docs/dev/reference/stripe-local-testing.md`](reference/stripe-local-testing.md).

## Web

The hosted web app starts automatically with the full profile. Open the profile
hosted web URL printed by `make dev` or inspect it with:

```bash
source ~/.proliferate-local/dev/profiles/<name>/launch.env
echo "$FRONTEND_BASE_URL"
```

The web app is launched with:

```text
VITE_PROLIFERATE_API_BASE_URL=http://127.0.0.1:$PROLIFERATE_API_PORT
VITE_PROLIFERATE_DEV_TOKEN_LOGIN=true
```

The development access-token field exists only in Vite dev mode. Prefer normal
OAuth when testing auth, onboarding, GitHub linking, teams, billing, or product
readiness.

## Desktop

The desktop app starts automatically at the end of `make dev PROFILE=<name>`.
The generated app identity makes the macOS app bar show the profile name, such
as:

```text
Proliferate (<name>)
```

Desktop auth sessions and pending-auth entries are profile-scoped in the dev
Keychain. Native provider credentials and AnyHarness runtime data keys remain
user-level local secrets.

## Mobile Web Against A Profile

For browser-based mobile smoke testing, use the existing profile server and
database:

```bash
source ~/.proliferate-local/dev/profiles/<name>/launch.env
pnpm --dir apps/mobile web:profile
```

This uses the profile's `EXPO_PUBLIC_PROLIFERATE_API_BASE_URL` and
`PROLIFERATE_MOBILE_WEB_PORT`.

Mobile web is the preferred first pass for testing mobile screens against a
profile because it avoids native redirect setup while still exercising the real
cloud API, SDK, React Query, mobile shell, and mobile screen logic.

## Native Mobile

Use native mobile when testing Expo Go, iOS simulator behavior, native deep
links, SecureStore, Apple sign-in, physical keyboard/safe-area behavior, or
React Native-only rendering.

The existing native helper is:

```bash
make dev-mobile-auth
```

It starts local Postgres, migrations, ngrok, the server, and Expo with the API
base URL set to the ngrok URL. It prints provider redirect URIs to add in the
provider consoles, including:

```text
https://<ngrok-host>/auth/mobile/google/callback
```

Overrides:

```bash
PROLIFERATE_MOBILE_PORT=8090 make dev-mobile-auth
MOBILE_EXPO_ARGS="--lan" make dev-mobile-auth
```

`make dev-mobile-auth` is the canonical path for testing real native mobile
OAuth. It is not profile-native: it runs its own server process and defaults.

## Mobile Auth In Dev

Do not globally disable mobile auth. Mobile has a dev-only refresh-token path:

```text
EXPO_PUBLIC_PROLIFERATE_DEV_REFRESH_TOKEN=<refresh-token>
proliferateDevRefreshToken=<refresh-token>
```

The mobile app only consumes this in `__DEV__`. The token is exchanged through
the normal `/auth/mobile/session/refresh` endpoint, so server auth and account
readiness still run.

For profile-backed native mobile testing, use this pattern only with a refresh
token minted for a user in the same profile database. Until a repo-owned helper
exists for minting that token from a profile user, the canonical supported
paths are:

- mobile web against the profile
- `make dev-mobile-auth` for native OAuth

## Agent Gateway And Public Tunnels

For local Bifrost/managed-credit work:

```bash
make dev PROFILE=<name> AGENT_GATEWAY=bifrost
```

For E2B or public sandbox tests that need to call back into the local profile:

```bash
make dev PROFILE=<name> AGENT_GATEWAY=bifrost AGENT_GATEWAY_TUNNEL=ngrok
make dev PROFILE=<name> CLOUD_WORKER_TUNNEL=ngrok
```

The first command exposes both API callbacks and Bifrost through ngrok. The
second exposes only API worker callbacks.

## Verification Commands

Use the narrowest useful checks for the changed area:

```bash
pnpm --filter @proliferate/web typecheck
pnpm --filter @proliferate/mobile typecheck
pnpm --filter @proliferate/product-domain test
cd server && uv run pytest -q
cargo test --workspace
```

For release/deploy changes, read
[`ci-cd.md`](ci-cd.md) and run the workflow/helper checks
documented there.
