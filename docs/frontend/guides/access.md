# Frontend Access Boundaries

External systems should have one clear access boundary. Product components and
product hooks should not construct clients, call raw endpoint paths, or invoke
platform APIs directly.

## Target Shape

```text
lib/access/
  cloud/
    client.ts
    agent-auth-sync.ts
    agent-auth-recovery.ts
    health.ts
    timing.ts
  anyharness/
    runtime-target.ts
    runtime-bootstrap.ts
    workspace-connection.ts
    session-stream-transport.ts
  tauri/
    <capability>.ts
hooks/access/
  cloud/
    <resource>/
      query-keys.ts
      use-<resource>.ts
      use-<action>-mutation.ts
  anyharness/
    <desktop-runtime-concern>/
      use-<concern>.ts
  tauri/
    <capability>/
      query-keys.ts
      use-<capability>-actions.ts
  mcp/
    connectors/
      query-keys.ts
      use-connectors.ts
      use-connector-mutations.ts
```

Existing code may still live under older transitional paths such as
`lib/integrations/**` or domain hook folders. New code and cleanup work should
move toward the access shape above.

## Query Key Ownership

Query keys are part of the React-facing access contract. They should live next
to the access hook that owns the same external resource cache:

```text
hooks/access/cloud/automations/query-keys.ts
hooks/access/cloud/automations/use-automations.ts
hooks/access/cloud/automations/use-automation-mutations.ts
```

Do not put React Query key factories in `lib/access/**`; that layer owns raw
transport, not React cache identity. Do not define remote-resource query keys
inside product hook folders such as `hooks/automations/**`,
`hooks/workspaces/**`, or `hooks/sessions/**`.

Product hook folders may keep a key helper only when the cache is genuinely
product-composed state rather than one external resource. If that exception is
used, the file should make the product ownership obvious and should not call
raw endpoint helpers.

Cleanup audits should start with:

```bash
rg "query-keys" desktop/src/hooks --glob '!access/**'
```

Every hit should be either migration debt or a documented product-composed
cache.

## Desktop Access Folder Shape

Use resource folders under `hooks/access/**`. The folder name should describe
the external boundary or access capability being cached, not the product screen
that happens to use it. Most folders map directly to an external system
(`cloud`, `anyharness`, `tauri`). A capability folder such as `mcp` is allowed
when one React-facing access API intentionally coordinates more than one
external boundary, such as cloud connector records plus local OAuth/native
setup.

```text
hooks/access/
  cloud/
    auth/
      query-keys.ts
      use-github-auth-availability.ts
    automations/
      query-keys.ts
      use-automations.ts
      use-automation-mutations.ts
    billing/
      query-keys.ts
      use-cloud-billing.ts
      use-cloud-billing-mutations.ts
    agent-auth/
      query-keys.ts
      use-agent-auth.ts
      use-agent-auth-mutations.ts
    mobility/
      query-keys.ts
      use-cloud-mobility-workspaces.ts
      use-cloud-mobility-workspace.ts
      use-cloud-mobility-mutations.ts
      cache.ts
    organizations/
      query-keys.ts
      use-organizations.ts
      use-organization-members.ts
      use-organization-invitations.ts
      use-organization-mutations.ts
    repo-configs/
      query-keys.ts
      use-cloud-repo-config.ts
      use-cloud-repo-configs.ts
      use-cloud-repo-config-mutations.ts
    repos/
      query-keys.ts
      use-cloud-repo-branches.ts
    runtime/
      query-keys.ts
      use-control-plane-health.ts
      use-cloud-workspace-connection.ts
    workspaces/
      query-keys.ts
      use-cloud-workspace-repo-config-status.ts
      use-cloud-workspace-mutations.ts
    worktree-policy/
      query-keys.ts
      use-cloud-worktree-retention-policy.ts
      use-cloud-worktree-retention-policy-mutation.ts
  anyharness/
    runtime/
      use-runtime-health.ts
    sessions/
      use-prompt-attachment-url.ts
    worktrees/
      use-dynamic-worktree-inventory.ts
      use-dynamic-worktree-policy.ts
  tauri/
    app/
      query-keys.ts
      use-app-version.ts
    credentials/
      query-keys.ts
      use-local-agent-credentials.ts
    shell/
      query-keys.ts
      use-available-editors.ts
      use-shell-actions.ts
    updater/
      query-keys.ts
      use-updater.ts
    window/
      use-window-actions.ts
    diagnostics/
      use-diagnostics-actions.ts
  mcp/
    connectors/
      query-keys.ts
      use-connectors.ts
      use-connector-mutations.ts
```

`hooks/access/anyharness/**` should stay rare. Prefer importing
`@anyharness/sdk-react` hooks directly for normal AnyHarness resources. Do not
wrap SDK React hooks just for symmetry with cloud or Tauri access. Add a
desktop AnyHarness access hook only when the hook needs selected-runtime
resolution, desktop connection state, or a local/cloud runtime target that SDK
React cannot know.

Product-composed caches do not move here just because they use React Query. For
example, workspace collections combine local runtime workspaces, cloud
workspaces, repository roots, cleanup state, and product latency diagnostics.
That cache should live under a product-owned cache folder such as:

