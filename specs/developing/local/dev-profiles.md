# Dev Profiles

Use dev profiles when running the full local stack from multiple worktrees.
The profile is the unit of local dev state: ports, database, AnyHarness runtime
home, desktop file-backed home, and the macOS dev app label.

## Commands

```bash
make dev-init PROFILE=<name>       # create or update profile state
make dev-list                      # list profiles and TCP-probed status
make dev PROFILE=<name>            # full stack for this profile
make dev PROFILE=<name> STRIPE=1   # also run Stripe webhook forwarding
make dev PROFILE=<name> AGENT_GATEWAY=1
                                    # also run/reuse local Bifrost for gateway work
make dev PROFILE=<name> AGENT_GATEWAY=bifrost
                                    # also run/reuse local Bifrost for gateway work
make dev PROFILE=<name> AGENT_GATEWAY=bifrost AGENT_GATEWAY_TUNNEL=ngrok
                                    # expose Bifrost and API worker callbacks through ngrok for E2B/public sandbox tests
make dev PROFILE=<name> CLOUD_WORKER_TUNNEL=ngrok
                                    # expose only API worker callbacks through ngrok
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
`127.0.0.1:5432`. Use `DATABASE_URL=... make dev PROFILE=<name>` when you
intentionally want to bypass the profile database for a one-off run, or
`LOCAL_PGHOST=127.0.0.1` when you intentionally want a separate local Postgres.

Desktop auth sessions and pending-auth entries are profile-scoped in the dev
Keychain so per-profile databases do not reuse each other's login tokens.
Provider API keys and the AnyHarness runtime data key stay shared in v1 because
those credentials are user-level local secrets, not profile state.

## Agent Gateway Local Dev

`make dev PROFILE=<name> AGENT_GATEWAY=1` and
`make dev PROFILE=<name> AGENT_GATEWAY=bifrost` start or reuse a local Bifrost
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
`PROLIFERATE_WEB_PORT`, while `make dev PROFILE=<name>` also starts the hosted
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

`make dev PROFILE=<name>` is the profile-aware workflow. The individual
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
ANYHARNESS_AGENT_SEED_DIR=/absolute/path/to/agent-seeds make dev PROFILE=<name>
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
