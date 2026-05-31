# Worker Target

Status: authoritative for `anyharness/crates/proliferate-worker/src/target/**`.

`target/` owns target-local facts and effects. It can inspect the target and
write target-local files. It must not call raw Cloud endpoints or decide Cloud
product policy.

## Target Shape

```text
target/
  mod.rs
  materialization/
    mod.rs
    paths.rs
    files.rs
    env.rs
    git.rs
    git_identity.rs
    repo_checkout.rs
    runtime_config.rs
    agent_auth.rs
    manifest.rs

  inventory/
    mod.rs
    platform.rs
    versions.rs
    capabilities.rs
    providers.rs
    mcp.rs

  updates/
    mod.rs
    desired_versions.rs
    supervisor_mailbox.rs
    status.rs
```

## What Goes Where

| Area | Owns | Must Not Own |
| --- | --- | --- |
| `materialization/` | Target-local filesystem, Git, env, auth, runtime config, and manifest effects. | Cloud materialization plan creation, Cloud authorization, AnyHarness execution semantics, supervisor process management. |
| `inventory/` | Read-only local machine facts: platform, versions, capabilities, providers, MCP availability. | Mutating target state. |
| `updates/` | Worker side of desired-version observation: compare desired/installed versions, write supervisor mailbox, construct status reports. | Downloading/replacing binaries, restarting processes, rollback. |

## Materialization

`target/materialization/` owns target-local preparation work.

Files:

- `paths.rs`: allowed-root checks, home expansion, symlink traversal defense,
  path normalization, and path safety.
- `files.rs`: atomic/private file writes, directory creation, permissions, and
  common file helpers.
- `env.rs`: environment file materialization.
- `git.rs`: focused Git helpers.
- `git_identity.rs`: target-scoped Git credential/config materialization.
- `repo_checkout.rs`: clone/fetch/checkout and repo identity validation.
- `runtime_config.rs`: runtime config projection files, artifact integrity
  checks, and credential reference helpers.
- `agent_auth.rs`: target-local agent auth synced-file and gateway config
  materialization helpers.
- `manifest.rs`: `.proliferate/**` manifest writing.

Allowed:

- filesystem writes under allowed roots
- Git operations required for checkout/bootstrap
- local credential file writes approved by Cloud-provided plans
- artifact/hash validation
- target-local manifest generation

## Inventory

`target/inventory/` owns local facts about the machine.

Files:

- `platform.rs`: OS, arch, distro, shell.
- `versions.rs`: local tool version probes.
- `capabilities.rs`: local capability facts.
- `providers.rs`: agent/provider readiness facts.
- `mcp.rs`: local MCP capability facts.

Inventory code is read-only. It does not mutate target state.

## Updates

`target/updates/` owns the worker side of desired-version observation.

Files:

- `desired_versions.rs`: compare Cloud desired versions with observed installed
  versions.
- `supervisor_mailbox.rs`: write and clear supervisor update request files.
- `status.rs`: construct worker update status reports.

## Hard Rules

- Target code does not call raw Cloud HTTP.
- Target code does not decide Cloud authorization or exposure policy.
- Target materialization centralizes path safety and private file writes.
- Inventory code is read-only.
- Worker update code only writes the supervisor mailbox and reports status.
- Supervisor owns binary download, replacement, restart, and rollback.
