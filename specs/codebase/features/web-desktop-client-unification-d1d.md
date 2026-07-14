# Finish the Desktop Capability Boundary (D1d)

Status: **current implementation scope**.

- Exact implementation base:
  `66f45bfbe2839ae1382133393844ba61dce035cd`
- Prior completed implementation: PR #1167, merge
  `36e96e7bea1c409dfde1797b3a691003f82d8f5a`
- Parent architecture:
  [`web-desktop-client-unification.md`](web-desktop-client-unification.md)
- Pipeline ledger:
  [`../../developing/deploying/web-desktop-unification-rollout.md`](../../developing/deploying/web-desktop-unification-rollout.md)

This is the living contract for finishing the remaining Desktop-only product
capability boundary while product source remains under `apps/desktop`.
Existing host adapters are reused; this slice changes consumers, not native
infrastructure or product behavior.

## Observable outcome

Product-owned local files, local agent credentials, SSH tunnel resolution,
workspace scratch, updater, Desktop worker, diagnostics, and support behavior
reach the already-mounted `ProductHost` and `DesktopBridge`.

Shared product links and clipboard writes reach `host.links` and
`host.clipboard`. The old product-facing shell-action wrapper is removed once
its consumers have moved. Raw Tauri implementations remain private to the
Desktop host and concrete bridge adapter.

When `host.desktop` is `null`, the product starts none of these Desktop-only
lifecycles, performs no native call, and either disables the unavailable read
or fails a user-requested local action clearly.

## Current to target flow

```text
Before

product component/hook/workflow
  -> product-facing Tauri wrapper or raw Tauri access
  -> native command

After

product component/hook/workflow
  -> useProductHost()
       -> host.links / host.clipboard
       -> host.desktop?.files
       -> host.desktop?.localCredentials
       -> host.desktop?.ssh
       -> host.desktop?.scratch
       -> host.desktop?.updater
       -> host.desktop?.worker
       -> host.desktop?.diagnostics
            -> existing thin DesktopBridge adapter
                 -> existing raw Tauri implementation
```

Updater and worker background behavior mount beneath the existing
`DesktopProductLifecycleRoot`. There is still one ProductHost provider and one
Desktop product-lifecycle root.

## Owned capability groups

### Local files

- Directory picking, home-directory lookup, directory checks, editor/target
  listing, target opening, Finder reveal, and terminal opening use
  `host.desktop.files`.
- Product code imports the shared `EditorInfo`, `OpenTarget`, and related types
  from the Desktop bridge contract rather than raw Desktop shell modules.
- External URLs and clipboard writes use their top-level ProductHost groups;
  they are not added to `DesktopFilesBridge`.

### Local agent credentials

- Credential listing, save, and removal use
  `host.desktop.localCredentials`.
- Existing query keys, invalidation, restart-required state, and user-visible
  errors remain unchanged.
- A missing Desktop bridge disables the read and makes an explicit write fail
  without calling native code.

### SSH target resolution

- The existing runtime-target resolver receives `DesktopSshBridge | null` as
  an explicit dependency.
- SSH target resolution loads the profile and establishes the tunnel through
  that dependency.
- Local and managed-cloud paths never call the SSH capability.
- Unused SSH probe/install/profile-editing code is not expanded merely to
  exercise the contract.

### Workspace scratch

- Scratch reads and writes use `host.desktop.scratch` while preserving the
  existing query key, cache update, and error behavior.
- No Desktop capability means no scratch read; an attempted write fails
  clearly.

### Updater

- Product update checks, version reads, download progress, install, relaunch,
  and restart watching use `host.desktop.updater`.
- The product retains the opaque `DesktopUpdate` returned by the bridge and
  passes it back unchanged for installation.
- Restart watching mounts only inside the Desktop lifecycle root.
- Server switching uses the existing `host.deployment` operations rather than
  raw config and relaunch calls.

### Desktop worker

- Product worker enrollment and teardown receive
  `host.desktop.worker` explicitly.
- The enrollment lifecycle mounts only inside the Desktop lifecycle root.
- Desktop auth transport may retain its server-side revoke helper; auth
  transport is host-owned and is not exposed back through ProductClient.

### Diagnostics and support

- Product support bundle collection, attachment staging/read/delete, JSON
  export, and renderer lifecycle markers use
  `host.desktop.diagnostics`.
- Desktop bootstrap, vendor telemetry, startup measurement, and development
  diagnostics remain host-owned.

### Links and clipboard

- Shared product external URLs use `host.links.openExternal`.
- Shared product clipboard writes use `host.clipboard.writeText`.
- Existing outbound callback URLs use `host.links.buildReturnUrl` when the
  current `ProductEntry` contract represents them without a contract change.
- Inbound route normalization is intentionally deferred to the next shared
  ProductHost checkpoint.

## Ownership and failure behavior

- `apps/desktop/src/lib/access/tauri/**` retains raw native implementations.
- `apps/desktop/src/lib/access/tauri/desktop-bridge.ts` remains the sole thin
  capability adapter.
- `DesktopProductHostProvider` remains the only mounted host provider.
- Product code does not gain a global bridge registry, generic `invoke`,
  fallback native client, or second service layer.
- Disabled background reads are inert without Desktop.
- User-requested local actions reject with a clear unavailable-capability
  error.
- Existing native errors and update/support/worker state transitions continue
  to propagate through the current product hooks.

## Non-goals

This slice does not:

- move product source into ProductClient or change Web;
- change any raw Tauri command, Rust implementation, sidecar, updater, worker,
  SSH, filesystem, or support policy;
- redesign authentication, product identity, telemetry taxonomy, preference
  persistence, or inbound deep-link routing;
- change the `ProductHost` or `DesktopBridge` contract unless implementation
  evidence exposes a true missing operation;
- migrate dead or unused capabilities for completeness;
- redesign caches, retries, streams, queues, or error UX; or
- change CSS, product UI, or feature behavior.

## Acceptance proof

Focused automated proof covers:

- each adopted capability delegates the exact existing arguments and result;
- `desktop: null` makes Desktop-only queries/lifecycles inert and local writes
  fail without a native call;
- file actions keep picker cancellation, target selection, directory checks,
  reveals, home-directory behavior, and clipboard separation;
- credentials keep list/save/remove, invalidation, and restart-required state;
- local/cloud runtime resolution never touches SSH, while an SSH target loads
  its profile and tunnel through the bridge;
- scratch read/write/cache behavior remains unchanged;
- updater current/available/error, progress, install, relaunch, and restart
  watching use the bridge;
- worker enrollment/teardown use the bridge and mount only on Desktop;
- support collect/stage/read/delete/save/log behavior uses diagnostics without
  widening the bridge into general error telemetry;
- representative product link and clipboard actions use ProductHost; and
- ownership grep leaves raw Tauri imports only in retained Desktop host,
  adapter, bootstrap, auth transport, vendor telemetry, and development
  instrumentation.

Final review runs the affected focused tests, ProductClient and Desktop
typechecks, frontend structure checks, and both the Desktop production build
and a named-profile smoke when the changed capability is observable there.
