# Cloud Worker Runtime Bundle And Supervisor Spec

Status: concrete follow-up PR spec.

Scope: PR A in the Cloud Worker migration sequence.

This spec defines the implementation work required to make every
cloud-addressable target boot the same supervised runtime bundle:

```text
proliferate-supervisor
  starts and restarts:
    anyharness
    proliferate-worker
```

The target may be a managed cloud sandbox, an SSH machine, or a future
self-hosted/VPC target. The process shape must be the same even when the
onboarding flow differs.

This spec intentionally does not cover the next two PRs:

- adding missing command kinds such as workspace/worktree materialization
- migrating automations fully to target-agnostic CloudCommand orchestration

Those PRs should assume the runtime bundle and process lifecycle in this file
are already correct.

## Goal

Answer this operational question:

```text
When Cloud says "this machine is a Proliferate target," exactly which binaries
exist on that machine, who starts them, who restarts them, how versions are
reported, and how can we prove the target is alive?
```

By the end of this PR:

- runtime artifacts contain `anyharness`, `proliferate-worker`, and
  `proliferate-supervisor`
- SSH installation creates a supervisor-managed target, not a worker-only
  process
- managed cloud/E2B provisioning starts `proliferate-supervisor`, not detached
  `anyharness` and detached `proliferate-worker` independently
- `proliferate-worker` enrolls and heartbeats through the existing worker APIs
- target inventory reports all runtime component versions
- local development and CI/template smoke tests verify the bundle and process
  shape

## Non-Goals

Do not add or change automation execution semantics in this PR.

Do not add missing CloudCommand kinds such as `materialize_workspace` in this
PR.

Do not delete all direct server-to-AnyHarness runtime calls in this PR. Direct
execution mutation removal belongs to the automation migration PR. This PR may
move managed cloud process launch away from direct detached process scripts.

Do not build a full update rollout product in this PR. The PR should make
component version reporting and supervisor update hooks structurally correct.
The production rollout policy can remain basic.

## Invariants

All target kinds use the same process role model:

```text
supervisor owns process lifecycle
worker owns cloud transport
AnyHarness owns runtime execution
Cloud owns target registry and desired state
```

Cloud may provision infrastructure and write launch config, but Cloud must not
be the long-running process supervisor for target-local runtime components.

The worker should never be the only long-lived process installed as the target
service. If the worker dies, the supervisor restarts it. If AnyHarness dies,
the supervisor restarts it.

The supervisor should not own Cloud command semantics, session semantics,
credential policy, or transcript/event interpretation.

## Current State On Stack Tip

The stack already includes these pieces:

- `anyharness/crates/proliferate-worker/**`
- `anyharness/crates/proliferate-supervisor/**`
- worker enrollment, heartbeat, inventory, command leasing, event upload, and
  update status endpoints
- SSH installer that downloads/copies all three binaries and creates a
  supervisor systemd user service
- managed cloud bootstrap that can stage `anyharness` and `proliferate-worker`
  and launch them directly

The main gap is managed cloud process ownership:

```text
current managed cloud shape:
  server writes AnyHarness launch script
  server starts AnyHarness with nohup
  server writes worker config
  server starts worker with nohup

target managed cloud shape:
  server writes worker config
  server writes supervisor config
  server starts supervisor with nohup or template entrypoint
  supervisor starts AnyHarness and worker
```

SSH is closer to target state than managed cloud. It still needs test hardening
and possibly bundle download cleanup.

## Branching

Implement this PR on top of the current worker stack tip, not on the first SDK
branch:

```text
base: origin/proliferate/cloud-worker-phase8-hardening
branch: proliferate/cloud-worker-runtime-supervisor
```

If the stack tip changes, rebase this PR onto the latest tip before opening.

## File Ownership Map

### Runtime Crates

```text
anyharness/crates/anyharness/**
anyharness/crates/proliferate-worker/**
anyharness/crates/proliferate-supervisor/**
Cargo.toml
Cargo.lock
```

Expected work:

- confirm all three crates are workspace members
- confirm release builds produce all three binaries
- add missing `--version` support if any component cannot report a version
- keep worker and supervisor responsibilities separate

### SSH Installer

```text
install/proliferate-target-install.sh
install/README.md
```

Expected work:

- keep the installer installing all three binaries
- keep the installed systemd user service pointing at
  `proliferate-supervisor`
- make the generated supervisor config match managed cloud config shape where
  possible
- document `PROLIFERATE_ARTIFACT_BASE_URL`, `PROLIFERATE_HOME`,
  `PROLIFERATE_CLOUD_URL`, `PROLIFERATE_ENROLLMENT_TOKEN`,
  `PROLIFERATE_ANYHARNESS_BASE_URL`, and `PROLIFERATE_SERVICE_NAME`
