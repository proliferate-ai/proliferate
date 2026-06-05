# Worker Materialization

Status: authoritative for
`anyharness/crates/proliferate-worker/src/materialization/**`.

`materialization/` owns target-local **effects**: filesystem, Git, env, auth,
and runtime-config writes, with centralized path safety and atomic private
writes. Command handlers in `control/commands/handlers/` call into it; it is not
a poll and it never calls raw Cloud endpoints or decides Cloud policy.

## Target Shape

```text
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
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | The materialization facade used by command handlers. | Command lifecycle or Cloud reporting. |
| `paths.rs` | Allowed-root checks, home expansion, symlink-traversal defense, path normalization and safety. | Business effects; HTTP. |
| `files.rs` | Atomic/private file writes, directory creation, permissions, common file helpers. | What to write (the handler decides). |
| `env.rs` | Environment-file materialization. | Cloud plan creation. |
| `git.rs` | Focused Git helpers. | Cloud authorization. |
| `git_identity.rs` | Target-scoped Git credential/config materialization. | Auth policy decisions. |
| `repo_checkout.rs` | Clone/fetch/checkout and repo-identity validation. | Command lifecycle. |
| `runtime_config.rs` | Runtime-config projection files, artifact-integrity checks, credential-reference helpers. | Deciding desired config (that is Cloud's). |
| `agent_auth.rs` | Target-local agent-auth synced-file and gateway-config materialization. | Credential selection policy. |
| `manifest.rs` | `.proliferate/**` manifest writing. | Inventory introspection. |

## Allowed

- filesystem writes under allowed roots
- Git operations required for checkout/bootstrap
- local credential file writes approved by Cloud-provided plans
- artifact/hash validation
- target-local manifest generation

## Why It Is Not Inside The Handlers

Path safety and atomic private writes are cross-cutting effect *primitives* that
several command families share. Keeping them here keeps `control/commands/
handlers/**` thin — handlers orchestrate the command lifecycle and call into
materialization for the actual effect, so the safety logic lives in exactly one
place.

## Hard Rules

- Materialization does not call raw Cloud HTTP and does not decide Cloud
  authorization or exposure policy.
- All target-local writes go through the centralized path-safety and
  atomic-write helpers here — handlers do not hand-roll filesystem effects.
- Materialization centralizes path safety and private file writes.
- It applies Cloud-provided plans; it does not create them.
- Supervisor owns binary download, replacement, restart, and rollback — never
  materialization.
