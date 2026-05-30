# Frontend Hooks

Hooks own React behavior: effects, refs, context, query/mutation wiring,
subscriptions, local UI mechanics, and UI-facing orchestration.

## Hook Types

### UI Hooks

Generic UI mechanics with no product concepts.

```text
hooks/ui/keyboard/use-keyboard-shortcut.ts
hooks/ui/pointer/use-click-outside.ts
hooks/ui/layout/use-element-size.ts
```

UI hooks may use refs, local state, effects, DOM/native subscriptions, timers,
and platform UI APIs. They must not know about sessions, workspaces, agents,
billing, repositories, or cloud.

### Access Hooks

React Query and mutation wrappers around external systems.

```text
hooks/access/cloud/billing/use-cloud-billing.ts
hooks/access/cloud/mobility/use-cloud-mobility-workspaces.ts
hooks/access/anyharness/runtime/use-runtime-workspaces.ts
hooks/access/tauri/updater/use-updater-actions.ts
```

Access hooks own query keys, `useQuery`, `useMutation`, retry policy,
invalidation, cache shape, and request telemetry. If a hook directly wraps an
external request, it belongs under `hooks/access/<system>/**`.

Query keys live beside the access hook that owns the resource:

```text
hooks/access/cloud/automations/query-keys.ts
hooks/access/cloud/automations/use-automations.ts
```

Access hooks may call `lib/access/**`, SDK clients, SDK React hooks, or shared
Cloud SDK React hooks. They must not contain product workflow branching.

### Product Cache Hooks

Rare React Query caches that combine multiple external/local sources into one
product-owned data model.

```text
hooks/<domain>/cache/<cache-name>-query.ts
hooks/<domain>/cache/<cache-name>-cache.ts
```

Use this for product-composed state, not simple endpoint queries. One external
resource still belongs in `hooks/access/**`.

### Derived Hooks

Read stores, providers, and queries; return UI-ready state.

```text
hooks/<domain>/derived/use-<thing>-state.ts
hooks/<domain>/derived/use-<thing>-model.ts
```

Derived hooks must not write, fetch, invalidate, navigate, emit telemetry, or
return mutating callbacks. If the component needs actions too, compose a
derived hook and workflow hook behind a facade.

### Workflow Hooks

User-action callbacks and React-facing orchestration.

```text
hooks/<domain>/workflows/use-<workflow>-actions.ts
hooks/<domain>/workflows/use-<workflow>-workflow.ts
```

Workflow hooks may read stores/providers/access hooks, expose callbacks, call
`lib/domain/**` for pure decisions, call `lib/workflows/**` for sequences, and
use access-owned cache/invalidation callbacks.

Workflow hooks must not construct raw clients, call raw endpoint paths, define
query keys, hand-edit cache object shapes, or bury large reusable algorithms.

Default split:

```text
workflow hook = gathers React/store/query/provider deps + returns callbacks
lib/workflows function = receives input + deps and runs the product sequence
```

### Actions vs. Workflows

Keep a callback inline in the workflow hook when it is one short user intent:
validate a snapshot, call one access function/mutation, update owned local
state/cache, and return.

Move a sequence to `lib/workflows/<domain>/**` when it has ordering
invariants, branching on fetched data, rollback, retries, multi-step error
recovery, or a useful unit-test boundary. Dependency objects should be narrow;
large `EverythingDeps` types usually mean the boundary is too broad.

State values that change per call belong in `input`. Stable capabilities such
as access calls, store setters, cache invalidation, navigation, toasts,
telemetry, clocks, or id generation belong in `deps`.

### Lifecycle Hooks

Mounted background behavior.

```text
hooks/<domain>/lifecycle/use-<thing>-lifecycle.ts
hooks/<domain>/lifecycle/use-<thing>-dispatcher.ts
hooks/<domain>/lifecycle/use-<thing>-reconciler.ts
```

Use lifecycle hooks for streams, dispatchers, subscriptions, polling,
bootstrap, teardown, cross-store reconciliation, imperative controllers, and
external-event-driven behavior. They should be mounted at the owning boundary
and clean up every timer, listener, observer, handle, or subscription they
create.

### Product UI Hooks

Product-specific UI mechanics.

```text
hooks/<domain>/ui/use-<mechanic>.ts
```

Use this when the hook is UI behavior but needs product vocabulary. Generic
mechanics stay in `hooks/ui/**`; workflows stay in `workflows/**`.

### Facade Hooks

Thin composition wrappers around several hooks.

```text
hooks/<domain>/facade/use-<surface>.ts
```

Facades may group and rename values for a component. They must not introduce
new product behavior, raw access, query keys, or business branching.

## Folder Shape

```text
hooks/
  access/
    anyharness/
    cloud/
    tauri/
  ui/
    keyboard/
    layout/
    pointer/
  <domain>/
    derived/
    workflows/
    lifecycle/
    ui/
    cache/
    facade/
```

Product hook files belong in a responsibility folder, not directly under
`hooks/<domain>/`. Do not create empty folders; add folders when real files need
them.

## Placement Rules

- Raw external calls live in `lib/access/**` or `hooks/access/**`.
- Pure product decisions live in `lib/domain/**` or `product-domain`.
- Real multi-step sequences live in `lib/workflows/**`.
- Another hook is only warranted when the extracted code owns React behavior.
- Focused tests belong next to risky or meaningful domain/workflow logic.

## Rules

- Product hooks should not construct raw Cloud, AnyHarness, MCP, or Tauri
  clients directly.
- Components should not call `queryClient.invalidateQueries` directly.
- Product hooks should not define query keys or own cache object shape.
- Components should not call multiple store setters in sequence; put that in a
  workflow hook.
- Hooks may call hooks. Plain functions in `lib/**` must not call hooks.
- Query/mutation wrappers for external systems live in `hooks/access/**`, not
  product-domain hook folders.
- Reducers are pure functions, not hooks. Do not use a `use-` prefix for pure
  reducers.
- Non-trivial hooks should start with a short ownership comment when the name
  alone is not enough.

## Effects

Valid `useEffect` ownership:

- SSE/WebSocket connections
- Tauri IPC listeners
- DOM/native event subscriptions
- resize/intersection observers
- timers, debouncing, and polling
- one-time app initialization
- lifecycle reconciliation driven by external events

Invalid `useEffect` ownership:

- fetching data that should use React Query
- deriving state from other state
- watching one state value only to set another state value

Avoid `useEffect(fn)` with no dependency array unless every-render execution is
intentional and documented.