- add or preserve clear dev testing instructions for piping a local installer
  over SSH

Current target service shape:

```text
ExecStart=$PROLIFERATE_HOME/bin/proliferate-supervisor \
  --config $PROLIFERATE_HOME/supervisor/config.toml run
```

That shape should remain.

### Managed Cloud Bootstrap

```text
server/proliferate/server/cloud/runtime/bootstrap.py
server/proliferate/server/cloud/runtime/provision.py
server/proliferate/server/cloud/runtime/sandbox_exec.py
server/proliferate/integrations/sandbox/e2b.py
server/proliferate/constants/sandbox/e2b.py
server/proliferate/config.py
```

Expected work:

- replace managed cloud direct detached AnyHarness launch with supervisor launch
- replace managed cloud direct detached worker launch with supervisor launch
- stage or verify all three binaries on the sandbox
- write worker config before supervisor start
- write supervisor config before supervisor start
- keep existing AnyHarness health verification, but treat worker enrollment as
  the target availability signal
- persist the worker-created `target_id` on the runtime environment as today
- make reusable helper names describe runtime bundle concepts, not only
  AnyHarness

### Cloud Worker Registration

```text
server/proliferate/server/cloud/worker/api.py
server/proliferate/server/cloud/worker/service.py
server/proliferate/db/store/cloud_sync/worker_auth.py
server/proliferate/db/store/cloud_sync/targets.py
server/proliferate/db/store/cloud_sync/inventory.py
```

Expected work:

- no large API redesign
- ensure heartbeat/inventory response continues to carry desired versions
- ensure managed cloud enrollment flow produces a visible online target
- add tests if managed cloud provisioning now depends on a stronger
  target-online wait condition

### Release And Template Workflows

```text
.github/workflows/release-runtime.yml
.github/workflows/release-cloud-template.yml
.github/workflows/promote-cloud-template.yml
scripts/build-template.mjs
scripts/promote-cloud-template.mjs
scripts/smoke-cloud-template.mjs
scripts/smoke-e2b-runtime.mjs
server/infra/self-hosted-aws/template.yaml
server/infra/self-hosted-aws/README.md
```

Expected work:

- build and publish all three runtime binaries for supported Linux targets
- ensure cloud template build includes or downloads all three binaries
- ensure local template build uses the same binary names and install layout as
  production template build
- ensure self-hosted runtime asset references do not assume only `anyharness`
- smoke template should fail if any of the three binaries is missing or
  non-executable

## Runtime Bundle Model

The release artifact should be thought of as a runtime bundle even if the first
implementation still downloads individual binaries.

Logical bundle contents:

```text
runtime-bundle/
  bin/
    anyharness
    proliferate-worker
    proliferate-supervisor
```

Preferred installed layout:

```text
$PROLIFERATE_HOME/
  bin/
    anyharness
    proliferate-worker
    proliferate-supervisor
  worker/
    config.toml
    worker.sqlite3
  supervisor/
    config.toml
    update/
      staging/
      rollback/
  logs/
    anyharness.log
    proliferate-worker.log
    proliferate-supervisor.log
```

The first PR does not have to migrate every log path if that creates churn, but
the spec target should be represented in helper names and tests.

## Supervisor Config

The config should be sufficient to start both child processes:

```toml
anyharness_binary = "/home/user/.proliferate/bin/anyharness"
worker_binary = "/home/user/.proliferate/bin/proliferate-worker"
worker_config = "/home/user/.proliferate/worker/config.toml"
anyharness_args = [
  "serve",
  "--require-bearer-auth",
  "--host",
  "127.0.0.1",
  "--port",
  "8457"
]
restart_delay_seconds = 5
```

For SSH, binding AnyHarness to `127.0.0.1` is preferred. The worker talks to
AnyHarness locally. Direct remote access should be explicit, not the default.

For managed cloud, the runtime endpoint behavior depends on E2B/provider
networking. If a provider endpoint requires `0.0.0.0`, the config may use that
for managed cloud, but the reason must live in the bootstrap helper and tests.

## Worker Config

Worker config continues to contain Cloud and local AnyHarness details:

```toml
cloud_base_url = "https://api.proliferate.dev"
enrollment_token = "..."
anyharness_base_url = "http://127.0.0.1:8457"
anyharness_bearer_token = "..."
worker_db_path = "/home/user/.proliferate/worker/worker.sqlite3"
heartbeat_interval_seconds = 30
```

The worker remains responsible for enrollment, heartbeat, inventory,
commands, event upload, and update status. The supervisor only starts and
restarts it.

## Managed Cloud Boot Flow

Target flow:

