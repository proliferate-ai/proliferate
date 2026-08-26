# Dev Profiles

Status: current procedure

A dev profile is the isolation boundary for one full-stack local worktree. It
owns the worktree binding, ports, Postgres database name, AnyHarness runtime
home, Desktop state, and generated Tauri identity used by that run.

## Commands

```bash
make dev PROFILE=<name>   # setup, build whatever is stale, run
make dev-list
```

`make dev` is the whole launch. It builds only what changed, which on an
unchanged tree is a fraction of a second, so there is no reason to force a
rebuild before starting a profile.

The steps are still available separately when you want one of them on its own:

```bash
make setup PROFILE=<name>
make dev-build            # only what a running profile consumes
make build                # that, plus production bundles for both apps
make run PROFILE=<name>
```

| Variable | Effect |
|---|---|
| `HEADLESS=1` | Run without the Desktop app: runtime, API, and hosted Web only. Required with no display, and the shape to use when running several profiles at once. |
| `SKIP_BUILD=1` | `make dev` launches without consulting the build at all. |
| `SKIP_RUST=1` | No cargo in this worktree; set `ANYHARNESS_DEV_RUNTIME_BIN` to a prebuilt runtime. |
| `DEV_BUILD_ARGS=--force` | Rebuild every package regardless of whether its sources changed. |

`make dev-build` holds a single-instance lock covering the Rust build too, so
launching several profiles at once will not start several cargo builds. A second
launch waits and says so.

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
[`env-vars.yaml`](../../specs/areas/env-vars.yaml).

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

## Concurrency And Focused Paths

Independent profiles may run concurrently. OAuth and Desktop deep-link tests
must run serially because generated development apps share the
`proliferate-local://auth/callback` URL scheme. Concurrent Git operations on the
same checkout can also contend on Git locks.

Use the focused procedures for behavior-specific setup:

- [`feature-worktree-auth.md`](feature-worktree-auth.md) for local auth layers;
- [`stripe-local-testing.md`](stripe-local-testing.md) for Stripe;
- [`mobile.md`](mobile.md) for Mobile and native OAuth.

## Diagnostics

A dev profile produces no diagnostic records by default. Diagnostics are opt-in
because the export path is compile-time absent from customer builds, so a
default collector build cannot export at all.

To run any profile with diagnostics, build the collector once with the internal
feature and point the desktop host at it:

```bash
pgrep -x cargo; pgrep -x rustc   # one Rust build at a time on constrained machines
cargo build -p proliferate-diagnostics-collector --features internal-dogfood-export
export PROLIFERATE_DIAGNOSTICS_COLLECTOR_BIN=<path to that binary>
```

That alone gives renderer, host, worker, and collector records with no
credential and no network.

The AnyHarness runtime is the exception, and the omission that most often
reads as a product bug. Any profile that sets `ANYHARNESS_DEV_URL` runs the
runtime externally, so the desktop host never spawns it, the runtime never
inherits the control-bridge descriptor, and its diagnostics producer stays
disabled. Session, turn, ACP, and subagent records are then absent even though
the app behaves normally. Export them with:

```bash
export PROLIFERATE_DIAGNOSTICS_BRIDGE_ENDPOINT=<endpoint the host logs at boot>
```

Shipping records to a shared destination additionally needs
`PROLIFERATE_DIAGNOSTICS_OTLP_ENDPOINT` and
`PROLIFERATE_DIAGNOSTICS_OTLP_HEADERS`, and optionally
`PROLIFERATE_DIAGNOSTICS_DEV_TAG` to identify whose machine produced a record.
Keep the headers value, which carries an ingest key, in a mode-600 file outside
the repository. All five inputs are catalogued in
[`env-vars.yaml`](../../specs/areas/env-vars.yaml).

An unreachable or misconfigured destination never fails the app by design, so
"the app works but no records arrive" is a configuration symptom rather than a
code defect.

## Environment Sources

This document routes operators and developers to the files or systems that
supply environment configuration. It describes locations and precedence, not
secret values. The curated catalog of supported product inputs is
[`env-vars.yaml`](../../specs/areas/env-vars.yaml); deployment/bootstrap-only inputs and
workflow/release controls remain with their owning procedures.

### Direct Local Server

When the server runs directly from the `server/` directory, its settings load
optional files in this order:

1. `server/.env`
2. `server/.env.local`

The later local file overrides the earlier file. An explicit process
environment remains the runtime override accepted by the settings library.
There is no home-directory fallback for direct server settings.

### Profile-Based Local Development

The baseline environment-file composition used by `make run PROFILE=<name>` is,
from lower to higher precedence:

1. root `.env`
2. root `.env.local`
3. `server/.env`
4. `server/.env.local`
5. generated profile `launch.env` for profile-owned values

Profile state lives below
`~/.proliferate-local/dev/profiles/<name>/`. Within that directory,
`profile.env` persists profile allocation and input state used to generate
`launch.env`; the launcher does not source `profile.env` directly as the
process environment.

