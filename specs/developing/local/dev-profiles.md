# Dev Profiles

Use dev profiles when running the full local stack from multiple worktrees.
The profile is the unit of local dev state: ports, database, AnyHarness runtime
home, desktop file-backed home, and the macOS dev app label.

## Commands

```bash
make setup PROFILE=<name>          # create/update profile state and database
make build                         # first clean worktree or artifact refresh
make dev-list                      # list profiles and TCP-probed status
make run PROFILE=<name>            # full stack for this profile, no rebuild
make run PROFILE=<name> STRIPE=1   # also run Stripe webhook forwarding
make run PROFILE=<name> AGENT_GATEWAY=1
                                    # also run/reuse local Bifrost for gateway work
make run PROFILE=<name> AGENT_GATEWAY=bifrost
                                    # also run/reuse local Bifrost for gateway work
make run PROFILE=<name> AGENT_GATEWAY=bifrost AGENT_GATEWAY_TUNNEL=ngrok
                                    # expose Bifrost and API worker callbacks through ngrok for E2B/public sandbox tests
make run PROFILE=<name> CLOUD_WORKER_TUNNEL=ngrok
                                    # expose only API worker callbacks through ngrok
make run PROFILE=<name> AUTH_PROFILE=google
                                    # load .auth-env/.env.google for deployment SSO testing
make seed-sso PROFILE=<name> AUTH_PROFILE=google ORG_ID=<org-id>
                                    # seed that profile's local org SSO connection from .auth-env/.env.google
make dev-web-auth                  # standalone web auth helper with ngrok callbacks
```

Profile names must be lowercase letters, numbers, hyphens, or underscores.
They are globally unique per machine and are bound to the first worktree that
uses them.

## What A Profile Owns

Profile state lives in:

```text
~/.proliferate-local/dev/profiles/<name>/
```

The profile stores non-secret defaults in `profile.env`, an effective
`launch.env`, generated Tauri dev config, launch runners, lock/instance state,
and the desktop file-backed app home. AnyHarness runtime state lives in:

```text
~/.proliferate-local/runtimes/<name>/
```

The dev launcher also writes `ANYHARNESS_WORKTREES_ROOT` into the profile launch
environment. By default it points at the standard local worktree checkout root:

```text
~/.proliferate-local/worktrees/
```

That keeps automatic AnyHarness checkout retention aligned with the checkout
paths normally created by the desktop app. Worktrees outside this managed root
remain visible as explicit workspace history/checkout actions where applicable,
but they are excluded from automatic per-repo retention and orphan pruning.

The default database is `proliferate_dev_<name>` on the local Docker Postgres
server. On macOS, profile database URLs default to `::1` so Docker Desktop's
Postgres listener is not confused with a Homebrew Postgres bound to
`127.0.0.1:5432`. Use `DATABASE_URL=... make run PROFILE=<name>` when you
intentionally want to bypass the profile database for a one-off run, or
`LOCAL_PGHOST=127.0.0.1` when you intentionally want a separate local Postgres.
When `DATABASE_URL` is set, profile setup and run skip profile database
creation/readiness checks and migrate the provided database URL.