```text
1. Cloud provisions or reconnects sandbox.
2. Cloud ensures runtime bundle exists on sandbox:
     anyharness
     proliferate-worker
     proliferate-supervisor
3. Cloud writes worker config with enrollment token and local AnyHarness URL.
4. Cloud writes supervisor config.
5. Cloud launches supervisor.
6. Supervisor starts AnyHarness.
7. Supervisor starts worker.
8. Cloud waits for AnyHarness health for backwards-compatible workspace
   preparation.
9. Cloud waits for worker enrollment/heartbeat and target online.
10. Cloud stores runtime_environment.target_id.
11. Provisioning continues with workspace preparation until PR C moves that
    work behind commands.
```

This PR may keep the existing direct workspace preparation calls after
supervisor boot. The automation migration PR will remove execution mutation
calls.

## SSH Boot Flow

Target flow:

```text
1. User creates target enrollment token from Cloud/Desktop UI.
2. UI shows install command.
3. Installer downloads or copies all three binaries.
4. Installer writes worker config.
5. Installer writes supervisor config.
6. Installer creates systemd user service for supervisor.
7. Supervisor starts AnyHarness and worker.
8. Worker enrolls and reports inventory.
9. Cloud/Desktop shows target online.
```

The SSH install command should not require a direct inbound route to
AnyHarness. It should require only outbound access to Cloud.

## Version And Update Shape

Worker heartbeat already reports:

```text
anyharness_version
worker_version
supervisor_version
```

Cloud target desired versions already model:

```text
desired_anyharness_version
desired_worker_version
desired_supervisor_version
update_generation
update_channel
```

This PR should ensure every process can produce real version values and that
managed cloud and SSH both report them.

Minimum update flow for this PR:

```text
1. Worker heartbeat receives desired versions.
2. Worker determines whether desired versions differ from current versions.
3. Worker calls or signals supervisor update hook.
4. Supervisor can verify/stage artifacts with existing update commands.
5. Worker reports update status to Cloud.
```

If the final swap/restart path is not production-ready, document it as pending
and make tests cover only verify/stage/status paths. Do not fake applied
updates.

## Exact Implementation Tasks

### Task 1: Normalize Runtime Binary Resolution

Files:

```text
server/proliferate/server/cloud/runtime/bootstrap.py
server/proliferate/config.py
```

Add or confirm helpers:

```python
resolve_local_runtime_binary_path()      # anyharness
resolve_local_worker_binary_path()       # proliferate-worker
resolve_local_supervisor_binary_path()   # proliferate-supervisor
```

Add config if missing:

```text
CLOUD_RUNTIME_SOURCE_BINARY_PATH
CLOUD_WORKER_SOURCE_BINARY_PATH
CLOUD_SUPERVISOR_SOURCE_BINARY_PATH
```

Acceptance:

- unit test can override each binary path
- missing binary error names the missing component
- managed cloud staging code never silently skips supervisor

### Task 2: Stage Or Verify Runtime Bundle

Files:

```text
server/proliferate/server/cloud/runtime/bootstrap.py
server/tests/unit/test_e2b_runtime.py
```

Add helpers:

```python
runtime_bundle_paths(runtime_context)
check_runtime_bundle_preinstalled(...)
stage_runtime_bundle(...)
```

or equivalent explicit helpers for all three binaries.

Acceptance:

- template preinstall check verifies all required binaries
- local upload path writes all required binaries
- smoke/unit tests fail if supervisor is absent

### Task 3: Build Managed Cloud Supervisor Config

Files:

```text
server/proliferate/server/cloud/runtime/bootstrap.py
```

Add helpers:

```python
supervisor_config_path(runtime_context)
supervisor_log_path(runtime_context)
build_supervisor_config(...)
build_detached_supervisor_launch_command(...)
```

The generated config must include:

- anyharness binary path
- worker binary path
- worker config path
- AnyHarness serve args
- restart delay

Acceptance:

- unit test snapshots or asserts config fields
- config uses the same local AnyHarness URL the worker config uses
- config can express provider-specific bind host/port

### Task 4: Replace Managed Cloud Direct Process Launch

Files:

```text
server/proliferate/server/cloud/runtime/provision.py
server/proliferate/server/cloud/runtime/bootstrap.py
```

Replace:

```text
build_runtime_launch_script(...)
build_detached_runtime_launch_command(...)
build_detached_worker_launch_command(...)
```

for managed cloud launch with:

```text
write worker config
write supervisor config
launch supervisor
```

Keep health checks:

```text
wait_for_runtime_health(...)
verify_runtime_auth_enforced(...)
```

Add target readiness check:

```text
wait_for_worker_target_online(runtime_environment_id or target_id)
```