After composing the baseline files, the launcher:

1. loads the selected `.auth-env/.env.<auth-profile>` file, when an auth
   profile was selected;
2. adds conditional Stripe CLI and local Codex program values;
3. restores the incoming `DATABASE_URL` when one was supplied, or derives the
   selected profile's database URL; and
4. overwrites launcher-owned API, CORS, and Stripe callback URLs.

These launcher-owned values intentionally win over earlier files. See
[`README.md`](README.md) before creating or running a local
profile.

### Self-Hosted Deployment

The canonical self-hosted deployment composes:

1. `.env.static` for reviewed operator configuration;
2. `.env.local` for unmanaged host-local overrides; and
3. `.env.generated` for stable stack-managed secrets.

The deployment scripts produce `.env.runtime`, which is the environment file
passed to Docker Compose. Unmanaged `.env.local` entries override unmanaged
`.env.static` entries. The scripts write managed configuration and secrets
last, so those resolved values win in `.env.runtime`. Preserve
`.env.generated`, and do not edit `.env.runtime` directly.

Use [`../deploying/self-hosted-deploy.md`](../deploying/self-hosted-deploy.md)
for the canonical Compose procedure and
[`../deploying/self-hosted-aws.md`](../deploying/self-hosted-aws.md) for the AWS
launch-stack wrapper.

### Hosted Server

The reusable hosted deploy workflow reads the live ECS service definition,
renders the next revision's runtime environment, and registers that revision.
GitHub Environment variables remain inputs for the surfaces documented by the
workflow, and the live service supplies the prior task shape. The workflow
explicitly overwrites its owned runtime fields. `server/infra/main.tf` is a
bootstrap definition whose resource identities are not the current
staging/production service identities; do not infer current hosted state from
that module without an explicit import/reconciliation.

Most current sensitive inputs are written as ordinary task-definition
environment entries. Only values explicitly configured in the ECS `secrets`
collection are resolved by ECS from their named SSM Parameter Store or Secrets
Manager source. Do not infer universal secret-manager storage from a variable's
secret classification.

Hosted workflow inputs and deployment procedures are owned by
[`../deploying/hosted.md`](../deploying/hosted.md).

The hosted API consumes Redis for Cloud materialization and GitHub-refresh
leases even when the optional worker/Beat plane is disabled. The durable owner
for this binding is the isolated `server/infra/hosted-redis/`
Terraform root, not the bootstrap root or a manually entered GitHub variable.
Both the root and the deploy workflow consume
`server/deploy/hosted-redis-contract.json`, the single machine-readable owner
for the AWS account, region, workflow aliases, stable secret names, and existing
role names. The one-time adoption imported the two existing deploy child
policies and created the two missing execution child policies only after a
saved plan showed exactly that non-destructive shape. The root does not own the
roles, secrets, ECS services, secret values, or other pre-existing role
policies.

Each environment entry also selects the only direct background Redis reference
service and name that the optional worker/Beat re-image path accepts. The
workflow verifies the rendered task's exact contract execution role and an
account-, region-, service-, and name-bound `REDBEAT_REDIS_URL` reference before
registration. It also projects `E2B_API_KEY` from the same verified server-app
secret and supplies `E2B_TEMPLATE_NAME` from the reviewed environment variable;
both worker and Beat must carry exactly that pair. A future external endpoint
rebind must first update the Redis identity in this checked-in contract in the
same reviewed change; a GitHub Environment variable cannot override it.

After selecting one exact workflow alias from that contract and assuming its
role, the deploy verifies the live task definition's exact execution role,
resolves and masks the generated base ARN after every third-party action's main
phase, and passes it only to the first-party render step. Because those actions'
post-job hooks run later, the API render and background re-image transactions
keep identifier-bearing task JSON in private temporary directories and delete it
on every exit before the hooks execute. The deploy verifies the ARN's
account/region/environment identity, parses the JSON `REDBEAT_REDIS_URL` without
logging it, rejects literal and DNS-resolved loopback or unspecified addresses,
and requires a nonempty, whitespace-canonical `E2B_API_KEY` without logging it.
It authors both exact ECS field projections and removes inherited plaintext or
stale references. The server's loopback default is not a hosted source.

### Frontend, Mobile, and Desktop Native Builds

Frontend, mobile, and desktop-native build inputs come from each surface's
owning build configuration and the environment supplied by its build provider
or CI job. Consult the owning surface and its release procedure before changing
an input; these build environments do not share one repository-wide precedence
chain.

### Workflow and Release Controls

Workflow-only, publishing, signing, upload, and release-promotion controls are
owned by the workflow that consumes them and by
[`../deploying/README.md`](../deploying/README.md). They are deliberately
outside the application/runtime input catalog.

### Workspace and Agent Commands

AnyHarness owns the environment assembled for workspace process runs,
terminals, setup commands, and live agent launches. Its file layers and
protected metadata are documented in
[`workspace-command-environment.md`](../../specs/systems/workspaces/command-environment.md).
