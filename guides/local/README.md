# Running Locally

Status: current procedure

Use one named dev profile per worktree. A profile keeps that worktree's ports,
Postgres database, AnyHarness runtime, Desktop state, and generated app identity
separate from other local runs.

## Quick Start

From the worktree root:

```bash
make setup PROFILE=<name>
make build # first clean worktree, or after generated/Rust/frontend artifacts change
make run PROFILE=<name>
```

`setup` allocates the profile and prepares its database. `build` produces the
runtime and shared frontend artifacts that `run` expects. `run` deliberately
does not rebuild; when an artifact is missing it reports the narrow build target
to run.

List profiles, their worktrees, assigned ports, and probed status with:

```bash
make dev-list
```

`make dev-init` and `make dev` remain compatibility aliases. Use the explicit
`setup`, `build`, and `run` sequence in new instructions and automation.

## Git Hooks

`make setup` and `make install` point this clone at the repository's checked-in
hooks with `git config core.hooksPath scripts/git-hooks`. Enable them on their
own at any time:

```bash
make git-hooks
```

`scripts/git-hooks/pre-commit` runs the frontend foundation checks against the
**staged** files only, so it costs a fraction of a second: the appearance-scaling
and design-vocabulary guard for staged `apps/packages/{ui,product-client}/src`
and `apps/desktop/src` sources, plus the generated-theme byte-equality check when
anything under `apps/packages/design/` is staged.

To record a commit without it, bypass per-commit:

```bash
git commit --no-verify
```

Bypassing is safe for work in progress: CI runs the same
`python3 scripts/check_appearance_scaling.py` over the whole repository and the
design package's `build` re-runs the theme equality check, so a bypassed
violation is caught before merge rather than silently landing.

## What Starts

`make run PROFILE=<name>` launches the profile's:

- AnyHarness runtime;
- Proliferate API server;
- Desktop renderer and Tauri Desktop app;
- hosted Web app; and
- local Redis dependency.

The launcher migrates the selected profile database before starting the apps.
It reserves a Mobile Web port but does not start Expo. It also does not start
Celery workers or the optional Stripe, LiteLLM, tunnel, native-Mobile, or SSO
flows unless their focused command or flag is used.

## Existing Postgres And Redis

By default, `setup` starts or reuses the repository's Docker Postgres service,
and `run` starts or reuses the Docker Postgres and Redis services. To use
services already running on the same host instead, select the existing-service
paths on every command that touches them:

```bash
make setup PROFILE=<name> USE_EXISTING_POSTGRES=1
make build # if this worktree needs artifacts
make run PROFILE=<name> USE_EXISTING_POSTGRES=1 USE_EXISTING_REDIS=1
```

The existing-Postgres path requires `psql` on `PATH`. Its default login role is
`proliferate`. Create that dedicated local role once from a PostgreSQL
administrator account, choosing a local password at the prompt:

```bash
createuser --createdb --pwprompt proliferate
```

On Ubuntu and WSL, the administrator invocation is commonly
`sudo -u postgres createuser --createdb --pwprompt proliferate`. The role needs
`LOGIN`, `CREATEDB`, and normal `CONNECT` access to the `postgres` maintenance
database; it does not need `SUPERUSER`, `CREATEROLE`, or `BYPASSRLS`. The
repository's local-only password default is `localdev`. If you choose another
password or role, provide `LOCAL_PGPASSWORD` and `LOCAL_PGUSER` in the
environment for both `setup` and `run`, and do not commit them.

Let `setup` create `proliferate_dev_<normalized_name>` so the login role owns
the database. If that database already exists, the login role must own the
database and its migration-managed objects; setup checks existence but does
not repair ownership.

The default endpoints are local Postgres on port `5432` and local Redis on port
`6379`. Override a nondefault Postgres endpoint with the `LOCAL_PG*` Make
variables. For a nondefault Redis endpoint, keep `LOCAL_REDIS_HOST` and
`LOCAL_REDIS_PORT` aligned with the server's `REDBEAT_REDIS_URL`; the readiness
checks only prove that the configured TCP ports accept connections.

## Constrained Hosts, Frontend Work, And Documentation

Frontend or documentation work does not require a new Rust build when it can
run against a known-good prebuilt AnyHarness binary. Choose an explicit binary
owned by the current checkout, a trusted shared build, or a teammate-provided
artifact; do not copy a machine-specific path into repository instructions.

```bash
PROLIFERATE_SHARED_RUNTIME=/absolute/path/to/known-good/anyharness
test -x "$PROLIFERATE_SHARED_RUNTIME"

make setup PROFILE=<name> USE_EXISTING_POSTGRES=1
SKIP_RUST=1 \
  ANYHARNESS_DEV_RUNTIME_BIN="$PROLIFERATE_SHARED_RUNTIME" \
  make run PROFILE=<name> USE_EXISTING_POSTGRES=1 USE_EXISTING_REDIS=1
```

