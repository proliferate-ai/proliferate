# Dev Profiles

Status: current procedure

A dev profile is the isolation boundary for one full-stack local worktree. It
owns the worktree binding, ports, Postgres database name, AnyHarness runtime
home, Desktop state, and generated Tauri identity used by that run.

## Commands

```bash
make setup PROFILE=<name>
make build # first clean worktree or after generated/Rust/frontend artifacts change
make run PROFILE=<name>
make dev-list
```

Optional modes are explicit:

```bash
make run PROFILE=<name> STRIPE=1
make run PROFILE=<name> AGENT_GATEWAY=litellm
make run PROFILE=<name> CLOUD_WORKER_TUNNEL=ngrok
make run PROFILE=<name> AUTH_PROFILE=google
```

Profile names match `^[a-z0-9][a-z0-9_-]{0,39}$`: at most 40 lowercase
letters, numbers, hyphens, or underscores, starting with a letter or number. A
name is bound to the first worktree that uses it. Give every worktree its own
name; do not reuse another branch's profile.

`make dev PROFILE=<name>` remains a compatibility alias for `setup` plus `run`.
The default-port `make dev-runtime`, `make dev-server`, and `make dev-desktop`
targets are not substitutes for an isolated full-stack profile.

## State Ownership

Profile state lives under:

```text
~/.proliferate-local/dev/profiles/<name>/
├── profile.env       persisted profile allocation/input
├── launch.env        generated effective launch values
├── app/
│   └── config.json   Desktop host configuration
├── tauri.dev.json    generated Tauri configuration
├── instance.json     worktree, branch, state, and port metadata
└── run.lock          active-launch ownership

~/.proliferate-local/runtimes/<name>/   AnyHarness runtime state
```

`profile.env` persists allocated ports and owned paths so the profile remains
stable across runs. `launch.env` is regenerated from those inputs and contains
the values consumed by the local apps. They are launcher state, not interfaces
for copying credentials between profiles.

Desktop auth sessions, pending-auth entries, and stored provider API keys are
profile-scoped files under `app/`. Native agent credential files and the
AnyHarness runtime data key remain user-level state rather than profile state.

The default Postgres database is `proliferate_dev_<normalized_name>`, with
profile hyphens replaced by underscores. `setup` prepares it; `run` checks it
and applies migrations. An explicit invocation-level `DATABASE_URL` bypasses
the profile database for that invocation. Keep a profile with its branch for
the lifetime of any one-way Postgres or AnyHarness SQLite migration.

Automatic AnyHarness checkouts default to:

```text
~/.proliferate-local/worktrees/
```

The launcher writes that path into the profile as
`ANYHARNESS_WORKTREES_ROOT`. Checkouts elsewhere can still be used explicitly,
but are outside automatic retention and orphan pruning.

## Environment Composition

For ordinary variables, later layers override earlier layers:

```text
.env
  < .env.local
  < server/.env
  < server/.env.local
  < generated launch.env for profile-owned values
  < .auth-env/.env.<AUTH_PROFILE> when AUTH_PROFILE is selected
```

An invocation-level `DATABASE_URL` is captured before file loading and bypasses
profile database selection; otherwise the launcher resolves and exports the
profile database after composition. Keep real local secrets in ignored env
files, not `profile.env`, `launch.env`, chat, issues, or committed
documentation. The environment-variable ownership reference is
[`../reference/env-vars.yaml`](../reference/env-vars.yaml).

## Ports And App Identity

The profile allocates stable values for:

- `PROLIFERATE_API_PORT`;
- `PROLIFERATE_WEB_PORT` and `PROLIFERATE_WEB_HMR_PORT` for the Desktop
  renderer;
- `PROLIFERATE_HOSTED_WEB_PORT` for Web;
- `PROLIFERATE_MOBILE_WEB_PORT` for Mobile Web;
- `PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE` for the local Gmail OAuth
  callback pool; and
- `ANYHARNESS_PORT`.

The generated Tauri runner displays the macOS app as `Proliferate (<name>)` and
points it at the profile renderer and runtime. Server CORS includes the
profile's Desktop, Web, Mobile Web, and Tauri origins.

Inspect allocation and reachability without sourcing generated env state:

```bash
make dev-list
```

## LiteLLM And External Callbacks

Enable the local agent gateway with:

```bash
make run PROFILE=<name> AGENT_GATEWAY=litellm
```

The launcher starts or reuses the repository's local LiteLLM service and sets
the server's LiteLLM gateway values. Its default URL is loopback. The known
local development master key is accepted only for a loopback gateway; set an
explicit secret for any shared or remote LiteLLM instance.

If a remote Worker or product-MCP provider must call the local API, use:

```bash
make run PROFILE=<name> CLOUD_WORKER_TUNNEL=ngrok
```

This publishes the selected profile's API as `CLOUD_WORKER_BASE_URL` and
`CLOUD_MCP_OAUTH_CALLBACK_BASE_URL`. It does not tunnel LiteLLM. Use it only
while an external callback is required, do not publish secrets in the tunnel
log, and stop it after the test.

## Local SSO

Deployment-style OIDC QA may load ignored provider credentials from
`.auth-env/.env.<auth-profile>`:

```bash
make run PROFILE=sso-google AUTH_PROFILE=google
```

The launcher prints the callback URL to register with the dedicated test
provider app. Use the same `PROLIFERATE_SSO_*` variables as deployment. When a
provider requires `localhost` rather than `127.0.0.1`, set
`PROLIFERATE_SSO_OIDC_CALLBACK_BASE_URL` in the ignored auth profile.

For org-scoped SSO, seed only the selected profile database:

```bash
make setup PROFILE=sso-org
make seed-sso PROFILE=sso-org AUTH_PROFILE=google ORG_ID=<org-id>
make run PROFILE=sso-org AUTH_PROFILE=google
```

Never use a production/shared OAuth app for local callback experiments, and do
not commit `.auth-env` credentials.

## Concurrency And Focused Paths

Independent profiles may run concurrently. OAuth and Desktop deep-link tests
must run serially because generated development apps share the
`proliferate-local://auth/callback` URL scheme. Concurrent Git operations on the
same checkout can also contend on Git locks.

Use the focused procedures for behavior-specific setup:

- [`feature-worktree-auth.md`](feature-worktree-auth.md) for local auth layers;
- [`stripe-local-testing.md`](stripe-local-testing.md) for Stripe;
- [`mobile.md`](mobile.md) for Mobile and native OAuth.
