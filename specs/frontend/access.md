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
hooks/access/cloud/billing/use-billing-plan.ts
hooks/access/cloud/billing/use-llm-balance.ts
hooks/access/cloud/billing/use-team-checkout.ts

hooks/access/tauri/app/query-keys.ts
hooks/access/tauri/app/use-app-version.ts
hooks/access/tauri/use-updater.ts

hooks/access/anyharness/workspaces/use-workspace-bootstrap-cache.ts
hooks/access/anyharness/sessions/use-workspace-session-cache.ts
```

Do not create access folders just to mirror another client. Each owner keeps
only the systems it actually uses:

- ProductClient owns connected Desktop/Web `cloud` and `anyharness` hooks. It
  may own `tauri` capability hooks only when they call the typed Desktop bridge
  and never import Tauri directly.
- Desktop owns raw Tauri/local-runtime implementation plus host authentication
  and vendor adapters. Web owns browser authentication, storage, links,
  telemetry, and Cloud-client construction.
- Mobile owns its `cloud` and native authentication/storage helpers.

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
inside product hook folders such as `hooks/workspaces/**` or
`hooks/sessions/**`.

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

ProductClient `lib/access/cloud/**` owns connected helpers the shared SDK cannot
know: auth probes and transport contracts, gateway access, owner-context
headers, health/capability checks, request timing, and connection retry rules.
Each host retains authenticated client construction, auth/session bootstrap,
base-url resolution, storage integration, and environment-specific credential
or vendor adapters.

ProductClient `hooks/access/cloud/**` owns connected React-facing access that is
not already generic enough for `@proliferate/cloud-sdk-react`:

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

Connected ProductClient code calls `@proliferate/cloud-sdk-react` only from
`apps/packages/product-client/src/hooks/access/cloud/**`. Components and
product workflow hooks consume those access-owned seams. Pure cross-client
rules under `apps/packages/product-client/src/domain/**` may accept generated or
SDK contract types as data, but they never import SDK clients, access hooks,
query clients, providers, or raw transports.

## AnyHarness

Generic AnyHarness React access goes through `@anyharness/sdk-react`.
Product hooks should not call `getAnyHarnessClient` directly for normal
resource operations.

Prefer direct SDK React imports for generic resources:

```ts
import { useAnyHarnessRuntimeWorkspaces } from "@anyharness/sdk-react";
```

Create a ProductClient AnyHarness access hook only when the connected product
adds connection/runtime selection, local/cloud bridging, or cache behavior the
SDK cannot provide. Desktop-specific capability reaches that hook through
`ProductHost.desktop`; the hook does not import the host.

Low-level framework-agnostic primitives, such as streams, transcript reducers,
and terminal connections, belong in `@anyharness/sdk`.

Desktop-capable AnyHarness access in ProductClient is only for product runtime
wiring that the generic SDK cannot know:

- resolving the selected workspace to the correct runtime target
- local/cloud runtime connection mapping
- runtime bootstrap and credentials
- Desktop-specific compatibility adapters

Do not add a parallel AnyHarness request/controller layer in either host. If the
operation is a normal AnyHarness resource operation, ProductClient prefers the
SDK or SDK React hook; Desktop supplies only the raw local-runtime capability
required by the typed bridge.

## Tauri

Raw Tauri access belongs behind the Desktop host boundary.
`apps/desktop/src/lib/access/tauri/**` is the only frontend path that should
import `@tauri-apps/api` or call native `invoke` directly. ProductClient
`hooks/access/tauri/**` is the React-facing capability boundary and calls the
typed `DesktopBridge`; it never imports Tauri.

Use wrappers for native capabilities such as:

- `invoke`
- native events
- updater operations
- filesystem access
- native window operations
- shell/open-in-editor operations

React-facing Tauri behavior belongs in ProductClient
`hooks/access/tauri/**` or a product workflow hook that calls the bridge-backed
wrapper. Raw native implementation stays in Desktop. Components should not
call raw Tauri APIs directly.

## Product Usage Pattern

Product hooks compose access instead of owning it directly.

```text
Component
  -> product workflow hook
    -> access hook or SDK hook
      -> lib/access raw helper or external SDK
    -> lib/workflows function receives access callbacks as dependencies
```

App-local or connected-client business rules live in `lib/domain/**` or
`lib/workflows/**`. Rules shared with Mobile live in
`apps/packages/product-client/src/domain/**` and remain equally isolated from
access. Transport details live in access. Rendering lives in components. Plain
`lib/**` and nested-domain functions do not call React hooks.

Access hooks own query keys, cache object shape, invalidation, and
`setQueryData` for remote resources. Product workflow hooks request refresh or
update through access-owned callbacks instead of constructing query keys or
writing cache objects inline.
