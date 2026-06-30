# Running Locally

Status: authoritative for running Proliferate in local development.

Use dev profiles for full-stack development. A profile owns ports, database,
runtime state, desktop app home, and generated Tauri dev identity for one local
run. The low-level profile contract lives in
[`dev-profiles.md`](dev-profiles.md); this runbook
is the day-to-day path.

## Process Map

Use this folder to answer three local-development questions:

1. Working with Profiles:
   - full-stack local startup, profile state, profile env loading, desktop,
     hosted web, tunnels, and verification live in this runbook
   - profile ownership, ports, generated Tauri identity, gateway tunnels, and
     profile-scoped state live in [`dev-profiles.md`](dev-profiles.md)
2. Working with Stripe:
   - quick local Stripe startup is covered below
   - billing-specific setup, webhook forwarding, checkout, portal, refill,
     meter events, and local billing table checks live in
     [`stripe-local-testing.md`](stripe-local-testing.md)
3. Working with Mobile:
   - profile-backed mobile web, native mobile OAuth, Expo overrides, and the
     dev refresh-token path live in [`mobile.md`](mobile.md)

## Tools And Permissions

Required tools and surfaces:

- Local shell access with Rust stable, Node 22+, pnpm, Python 3.12, and `uv`.
- Browser or Chrome access for local Web, Desktop renderer, OAuth callbacks,
  provider consoles, Stripe, and hosted dashboards when a local flow depends on
  a logged-in external account.
- GitHub MCP, `gh`, or GitHub web access when local reproduction starts from a
  PR, issue, Actions artifact, release artifact, or support report.
- Stripe CLI for checkout, portal, subscription, refill, meter, webhook, or
  billing-state tests.
- Expo tooling, an iOS simulator, Android emulator, or physical device for
  native mobile flows.
- Optional tunnel tooling, such as ngrok, when testing native mobile OAuth,
  public callbacks, or agent gateway behavior that needs an external URL.

Required permissions depend on the local surface:

| Surface | Permissions |
| --- | --- |
| Baseline profile development | repo checkout access and permission to create local profile state under `~/.proliferate-local/` |
| GitHub-linked product flows | access to a test GitHub account and any provider app configuration needed for the callback under test |
| Billing | Stripe test-mode access and permission to run `stripe listen`; production Stripe access is not required for local QA |
| Native mobile OAuth | provider-console access for callback registration, plus Expo/EAS access only when build or submit behavior is in scope |
| Agent gateway / public tunnel | access to the relevant local env values and tunnel account; never paste gateway keys or callback secrets into chat, docs, PRs, or logs |

Keep real secrets in ignored env files and use
[`../reference/env-vars.yaml`](../reference/env-vars.yaml) for canonical
deployment variable ownership.

## Quick Start

From a repo worktree:

```bash
make setup PROFILE=<name>
make build # first clean worktree, or after generated/Rust/frontend artifacts change
make run PROFILE=<name>
```

On Pablo's machine, the shell helper is:

```bash
pdev <name>
```

`pdev` should initialize the profile, ensure the profile database exists, and
start the same profile-aware dev stack without rebuilding the repo. It is a
local shell convenience, not a repo contract.

Use explicit build targets when generated artifacts or binaries need refreshing:

```bash
make build-rust
make build-frontend
make build
```

`make run PROFILE=<name>` never invokes these build targets. It checks for the
existing AnyHarness debug binary and frontend package build artifacts and tells
you which explicit build target to run when they are missing.

`make dev PROFILE=<name>` remains a compatibility alias for `setup` plus `run`.

## What Starts

`make run PROFILE=<name>` starts:

- AnyHarness runtime on the profile's `ANYHARNESS_PORT`
- Proliferate server on the profile's `PROLIFERATE_API_PORT`
- Desktop renderer on the profile's `PROLIFERATE_WEB_PORT`
- Hosted web app on the profile's `PROLIFERATE_HOSTED_WEB_PORT`
- automation scheduler worker against the same profile database
- Tauri desktop app with generated profile identity

The profile launcher also starts and waits for local Redis from
`server/docker-compose.yml`. Redis backs RedBeat and the in-process cloud
materialization locks used by managed cloud development.

The Celery/RabbitMQ/redbeat worker-tier substrate is available for worker-tier
migration testing. The profile launcher starts the automation scheduler, but it
does not start Celery workers yet; cloud automation execution runs through the
`automations.execution` Celery queue.
For Slice 1 worker-tier checks that need RabbitMQ, start RabbitMQ explicitly:

```bash
docker compose -f server/docker-compose.yml up -d rabbitmq
```

Then verify the no-op worker app imports from `server/` without opening a broker
connection:

```bash
uv run python -c "from proliferate.background.celery_app import celery_app; print(celery_app.tasks['background.health.noop'].name)"
```

To run a local Celery worker for manual testing:

```bash
uv run celery -A proliferate.background.celery_app:celery_app worker -Q periodic.default --loglevel INFO
uv run celery -A proliferate.background.celery_app:celery_app worker -Q automations.execution --loglevel INFO
```

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
make run PROFILE=<name> STRIPE=1
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
[`stripe-local-testing.md`](stripe-local-testing.md).

## Web

The hosted web app starts automatically with the full profile. Open the profile
hosted web URL printed by `make run` or inspect it with:

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

## Email/Password Test Accounts

Email/password login is for provisioned accounts; public signup is not exposed.
To create or update a local account password, run:

```bash
read -r -s PROLIFERATE_REVIEWER_PASSWORD
uv --directory server run python scripts/provision_password_auth_user.py \
  --email reviewer@example.com \
  --password-env PROLIFERATE_REVIEWER_PASSWORD \
  --display-name 'Reviewer'
```

The account can sign in on Web and Mobile immediately. It requires a linked
GitHub identity before cloud workspaces and automations are product-ready.
Desktop keeps GitHub as the primary sign-in path, but an authenticated user can
add or change an email/password credential from Account settings.

## Desktop

The desktop app starts automatically at the end of `make run PROFILE=<name>`.
The generated app identity makes the macOS app bar show the profile name, such
as:

```text
Proliferate (<name>)
```

Desktop auth sessions, pending-auth entries, and stored provider API keys are
profile-scoped `0600` files under the dev app home. Native provider credential
files (the user's own Claude/Codex/Gemini CLI auth) and the AnyHarness runtime
data key (keychain) remain shared user-level secrets.

## Mobile Web Against A Profile

For browser-based mobile smoke testing, use the existing profile server and
database. The detailed mobile runbook is [`mobile.md`](mobile.md).

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
React Native-only rendering. The detailed mobile runbook is
[`mobile.md`](mobile.md).

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
make run PROFILE=<name> AGENT_GATEWAY=bifrost
```

For E2B or public sandbox tests that need to call back into the local profile:

```bash
make run PROFILE=<name> AGENT_GATEWAY=bifrost AGENT_GATEWAY_TUNNEL=ngrok
make run PROFILE=<name> CLOUD_WORKER_TUNNEL=ngrok
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
[`../deploying/ci-cd.md`](../deploying/ci-cd.md) and run the workflow/helper
checks documented there.
