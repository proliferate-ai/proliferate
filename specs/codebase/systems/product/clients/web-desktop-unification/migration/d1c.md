# Desktop Local Runtime Adoption (D1c)

Status: **current implementation scope**.

- Exact implementation base:
  `736d181575e4d81389d19ba7a78afd14566e1fda`
- Prior completed implementation: PR #1165, reviewed head
  `32632bd487e9be28592579728b87f0c18d73ee9c`, merge
  `736d181575e4d81389d19ba7a78afd14566e1fda`
- Parent architecture:
  [`web-desktop-client-unification.md`](../README.md)
- Pipeline ledger:
  [`../../../../../../developing/deploying/web-desktop-unification-rollout.md`](../../../../../../developing/deploying/web-desktop-unification-rollout.md)

This is the living contract for Desktop Local Runtime Adoption. The founder
and implementation agent may update it together when concrete code evidence
requires a material adjustment. Product behavior outside this boundary is
unchanged.

## Observable outcome

The existing Desktop product obtains local AnyHarness discovery and restart
through `host.desktop.runtime`. The single Desktop product-lifecycle root owns
initial runtime bootstrap. Product workflows receive the mounted runtime
capability explicitly and then use the normal AnyHarness SDK with the resolved
connection.

When `host.desktop` is `null`, the product performs no local discovery,
restart, polling, or local-inventory request. Managed-cloud and SSH-target
workspace resolution do not depend on a local runtime.

All product source remains under `apps/desktop`. This slice does not move the
product into ProductClient or implement Web.

## Current to target flow

```text
Before

AppRuntime effect ----------------------> raw get_runtime_info
product restart/readiness workflows ----> raw restart_runtime/get_runtime_info
                                         -> AnyHarness SDK

After

ProductHostProvider
  -> host.desktop.runtime
       -> thin Desktop adapter
            -> existing raw Tauri runtime commands

DesktopProductLifecycleRoot
  -> bootstrap product workflow
       -> host.desktop.runtime.getConnection()
       -> normal AnyHarness health client
       -> shared connection store

Local workspace/session workflows
  -> injected host.desktop.runtime
  -> readiness workflow
  -> normal AnyHarness workspace/session clients

Web (desktop: null)
  -> no local runtime work
  -> cloud workspace connection through the existing gateway path
```

Raw sidecar discovery, process launch, health/status reporting, restart, and
runtime-info persistence remain owned by Desktop native code. The bridge does
not become a workspace, session, chat, or repository service.

## Material decisions

1. `DesktopRuntimeBridge` returns a runtime snapshot containing both the SDK
   connection and the existing native status:

   ```ts
   interface LocalRuntimeSnapshot {
     connection: AnyHarnessClientConnection;
     status: "starting" | "healthy" | "failed" | "stopped";
   }
   ```

   The status is required to preserve immediate native failure instead of
   waiting for the polling timeout. SSH tunnels continue returning an ordinary
   runtime connection and do not use this snapshot.

2. The concrete bridge remains a thin shape adapter over the existing
   `getRuntimeInfo` and `restartRuntime` wrappers. It adds no retry, cache,
   logging, fallback, or process policy.

3. Bootstrap, polling, health confirmation, fallback, store updates, timeout,
   and error presentation remain product workflows. They receive the runtime
   bridge as an argument; there is no module-global bridge registry and no
   second provider.

4. Initial bootstrap moves from `AppRuntime` into the existing
   `DesktopProductLifecycleRoot`. It waits for normalized auth loading to
   finish and does not repeat when a new host snapshot carries the same stable
   runtime bridge, including when auth changes between anonymous and
   authenticated. Removing or replacing the Desktop capability cancels any
   active poll, clears the published local-runtime state, and prevents later
   calls or connection-state publication from that lifecycle.

5. The local runtime URL starts empty. Until Desktop discovery or the existing
   browser-development fallback succeeds, SDK runtime queries stay disabled.
   `AnyHarnessRuntime` receives `null`, not a guessed loopback URL.

6. Browser-only Desktop development preserves the existing
   `DEFAULT_RUNTIME_URL` fallback when native discovery is unavailable.

7. Local-only actions fail clearly when `host.desktop` is absent. Cloud and
   SSH-target flows skip local discovery and may pass an empty neutral base to
   resolvers that ignore it for remote targets.

8. After readiness, workspace/session CRUD, chat, transcript, agent, and file
   behavior continues through the normal AnyHarness SDK. These operations are
   not added to `DesktopBridge`.

9. A local create carries the bridge-resolved runtime URL through its mutation
   result. Cache upsert and invalidation use that URL rather than a render-time
   URL captured before bootstrap.

## Owned call sites

The slice adopts the existing consumers that discover, restart, or require the
local runtime:

- initial Desktop runtime bootstrap;
- local workspace and worktree creation;
- local repository registration;
- local workspace open/selection;
- local session create, load, restore, and resume;
- agent credential Apply & Restart; and
- the runtime URL supplied to shared AnyHarness providers and caches.

Product lifecycles that merely consume the activated URL remain unchanged.
Their existing empty-URL/healthy-state gates keep them inert until bootstrap
succeeds.

## Failure behavior

- An already healthy connection becomes active immediately.
- A starting runtime is polled every 500 ms for at most 120 attempts.
- Polling re-reads the bridge snapshot and adopts a changed runtime URL.
- A native `failed` snapshot stops immediately with the existing runtime
  failure state.
- Native discovery unavailable in browser-only Desktop uses the existing
  default URL fallback.
- Exhausted polling retains the existing “did not become healthy in time”
  error.
- Restart rejection publishes the existing failed connection state.
- Removing the Desktop lifecycle cancels active polling and clears the local
  runtime URL without later bridge calls, timeout errors, or connection-state
  publication.
- Missing Desktop capability fails a local action without probing loopback or
  starting a local query.

## Non-goals

This slice does not:

- change Rust sidecar/process startup, runtime-info persistence, or native
  Tauri commands;
- adopt SSH profile/tunnel, files, credentials beyond runtime restart, worker,
  updater, automation, scratch, diagnostics, or support bridge groups;
- move workspace/session/chat/repository operations into `DesktopBridge`;
- redesign auth, query caches, streams, timers, or runtime retry policy;
- change visual UI, CSS, Web, self-hosted Web, or ProductClient source
  ownership; or
- fix unrelated existing behavior.

## Acceptance proof

Automated proof covers:

- discovery and restart preserve status and URL;
- healthy, starting, changed-URL, native-failed, fallback, timeout, and restart
  failure paths;
- initial bootstrap mounts only inside the Desktop lifecycle boundary;
- a host snapshot replacement with the same runtime inputs does not duplicate
  bootstrap;
- auth changes between ready states do not duplicate bootstrap;
- removing the Desktop capability cancels an active runtime poll and clears
  the published local runtime;
- an empty runtime disables local inventory queries;
- local create updates and invalidates the cache for the post-bootstrap runtime
  URL;
- local workspace/session workflows receive the mounted runtime capability;
- cloud and SSH-target session resolution does not discover/restart local
  AnyHarness; and
- no product-owned raw `getRuntimeInfo` or `restartRuntime` import remains.

The final review also runs ProductClient and Desktop typechecks/tests/builds,
frontend structure checks, and a named-profile Desktop smoke that discovers
the dynamically assigned runtime, activates local inventory, persists local
workspace state, and reconnects after a full profile restart. Focused tests
separately prove the ProductHost restart action.
