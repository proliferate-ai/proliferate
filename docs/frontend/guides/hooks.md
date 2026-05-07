# Frontend Hooks

Hooks own React behavior. A hook should have one clear responsibility, a clear
folder kind, and a name that tells the reader what it returns or owns.

## Hook Types

### UI Hooks

Tiny reusable browser/UI mechanics with no product concepts.

Path:

```text
hooks/ui/keyboard/use-keyboard-shortcut.ts
hooks/ui/pointer/use-click-outside.ts
hooks/ui/layout/use-element-size.ts
```

UI hooks may use refs, local state, effects, DOM subscriptions, timers, and
browser APIs. They should not know about sessions, workspaces, agents, billing,
or cloud.

### Access Hooks

React Query or mutation wrappers around external systems.

Path:

```text
hooks/access/cloud/use-cloud-billing.ts
hooks/access/anyharness/use-runtime-workspaces.ts
hooks/access/tauri/use-updater-actions.ts
```

Access hooks own query keys, `useQuery`, `useMutation`, retries, invalidation,
and request telemetry. Product hooks should use access hooks instead of
constructing clients or calling raw endpoint helpers directly.

Access hook naming:

- `use-<resource>.ts` for queries
- `use-<resource>-detail.ts` for one entity
- `use-<action>-mutation.ts` for one mutation
- `use-<resource>-actions.ts` only for a tight group of related mutations
- `query-keys.ts` for key factories in the same access domain

Access hooks may call `lib/access/**`, `@anyharness/sdk-react`, or
`@anyharness/sdk`. They should not contain product workflow branching.

### Derived Hooks

Read store/provider/query state and return UI-ready state. They should not
write, fetch, invalidate, navigate, or emit telemetry.

Use derived hooks when a component needs one stable answer from many inputs,
such as "what chat surface should render?"

Path:

```text
hooks/<domain>/derived/use-<thing>-state.ts
hooks/<domain>/derived/use-<thing>-model.ts
```

Derived hooks may call other derived hooks and read access hooks. They must not
call mutation hooks except to read stable status that is already exposed as
state.

### Workflow Hooks

User-action controllers. They gather dependencies, expose callbacks, and call
domain/workflow/access functions.

Workflow hooks should read like route handlers:

- collect current state and dependencies
- validate inputs
- call a plain workflow function or access hook
- update stores or invalidate queries in one readable path
- handle user-facing errors

They should not bury large product algorithms inline. Move reusable logic to
`lib/domain` or `lib/workflows`.

Path:

```text
hooks/<domain>/workflows/use-<workflow>-actions.ts
hooks/<domain>/workflows/use-<workflow>-workflow.ts
```

Workflow hooks may:

- read stores, providers, and access hooks
- expose callbacks used by components
- call `lib/domain` for pure decisions
- call `lib/workflows` for multi-step product sequences
- pass access-hook callbacks, store setters, and other side-effect functions
  into `lib/workflows`
- perform query invalidation and store updates at the React boundary

Workflow hooks must not:

- construct raw clients
- call raw endpoint paths or raw Tauri invoke wrappers
- contain large reusable algorithms inline
- become a grab bag of unrelated actions

The workflow hook is the React boundary. It is allowed to call hooks. Plain
`lib/workflows` functions are not.

Default shape:

```text
Component
  -> useProductWorkflowActions()
    -> useAccessMutation()
    -> useStore(selector)
    -> runPlainWorkflow(input, {
         accessCall: mutation.mutateAsync,
         storeSetter,
       })
```

### Lifecycle Hooks

Mounted background behavior: streams, dispatchers, subscriptions, polling,
bootstrap, cleanup, and cross-store reconciliation.

Lifecycle hooks are effect-driven. Keep their ownership comments explicit:
"Owns X. Does not own Y." They should be mounted once at the correct boundary
and should clean up every subscription or timer they create.

Path:

```text
hooks/<domain>/lifecycle/use-<thing>-lifecycle.ts
hooks/<domain>/lifecycle/use-<thing>-dispatcher.ts
hooks/<domain>/lifecycle/use-<thing>-reconciler.ts
```

Use lifecycle hooks for background behavior triggered by mounting or external
events, not direct user clicks.

### Facade Hooks

Thin composition wrappers around several hooks. Facades are acceptable when
they create a simpler interface for a component. If a facade grows large or
contains branching business logic, split the underlying responsibilities.

Path:

```text
hooks/<domain>/facade/use-<surface>.ts
```

Facade hooks should mostly rename and group values. They should not introduce
new product behavior.

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
    facade/
```

Existing domain folders may still be transitional. New hooks and cleanup work
should move toward the taxonomy above.

## Rules

- Product hooks should not construct raw cloud clients, AnyHarness clients, or
  Tauri invocations directly.
- Components should not call `queryClient.invalidateQueries` directly.
- Components should not call multiple store setters in sequence; put that in a
  workflow hook.
- Product workflow hooks should read like route handlers. If the middle of the
  hook is the business algorithm, extract that algorithm to `lib/domain` or
  `lib/workflows`.
- Hooks may call hooks. Plain functions in `lib/**` must not call hooks.
- Query key helpers live alongside their access/query hooks.
- Reducers are pure functions, not hooks. Do not use a `use-` prefix for pure
  reducers.
- Non-trivial hooks should start with a short ownership comment when the name
  alone is not enough.
- Avoid god hooks. A hook that mixes five mutations, retry logic, telemetry,
  route changes, and store coordination needs to be split.

## Effects

Valid `useEffect` ownership:

- SSE/WebSocket connections
- Tauri IPC listeners
- DOM event subscriptions
- resize/intersection observers
- timers, debouncing, and polling
- one-time app initialization
- lifecycle reconciliation driven by external events

Invalid `useEffect` ownership:

- fetching data that should use React Query
- deriving state from other state
- watching one state value only to set another state value

Always include a dependency array. `useEffect(fn)` with no dependency array
runs every render and is almost always a bug.
