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

## Ports And UI Identity

`scripts/dev.mjs` allocates stable ports for each profile:

- `PROLIFERATE_API_PORT`
- `PROLIFERATE_WEB_PORT`
- `PROLIFERATE_WEB_HMR_PORT`
- `ANYHARNESS_PORT`

The generated Tauri config points the desktop at those ports. On macOS, profile
dev also uses a generated Tauri runner so the unbundled debug app appears as
`Proliferate (<profile>)` in the app bar instead of every profile appearing as
`proliferate`.

## Scope Notes

`make dev PROFILE=<name>` is the profile-aware workflow. The individual
`make dev-runtime`, `make dev-server`, and `make dev-desktop` shortcuts remain
default-port shortcuts.

OAuth and deep-link login flows are still single-profile-at-a-time in v1 because
the OS URL scheme is shared. Concurrent git operations against the same checkout
can still race on git locks.

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
