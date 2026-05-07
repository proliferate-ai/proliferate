# Frontend Access Boundaries

External systems should have one clear access boundary. Product components and
product hooks should not construct clients, call raw endpoint paths, or invoke
platform APIs directly.

## Target Shape

```text
lib/access/
  cloud/
  anyharness/
  tauri/
hooks/access/
  cloud/
  anyharness/
  tauri/
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

`hooks/access/cloud/**` owns React-facing access:

- query keys
- `useQuery` and `useMutation`
- invalidation
- retries
- request telemetry
- UI-safe error handling

Do not create ad hoc `openapi-fetch` clients outside the cloud access layer.
Do not call raw `client.GET`, `client.POST`, `client.PUT`, or `client.DELETE`
from product hooks or components.

## AnyHarness

Generic AnyHarness React access goes through `@anyharness/sdk-react`.

Low-level framework-agnostic primitives, such as streams, transcript reducers,
and terminal connections, belong in `@anyharness/sdk`.

Desktop-specific AnyHarness access is only for product runtime wiring that the
generic SDK cannot know:

- resolving the selected workspace to the correct runtime target
- local/cloud runtime connection mapping
- runtime bootstrap and credentials
- desktop-specific compatibility adapters

Do not add a parallel generic AnyHarness request layer in desktop. If the
operation is a normal AnyHarness resource operation, prefer the SDK or SDK
React hook.

## Tauri

Raw Tauri access belongs behind the Tauri access/platform boundary.

Use wrappers for:

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

Product hooks should compose access instead of owning it directly:

```text
Component
  -> product workflow/derived hook
    -> access hook or SDK hook
    -> lib/access raw helper or external SDK
```

Keep business rules in `lib/domain` or `lib/workflows`. Keep transport details
in access. Keep rendering in components.
