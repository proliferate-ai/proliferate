# Agent Seeds

Agent seeds are packaged desktop resources that preinstall selected managed
agent artifacts into the local AnyHarness runtime home. They exist to avoid
first-launch network installs for the most important local agents.

## Short Answer

There are not two runtime layouts for seeded vs downloaded agents. Seeded
artifacts and downloaded artifacts both end up in the normal AnyHarness runtime
home:

```text
<runtime_home>/
  agents/
    claude/
      native/
      agent_process/
    codex/
      native/
      agent_process/
  node/
    <target>/
  agent-seed/
    state.json
```

The difference is ownership metadata in `agent-seed/state.json` and health
metadata returned by `/health`, not a different agent resolver path.

## Build Flow

| Step | Code |
| --- | --- |
| Read seed inputs | `apps/desktop/src-tauri/agent-seed.inputs.json` |
| Build temp runtime home | `scripts/build-agent-seed.mjs` |
| Install bundled agents | `anyharness install-agents --reinstall --agent claude --agent codex` |
| Install target Node | Node archive from `agent-seed.inputs.json` |
| Remove generated launchers | `scripts/build-agent-seed.mjs` removes launchers before packaging |
| Write manifest | `manifest.json` inside the seed payload |
| Archive payload | `agent-seed-<target>.tar.zst` |
| Write checksum | `agent-seed-<target>.sha256` |
| Bundle resource | `tauri.conf.json` includes `agent-seeds/` in `bundle.resources` |

Release builds create exactly one target archive plus checksum under:

```text
apps/desktop/src-tauri/agent-seeds/
```

Current v1 seed contents:

- Claude native CLI and ACP agent process
- Codex native CLI and ACP agent process
- target-specific Node runtime

## Tauri Launch Env

`apps/desktop/src-tauri/src/agent_seed_env.rs` decides what seed env to pass to
AnyHarness.

| Case | Env passed to sidecar |
| --- | --- |
| Debug/dev with `ANYHARNESS_AGENT_SEED_DIR` | `ANYHARNESS_AGENT_SEED_DIR=<dir>` |
| Packaged app with bundled resource | `ANYHARNESS_AGENT_SEED_DIR=<resource-dir>` and `ANYHARNESS_AGENT_SEED_EXPECTED=1` |
| Packaged app with no bundled resource | `ANYHARNESS_AGENT_SEED_EXPECTED=1` |
| Packaged app with external override | Ignored unless `ANYHARNESS_AGENT_SEED_DIR_UNSAFE=1` is also set |
| Debug/dev with no seed | No seed env; AnyHarness reports `not_configured_dev` |

The resource lookup expects:

```text
agent-seeds/
  agent-seed-<target>.tar.zst
  agent-seed-<target>.sha256
```

On macOS, the fallback resource path is:

```text
<App>.app/Contents/Resources/agent-seeds/
```

## Hydration Flow

1. `anyharness serve` creates an `AgentSeedStore`.
2. If seed health starts as `hydrating`, serve spawns a blocking hydration task.
3. The HTTP runtime starts immediately. `/health` can return while hydration is
   still running.
4. Hydration checks:
   - archive exists
   - checksum matches `.sha256`
   - manifest schema and target are valid
   - archive entries are safe relative paths
   - hydrated executables exist and remain executable
5. Payload extracts into a staging directory under:

```text
<runtime_home>/agent-seed/staging-<uuid>/
```

6. Artifacts are copied into the normal runtime layout.
7. Claude and Codex launchers are regenerated in the final runtime home so their
   absolute paths point at the real local runtime home.
8. macOS quarantine is stripped from hydrated executables on a best-effort basis.
9. `agent-seed/state.json` records the seed version, target, seeded agents,
   per-artifact checksums, and ownership.

## Ownership Rules

| Existing state | Hydration behavior |
| --- | --- |
| Missing artifact, no prior record | Write from seed and mark `seed`. |
| Existing artifact, no prior record | Preserve and mark `user_existing`. |
| Prior `seed`, file missing | Restore from seed and count as repaired. |
| Prior `seed`, file unchanged, new seed version | Replace with new seed. |
| Prior `seed`, file changed | Preserve and mark `user_modified`. |
| Prior `user_existing` or `user_modified` | Preserve. |

Managed install and reconcile paths refresh seed state after installs. If a
seed-owned artifact is replaced by an install path, it becomes user-modified so
future seeds do not silently overwrite it.

## Health States

`/health` includes `agentSeed`.

| Status | Meaning |
| --- | --- |
| `not_configured_dev` | Dev runtime started without seed env. |
| `missing_bundled_seed` | Packaged runtime expected a seed but could not find the target archive/checksum. |
| `hydrating` | Archive validation/extraction is running in the background. |
| `ready` | All manifest artifacts are seed-owned. |
| `partial` | Some or all artifacts were preserved as user-owned existing/modified files. |
| `failed` | Checksum, manifest, archive, verification, target, or IO failure. |

Ownership can be:

- `full_seed`
- `partial_seed`
- `user_owned_existing`
- `not_configured`

## Reconcile Interaction

Desktop should not start reconcile while seed status is `hydrating`. After
hydration, reconcile can install non-seeded or still-missing agents.

For dev runtimes with `not_configured_dev`, reconcile should remain a manual
setup action. Local dev without a seed must not silently kick off long network
installs at app boot.

## Paths To Know

| Path | Meaning |
| --- | --- |
| `apps/desktop/src-tauri/agent-seed.inputs.json` | Source of release seed inputs. |
| `apps/desktop/src-tauri/agent-seeds/agent-seed-<target>.tar.zst` | Generated Tauri resource archive. |
| `<runtime_home>/agents/<kind>/native/` | Managed native CLI artifact path. |
| `<runtime_home>/agents/<kind>/agent_process/` | Managed ACP/agent-process artifact path. |
| `<runtime_home>/node/<target>/` | Bundled Node runtime hydrated from seed. |
| `<runtime_home>/agent-seed/state.json` | Ownership and repair state. |