Prerequisites are a previously built runtime compatible with the checked-out
AnyHarness API, native Postgres and Redis reachable at the configured
endpoints, server dependencies installed, and the frontend artifacts required
by `make run`. `SKIP_RUST=1` affects build targets; the explicit runtime path is
what makes `run` use the shared binary.

Artifact freshness is part of the contract:

- If `make run` reports a missing frontend artifact, run the narrow frontend or
  package build it names. `pnpm shared:build` rebuilds the design and
  ProductClient packages without compiling Rust.
- Rebuild the real Rust workspace/runtime when Rust source, AnyHarness wire
  contracts, generated AnyHarness SDK inputs, migrations, or runtime behavior
  changed. A shared binary cannot validate those changes.
- If the checked-out client expects a newer runtime contract than the shared
  binary provides, stop and obtain/build a matching runtime rather than
  treating startup or 404/shape failures as product regressions.
- Documentation-only work needs no profile or runtime at all; use the
  documentation proof below.

This path avoids Docker and Rust work only where the change surface permits
it. It does not qualify a release artifact or replace the owning package's
tests.

## Windows And WSL2

On Windows, run the Linux development workflow inside WSL2 and keep the
checkout in the WSL filesystem, such as `~/proliferate`, rather than under
`/mnt/c`. If you use the existing-service path above, the documented defaults
assume Postgres and Redis run inside the same WSL distribution. Windows-hosted
services may need endpoint overrides under NAT networking; mirrored networking
can make Windows-host loopback reachable instead. Either path needs separate
endpoint, authentication, and firewall verification, which this procedure does
not qualify.

WSL normally makes services bound to WSL loopback reachable from Windows
through `localhost`. That depends on the active WSL networking configuration,
VPN or enterprise policy, and the corresponding Windows-side ports being free.
Use `make dev-list` inside WSL to identify the profile's allocated ports, then
verify `http://localhost:<allocated-port>` from Windows for the service you
need.

Normal host-only development should not require `netsh portproxy`, Windows
Firewall, or Hyper-V firewall exceptions. Only consider those for intentional
LAN access after following
[Microsoft's WSL networking guidance](https://learn.microsoft.com/en-us/windows/wsl/networking).
The standard Proliferate launcher binds services to `127.0.0.1`; LAN exposure
is not qualified by this procedure.

## Profile State And Environment

The important profile-owned paths are:

```text
~/.proliferate-local/dev/profiles/<name>/profile.env   persisted allocation/input
~/.proliferate-local/dev/profiles/<name>/launch.env    generated launch values
~/.proliferate-local/dev/profiles/<name>/app/config.json
~/.proliferate-local/runtimes/<name>/                  AnyHarness runtime state
```

`profile.env` records stable profile allocation such as ports, database name,
and owned paths. `launch.env` is regenerated by the launcher with the effective
values used by the apps. Do not edit either file to distribute or copy
credentials.

The launcher reads `.env`, `.env.local`, `server/.env`, and
`server/.env.local`. Keep real local secrets only in ignored env files. Use
[`../../specs/developing/reference/env-vars.yaml`](../../specs/developing/reference/env-vars.yaml) to find the owner of
an environment variable.

The full state, port, database, identity, SSO, and gateway contract is in
[`dev-profiles.md`](dev-profiles.md).

## Common Modes

```bash
make run PROFILE=<name> STRIPE=1
make run PROFILE=<name> AGENT_GATEWAY=litellm
make run PROFILE=<name> CLOUD_WORKER_TUNNEL=ngrok
```

`STRIPE=1` adds test-mode webhook forwarding. `AGENT_GATEWAY=litellm` starts or
reuses the local LiteLLM gateway. `CLOUD_WORKER_TUNNEL=ngrok` exposes the local
API for Worker traffic and product-MCP OAuth callbacks; it does not expose
LiteLLM. Use the tunnel only for an external callback test, and stop the run
when the test is complete.

## Focused Runbooks

| Task | Runbook |
| --- | --- |
| Understand profile ownership, ports, identity, SSO, or LiteLLM | [`dev-profiles.md`](dev-profiles.md) |
| Choose a frontend-only, backend-session, or GitHub auth layer | [`feature-worktree-auth.md`](feature-worktree-auth.md) |
| Exercise local billing and Stripe webhooks | [`stripe-local-testing.md`](stripe-local-testing.md) |
| Manually smoke the GitHub App credential path | [`github-app-manual-qa.md`](github-app-manual-qa.md) |
| Run Mobile Web, native Mobile, or Mobile OAuth | [`mobile.md`](mobile.md) |

## Verification

After startup, use `make dev-list` to confirm the selected profile owns the
expected worktree and that its ports are reachable. Exercise the changed
surface through the printed local URL, then run the narrowest code check named
by that source area's documentation.

For documentation-only changes:

```bash
/opt/homebrew/bin/python3.12 scripts/check_docs.py
```

The checker requires Python 3.12. On a non-Homebrew host, invoke an equivalent
Python 3.12 interpreter from that host's managed toolchain.