Desktop auth sessions, pending-auth entries, and stored provider API keys are
profile-scoped `0600` files under the dev app home, so per-profile databases do
not reuse each other's login tokens. The AnyHarness runtime data key stays
shared in the keychain in v1 because it is a user-level secret, not profile
state. (See the sidecar spec's Local Secrets for the storage model.)

## Agent Gateway Local Dev

`make run PROFILE=<name> AGENT_GATEWAY=1` and
`make run PROFILE=<name> AGENT_GATEWAY=bifrost` start or reuse a local Bifrost
gateway and export the API env needed for Bifrost-backed managed credits and
personal BYOK development:

```text
AGENT_GATEWAY_ENABLED=true
AGENT_GATEWAY_BIFROST_BASE_URL=http://127.0.0.1:8080
AGENT_GATEWAY_BIFROST_PUBLIC_BASE_URL=http://127.0.0.1:8080
AGENT_GATEWAY_RECONCILER_ENABLED=true
AGENT_GATEWAY_USER_FREE_CREDIT_ENABLED=true
AGENT_GATEWAY_USER_FREE_CREDIT_USD=5
AGENT_GATEWAY_MANAGED_CREDIT_AGENT_KINDS=claude,codex
AGENT_GATEWAY_BYOK_ENABLED=true
AGENT_GATEWAY_PERSONAL_BYOK_ENABLED=true
AGENT_GATEWAY_BIFROST_ISOLATION_VERIFIED=true
AGENT_GATEWAY_ANTHROPIC_BYOK_ENABLED=true
AGENT_GATEWAY_OPENAI_BYOK_ENABLED=true
AGENT_GATEWAY_BEDROCK_BYOK_ENABLED=true
AGENT_GATEWAY_GEMINI_BYOK_ENABLED=true
```

For local UI testing, the public Bifrost URL can stay loopback. For E2B or any
remote managed sandbox that must reach the gateway and enroll its worker, pass
`AGENT_GATEWAY_TUNNEL=ngrok`. The dev command starts or reuses ngrok tunnels
for both the API worker callback port and the Bifrost port, then writes those
HTTPS URLs to `CLOUD_WORKER_BASE_URL`,
`CLOUD_MCP_OAUTH_CALLBACK_BASE_URL`, and
`AGENT_GATEWAY_BIFROST_PUBLIC_BASE_URL`. If a test only needs the worker/API
callback tunnel, use `CLOUD_WORKER_TUNNEL=ngrok`.

The dev launcher reads `.env`, `.env.local`, `server/.env`, and
`server/.env.local`. In Bifrost mode it automatically seeds managed-credit
provider env from `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` when the dedicated
`AGENT_GATEWAY_MANAGED_ANTHROPIC_API_KEY` or
`AGENT_GATEWAY_MANAGED_OPENAI_API_KEY` variables are not already set. The
current managed-credit implementation chooses one backing provider for the
default free-credit pool; if both Anthropic and OpenAI managed keys are set,
Anthropic is selected first. Personal BYOK forms can still expose both provider
types at the same time.

## Local SSO Auth Profiles

Manual OIDC SSO QA can load local-only provider credentials from
`.auth-env/.env.<auth-profile>`. Those files are ignored by git because they
contain client secrets. To run the deployment/self-hosted SSO path, pass the
auth profile to the normal dev launcher:

```bash
make run PROFILE=sso-google AUTH_PROFILE=google
```

To test org-scoped SSO without filling the settings form by hand, run the
normal profile and seed the local profile database:

```bash
make run PROFILE=sso-org
make seed-sso PROFILE=sso-org AUTH_PROFILE=google ORG_ID=<org-id>
```

The auth profile env uses the same `PROLIFERATE_SSO_*` names as deployment SSO,
including `PROLIFERATE_SSO_OIDC_ISSUER_URL`,
`PROLIFERATE_SSO_OIDC_CLIENT_ID`, and
`PROLIFERATE_SSO_OIDC_CLIENT_SECRET`. `PROLIFERATE_SSO_ALLOWED_DOMAINS` may be
blank for provider-only manual QA, or set to a comma-separated allowlist when
testing domain policy. If a provider app registration requires a different local
callback hostname than the API base URL, set
`PROLIFERATE_SSO_OIDC_CALLBACK_BASE_URL`, for example
`http://localhost:${PROLIFERATE_API_PORT}` for Microsoft Entra app registrations
that do not include the `127.0.0.1` callback.

## Ports And UI Identity

`scripts/dev.mjs` allocates stable ports for each profile:

- `PROLIFERATE_API_PORT`
- `PROLIFERATE_WEB_PORT` for the Tauri desktop renderer
- `PROLIFERATE_WEB_HMR_PORT`
- `PROLIFERATE_HOSTED_WEB_PORT` for the separate `apps/web/` app
- `PROLIFERATE_MOBILE_WEB_PORT` for Expo web smoke testing of `apps/mobile/`
- `PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE`
- `ANYHARNESS_PORT`

The Google Workspace MCP value is the base of a 64-port loopback pool used for
local Gmail OAuth callbacks. The generated Tauri config points the desktop at
`PROLIFERATE_WEB_PORT`, while `make run PROFILE=<name>` also starts the hosted
web app on `PROLIFERATE_HOSTED_WEB_PORT` and sets `FRONTEND_BASE_URL` to that
hosted web origin. Server CORS includes the desktop renderer, hosted web, Expo
mobile web, and Tauri origins. For browser-based mobile smoke tests, run Expo
web from the same profile environment so Mobile uses the profile API and
reserved mobile web port:

```bash
source ~/.proliferate-local/dev/profiles/<name>/launch.env
pnpm --dir apps/mobile web:profile
```

On macOS, profile dev also uses a generated Tauri runner so the unbundled debug
app appears as `Proliferate (<profile>)` in the app bar instead of every profile
appearing as `proliferate`.

## Scope Notes

`make setup PROFILE=<name>` and `make run PROFILE=<name>` are the
profile-aware workflow. `make dev PROFILE=<name>` remains a compatibility alias
for setup plus run. The individual
`make dev-runtime`, `make dev-server`, and `make dev-desktop` shortcuts remain
default-port shortcuts.

OAuth and deep-link login flows are still single-profile-at-a-time in v1 because
the OS URL scheme is shared. Concurrent git operations against the same checkout
can still race on git locks.

## Mobile Auth Testing

Use the mobile auth helper when testing Expo Go on a physical phone:

```bash
make dev-mobile-auth
```

The helper starts/checks local Postgres, runs server migrations, starts ngrok
for the API, starts the server with `API_BASE_URL` set to the ngrok URL, and
starts Expo with `EXPO_PUBLIC_PROLIFERATE_API_BASE_URL` set to the same URL.
It prints the Google mobile redirect URI to add in Google Console:

```text
https://<ngrok-host>/auth/mobile/google/callback
```

By default Expo runs through its tunnel and picks the first free Metro port at
or above `8081`. Override with:

```bash
PROLIFERATE_MOBILE_PORT=8090 make dev-mobile-auth
MOBILE_EXPO_ARGS="--lan" make dev-mobile-auth
```

For the full local mobile decision tree, see
[`mobile.md`](mobile.md).

## Bundled Agent Seed Testing

Packaged desktop builds resolve bundled agent seeds from Tauri resources and
pass the resolved seed directory to the AnyHarness sidecar. Local development can
exercise the same hydration path by setting:

```bash
ANYHARNESS_AGENT_SEED_DIR=/absolute/path/to/agent-seeds make run PROFILE=<name>
```

The directory should contain the generated target archive and checksum:

```text
agent-seed-<target>.tar.zst
agent-seed-<target>.sha256
```

For normal dev/debug builds, `ANYHARNESS_AGENT_SEED_DIR` is trusted as a local
developer override and health reports the source as `external_dev`. In packaged
builds, arbitrary external seed dirs are ignored unless
`ANYHARNESS_AGENT_SEED_DIR_UNSAFE=1` is also set. That keeps production packaged
apps on signed Tauri resources by default.

Each profile has its own AnyHarness runtime home, so seed hydration state lives
under `~/.proliferate-local/runtimes/<name>/` and does not cross profiles.
