# Frontend Access Boundaries

External systems should have one clear access boundary. Product components and
product hooks should not construct clients, call raw endpoint paths, or invoke
platform APIs directly.

## Target Shape

```text
lib/access/
  cloud/
    client.ts
    <resource>.ts
  anyharness/
    runtime-target.ts
    runtime-bootstrap.ts
hooks/access/
  cloud/
    query-keys.ts
    use-<resource>.ts
    use-<action>-mutation.ts
  anyharness/
    use-<resource>.ts
  tauri/
    use-<capability>-actions.ts
```

Existing code may still live under older transitional paths such as
`lib/integrations/**` or domain hook folders. New code and cleanup work should
move toward the access shape above.

## Cloud

`lib/access/cloud/**` owns raw Proliferate cloud API access:

- singleton OpenAPI client setup
- auth/refresh middleware
- named request helpers
- generated OpenAPI request/response types
- transport normalization

File naming:

- `client.ts` for client setup, auth/refresh middleware, and shared transport
  error types
- `<resource>.ts` for named request helpers such as `workspaces.ts`,
  `billing.ts`, or `credentials.ts`
- no React hooks, Zustand stores, query invalidation, navigation, or JSX

`hooks/access/cloud/**` owns React-facing access:

- query keys
- `useQuery` and `useMutation`
- invalidation
- retries
- request telemetry
- UI-safe error handling

File naming:

- `query-keys.ts` for cloud query key factories
- `use-<resource>.ts` for list or summary queries
- `use-<resource>-detail.ts` for single-entity queries
- `use-<action>-mutation.ts` for one mutation
- `use-<resource>-actions.ts` only for a tight mutation group

New cloud query/mutation wrappers belong in `hooks/access/cloud/**`. Existing
`hooks/cloud/**` is transitional; product workflow hooks should migrate to
their owning product hook domain.

Do not create ad hoc `openapi-fetch` clients outside the cloud access layer.
Do not call raw `client.GET`, `client.POST`, `client.PUT`, or `client.DELETE`
from product hooks or components.

## AnyHarness

Generic AnyHarness React access goes through `@anyharness/sdk-react`.
Product hooks should not call `getAnyHarnessClient` directly except in
transitional code. Put normal AnyHarness resource operations behind
`@anyharness/sdk-react` or `hooks/access/anyharness/**`.

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

Raw Tauri access belongs behind the Tauri access/platform boundary.
`platform/tauri/**` remains the raw native boundary in this app;
`hooks/access/tauri/**` is the React-facing access boundary.

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
