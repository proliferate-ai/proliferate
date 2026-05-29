# Frontend Access Boundaries

External systems have one clear access boundary. Components and product hooks
do not construct clients, call raw endpoint paths, or invoke platform APIs
directly.

## Shape

```text
lib/access/
  <external-system>/
    <capability>.ts

hooks/access/
  <external-system-or-capability>/
    <resource>/
      query-keys.ts
      use-<resource>.ts
      use-<action>-mutation.ts
```

Common external systems:

- `cloud`
- `anyharness`
- `tauri`
- `browser`
- `native`

Folder names under `hooks/access/**` describe the external system or cached
access capability, not the product screen that happens to render the data. A
capability folder such as `mcp` is allowed when one React-facing access API
intentionally coordinates more than one external boundary, such as cloud
connector records plus local OAuth/native setup.

Illustrative examples only, not a complete inventory:

```text
hooks/access/cloud/automations/query-keys.ts
hooks/access/cloud/automations/use-automations.ts
hooks/access/cloud/automations/use-automation-mutations.ts

hooks/access/cloud/billing/query-keys.ts
hooks/access/cloud/billing/use-cloud-billing.ts
hooks/access/cloud/billing/use-cloud-billing-mutations.ts

hooks/access/tauri/updater/query-keys.ts
hooks/access/tauri/updater/use-updater.ts

hooks/access/mcp/connectors/query-keys.ts
hooks/access/mcp/connectors/use-connectors.ts
hooks/access/mcp/connectors/use-connector-mutations.ts
```

Do not create access folders just to mirror another app. Each app only has the
external systems it actually uses:

- Desktop may use `cloud`, `anyharness`, `tauri`, `browser`, and capability
  folders such as `mcp`.
- Web usually uses `cloud` and browser auth/storage helpers.
- Mobile usually uses `cloud` and native auth/storage helpers.

## Query Key Ownership

Query keys are part of the React-facing access contract. They live beside the
access hook that owns the same remote resource cache.

```text
hooks/access/<system>/<resource>/query-keys.ts
hooks/access/<system>/<resource>/use-<resource>.ts
hooks/access/<system>/<resource>/use-<action>-mutation.ts
```

Do not put React Query key factories in `lib/access/**`; that layer owns raw
transport, not React cache identity. Do not define remote-resource query keys
inside product hook folders such as `hooks/automations/**`,
`hooks/workspaces/**`, or `hooks/sessions/**`.

Product hook folders may keep key helpers only for product-composed caches
that combine multiple sources into one product-owned projection.

```text
hooks/workspaces/cache/workspace-collections-query.ts
hooks/workspaces/cache/workspace-collections-cache.ts
```

Access hooks own one external resource cache. Product cache folders own
cross-boundary product projections.

## Cloud

`@proliferate/cloud-sdk` owns shared raw Proliferate Cloud API helpers.
`@proliferate/cloud-sdk-react` owns generic React Query hooks and providers for
Cloud resources. App code imports reusable SDK helpers directly instead of
adding app-local re-export wrappers.

`lib/access/cloud/**` owns app-specific Cloud setup and platform bridges the
shared SDK cannot know:

- app-specific auth/session storage integration
- base-url resolution
- token refresh or pending prompt persistence when platform-specific
- Desktop-only agent-auth sync/recovery helpers
- control-plane health checks used during Desktop startup
- request timing or telemetry integration

`hooks/access/cloud/**` owns app-local React-facing access that is not already
generic enough for `@proliferate/cloud-sdk-react`:

- query keys
- `useQuery` and `useMutation`
- invalidation
- retries
- request telemetry
- UI-safe error handling

If a hook wraps a Cloud endpoint with `useQuery` or `useMutation`, it belongs
under `hooks/access/cloud/**` even when the resource is product-specific.
Product hooks consume the access hook and derive product state in their own
domain folder.

Do not create ad hoc `openapi-fetch` clients outside the Cloud access layer.
Do not call raw `client.GET`, `client.POST`, `client.PUT`, or `client.DELETE`
from product hooks or components.

`apps/packages/product-surfaces/**` may call `@proliferate/cloud-sdk-react`
directly for shared Desktop/Web connected surfaces. It must not import app
access folders or app-specific clients.

## AnyHarness

Generic AnyHarness React access goes through `@anyharness/sdk-react`.
Product hooks should not call `getAnyHarnessClient` directly for normal
resource operations.

Prefer direct SDK React imports for generic resources:

```ts
import { useAnyHarnessRuntimeWorkspaces } from "@anyharness/sdk-react";
```

Create a Desktop AnyHarness access hook only when Desktop adds
connection/runtime selection, local/cloud bridging, or cache behavior the SDK
cannot provide.

Low-level framework-agnostic primitives, such as streams, transcript reducers,
and terminal connections, belong in `@anyharness/sdk`.

Desktop-specific AnyHarness access is only for product runtime wiring that the
generic SDK cannot know:

- resolving the selected workspace to the correct runtime target
- local/cloud runtime connection mapping
- runtime bootstrap and credentials
- Desktop-specific compatibility adapters

Do not add a parallel generic AnyHarness request layer in Desktop. If the
operation is a normal AnyHarness resource operation, prefer the SDK or SDK
React hook.

## Tauri

Raw Tauri access belongs behind the Tauri access boundary.
`lib/access/tauri/**` is the only desktop frontend path that should import
`@tauri-apps/api` or call native `invoke` directly. `hooks/access/tauri/**` is
the React-facing access boundary.

Use wrappers for native capabilities such as:

- `invoke`
- native events
- updater operations
- filesystem access
- native window operations
- shell/open-in-editor operations

React-facing Tauri behavior belongs in `hooks/access/tauri/**` or a product
workflow hook that calls the wrapper. Components should not call raw Tauri APIs
directly.

## Product Usage Pattern

Product hooks compose access instead of owning it directly.

```text
Component
  -> product workflow hook
    -> access hook or SDK hook
      -> lib/access raw helper or external SDK
    -> lib/workflows function receives access callbacks as dependencies
```

Business rules live in `lib/domain/**` or `lib/workflows/**`. Transport
details live in access. Rendering lives in components. Plain `lib/**`
functions do not call React hooks.

Access hooks own query keys, cache object shape, invalidation, and
`setQueryData` for remote resources. Product workflow hooks request refresh or
update through access-owned callbacks instead of constructing query keys or
writing cache objects inline.