```text
hooks/workspaces/cache/workspace-collections-query.ts
hooks/workspaces/cache/workspace-collections-cache.ts
```

Access hooks own one external resource cache. Product cache folders own
cross-boundary product projections.

## Cloud

`@proliferate/cloud-sdk` owns shared raw Proliferate Cloud API resource
helpers. Desktop code should import reusable request helpers directly from the
SDK, such as `@proliferate/cloud-sdk/client/workspaces`, instead of adding
Desktop re-export wrappers.

`lib/access/cloud/**` owns Desktop-specific Cloud access setup and native
bridges:

- singleton OpenAPI client setup
- auth/refresh middleware
- Desktop auth/session storage integration
- Desktop base-url resolution
- Desktop-only agent-auth sync/recovery helpers
- control-plane health checks used during Desktop startup
- request timing integration

File naming:

- `client.ts` for client setup, auth/refresh middleware, and shared transport
  error types
- `agent-auth-sync.ts` and `agent-auth-recovery.ts` for Desktop-native
  agent-auth export/import coordination
- `health.ts` for Desktop control-plane reachability checks
- `timing.ts` for Desktop request measurement wiring
- no React hooks, Zustand stores, query invalidation, navigation, or JSX

`hooks/access/cloud/**` owns React-facing access:

- query keys
- `useQuery` and `useMutation`
- invalidation
- retries
- request telemetry
- UI-safe error handling

File naming:

- `<resource>/query-keys.ts` for cloud query key factories
- `use-<resource>.ts` for list or summary queries
- `use-<resource>-detail.ts` for single-entity queries
- `use-<action>-mutation.ts` for one mutation
- `use-<resource>-actions.ts` only for a tight mutation group

New cloud query/mutation wrappers belong in `hooks/access/cloud/**`. Existing
`hooks/cloud/**` is transitional; product workflow hooks should migrate to
their owning product hook domain.

If a hook wraps a cloud endpoint with `useQuery` or `useMutation`, it belongs
here even when the resource is product-specific. For example:

```text
hooks/access/cloud/mobility/query-keys.ts
hooks/access/cloud/mobility/use-cloud-mobility-workspaces.ts
```

Product hooks should consume this access hook and derive product state in their
own domain folder. They should not define cloud query keys or call cloud raw
helpers directly.

Do not create ad hoc `openapi-fetch` clients outside the cloud access layer.
Do not call raw `client.GET`, `client.POST`, `client.PUT`, or `client.DELETE`
from product hooks or components.

## AnyHarness

Generic AnyHarness React access goes through `@anyharness/sdk-react`.
Product hooks should not call `getAnyHarnessClient` directly except in
transitional code. Put normal AnyHarness resource operations behind
`@anyharness/sdk-react` or `hooks/access/anyharness/**`.

Prefer direct SDK React imports for generic resources:

```ts
import { useAnyHarnessRuntimeWorkspaces } from "@anyharness/sdk-react";
```

Create a desktop access hook only when desktop adds connection/runtime
selection, local/cloud bridging, or cache behavior the SDK cannot provide.

Low-level framework-agnostic primitives, such as streams, transcript reducers,
and terminal connections, belong in `@anyharness/sdk`.

Desktop-specific AnyHarness access is only for product runtime wiring that the
generic SDK cannot know:

- resolving the selected workspace to the correct runtime target
- local/cloud runtime connection mapping
- runtime bootstrap and credentials
- desktop-specific compatibility adapters

File naming should name the desktop wiring concern, such as
`runtime-target.ts`, `runtime-bootstrap.ts`, or `workspace-connection.ts`.
Do not name files after generic AnyHarness resources if the SDK can own that
resource.

Do not add a parallel generic AnyHarness request layer in desktop. If the
operation is a normal AnyHarness resource operation, prefer the SDK or SDK
React hook.

## Tauri

Raw Tauri access belongs behind the Tauri access boundary.
`lib/access/tauri/**` is the only desktop frontend path that should import
`@tauri-apps/api` or call native `invoke` directly. `hooks/access/tauri/**` is
the React-facing access boundary.

Use wrappers for:

- `invoke`
- native events
- updater operations
- filesystem access
- native window operations
- shell/open-in-editor operations

File naming should name the native capability, such as `updater.ts`,
`filesystem.ts`, `window.ts`, `shell.ts`, or `diagnostics.ts`.

React-facing Tauri behavior belongs in `hooks/access/tauri/**` or a product
workflow hook that calls the wrapper. Components should not call raw Tauri APIs
directly.

## Product Usage Pattern

Product hooks should compose access instead of owning it directly. The product
hook is the React boundary: it may call access hooks, read stores, and pass the
resulting callbacks into plain workflow functions.

```text
Component
  -> product workflow hook
    -> access hook or SDK hook
      -> lib/access raw helper or external SDK
    -> lib/workflows function receives access callbacks as dependencies
```

Keep business rules in `lib/domain` or `lib/workflows`. Keep transport details
in access. Keep rendering in components. Do not call React hooks from
`lib/workflows`.

Query cache ownership follows the same boundary. Access hooks own query keys,
cache object shape, invalidation, and `setQueryData` for remote resources.
Product workflow hooks may decide that a resource should be refreshed or
updated, but they should do that through access-owned callbacks rather than
constructing query keys or writing cache objects inline.