Acceptance:

- managed cloud path starts only one long-lived root process:
  `proliferate-supervisor`
- worker still enrolls and target becomes online
- runtime environment records target id

### Task 5: Harden SSH Installer Around Supervisor

Files:

```text
install/proliferate-target-install.sh
install/README.md
scripts/cloud-ssh-worker-smoke.py
Makefile
```

Keep or add assertions:

- all three binaries are installed
- supervisor config exists
- worker config exists
- systemd user service points at `proliferate-supervisor`
- service starts successfully
- AnyHarness health succeeds locally
- worker target is online in Cloud

Acceptance:

```bash
make test-cloud-ssh-worker ...
```

should prove the supervisor service, not only worker enrollment.

### Task 6: Template And Release Packaging

Files:

```text
.github/workflows/release-runtime.yml
.github/workflows/release-cloud-template.yml
.github/workflows/promote-cloud-template.yml
scripts/build-template.mjs
scripts/smoke-cloud-template.mjs
scripts/smoke-e2b-runtime.mjs
server/infra/self-hosted-aws/template.yaml
```

Acceptance:

- release workflow builds all three binaries
- cloud template build includes all three or downloads all three
- smoke test checks `anyharness --version`,
  `proliferate-worker --version`, and `proliferate-supervisor --version`
- no workflow still treats `anyharness` as the only runtime artifact

### Task 7: Observability

Files:

```text
anyharness/crates/proliferate-supervisor/src/observability.rs
anyharness/crates/proliferate-supervisor/src/process/*
server/proliferate/server/cloud/worker/service.py
```

Acceptance:

- supervisor logs child start/stop/restart
- worker heartbeat exposes all component versions
- Cloud target patch includes enough version/status detail to debug target boot

## Tests

### Unit Tests

Add or update:

```text
server/tests/unit/test_e2b_runtime.py
server/tests/unit/test_cloud_worker_runtime_bundle.py
```

Suggested cases:

- runtime bundle path resolution finds all three binaries
- runtime bundle path resolution fails with component-specific error
- supervisor config includes AnyHarness and worker commands
- managed cloud launch command invokes supervisor
- template preinstall check requires supervisor

### Rust Tests

Add tests where practical:

```text
anyharness/crates/proliferate-supervisor/src/config.rs
anyharness/crates/proliferate-supervisor/src/install/service.rs
anyharness/crates/proliferate-supervisor/src/update/*
```

Suggested cases:

- config parses expected TOML
- generated service starts supervisor command
- update verify rejects bad sha256
- update stage writes artifact to expected staging path

### Smoke Tests

SSH smoke:

```bash
make test-cloud-ssh-worker PROFILE=worker ...
```

Must assert:

- remote service unit exists
- unit `ExecStart` references `proliferate-supervisor`
- supervisor process is running
- AnyHarness child is running
- worker child is running
- Cloud target is online
- target inventory includes `default_workspace_root`
- `default_workspace_root` exists on the target and is writable by the
  supervised runtime user
- killing AnyHarness results in restart
- killing worker results in restart

Managed cloud smoke:

```bash
node scripts/smoke-e2b-runtime.mjs
```

Must assert:

- template has all three binaries
- supervisor starts
- worker enrolls
- target online appears in Cloud
- AnyHarness health succeeds through provider endpoint
- target inventory includes a writable default workspace root for future
  repo/worktree materialization commands

This PR does not need to create an automation worktree. It only proves the
target has a stable writable root that later `materialize_workspace(mode =
worktree)` commands can use.

## Completion Checklist

Before opening the PR:

- [ ] all three binaries build locally for the target Linux release profile
- [ ] SSH installer still works against a clean target
- [ ] managed cloud starts supervisor instead of direct detached AnyHarness and
      worker processes
- [ ] Cloud target online is driven by worker heartbeat/enrollment
- [ ] runtime environment stores `target_id`
- [ ] template build/smoke checks all three binaries
- [ ] docs mention supervised runtime bundle, not only AnyHarness binary
- [ ] `rg "launch_worker_nohup|launch_runtime_nohup|build_detached_worker_launch_command"` has
      no managed cloud production process-launch usage left, or each remaining
      hit is a backwards-compatible helper marked for deletion

## Review Questions

Reviewers should be able to answer:

1. If AnyHarness crashes on an SSH target, who restarts it?
2. If the worker crashes on managed cloud, who restarts it?
3. How does Cloud know the target is alive?
4. Which version of each component is running?
5. Does managed cloud boot use the same runtime bundle as SSH?
6. Can template CI fail if `proliferate-supervisor` is missing?
7. Is any server code still acting as a long-running process supervisor?

If any answer is unclear, the PR is not finished.
