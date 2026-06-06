# Frontend Hooks

Hooks own **React behavior**: effects, refs, context, query/mutation wiring, subscriptions, local UI mechanics, and UI-facing orchestration. Pure logic that doesn't touch React belongs in `lib/`, not a hook.

## Axes — how to place any hook

Four questions decide the type:
- **returns** — a value / callbacks / nothing / query-state *(the primary discriminator)*
- **modifies** — nothing / any / UI-only / an external system
- **accesses** — UI-only / one external resource / many sources / stores+providers+queries
- **product-aware or generic**

The one-line test: **what does it return?** → value = `derived`, callbacks = `workflow`, nothing (runs on mount) = `lifecycle`, query-state = `access`, grouped values = `facade`.

## Shape

```text
hooks/
  ui/<mechanic>/                            # generic UI mechanics
  access/<system>/                          # external-system query/mutation wrappers
  <domain>/[<optional subdomain>/]<type>/   # type ∈ {derived, workflows, lifecycle, ui, cache, facade}
```

The **type folder is the required leaf**; a **subdomain is optional**, only when a domain grows large. Product hook files live in a responsibility (type) folder, never directly under `hooks/<domain>/`. Don't create empty folders; add one when real files need it.

## Imports / use (layer-wide)

- **Hooks may call hooks. Plain functions in `lib/**` must not call hooks.**
- Access hooks may call `lib/access/**`, SDK clients, and shared Cloud SDK React hooks; anything wrapping a raw external request goes under `hooks/access/<system>/**`.
- **Platform-bound hooks stay in the owning app** — Tauri hooks are desktop-only; DOM-subscription hooks don't exist on mobile. A shared/cross-platform hook must not import a platform-specific access hook.

## The hook types (index)

| Type | Returns / consumed as | Accesses | Modifies | Must NOT |
|---|---|---|---|---|
| **ui** (generic) | a value or function | UI / DOM / native only | UI mechanics only | know product (sessions, cloud, billing…) |
| **access** | query/mutation state + callbacks | one external resource | that resource; **owns cache keys + invalidation** | contain product workflow branching |
| **cache** | one product-owned data model | **multiple** external/local sources | the composed read-model it owns (no external writes) | wrap a single endpoint (→ `access`) |
| **derived** | UI-ready state (a value or model) | stores, providers, queries | **nothing** | write, fetch, invalidate, navigate, emit telemetry, return callbacks |
| **workflow** | **callbacks** (functions that do work) | stores, providers, access hooks | any (via callbacks) | build raw clients, define query keys, hand-edit cache shape |
| **lifecycle** | **nothing** (mounted; runs in background) | any | any | fetch (use React Query), or derive state-from-state |
| **product ui** | a value or function | UI mechanics + product vocab | UI mechanics | be generic (→ `hooks/ui`) or run workflows |
| **facade** | grouped / renamed values | other hooks | nothing new | add behavior, raw access, or query keys |

## Per type

### UI hooks — generic UI mechanics
```text
hooks/ui/keyboard/use-keyboard-shortcut.ts
hooks/ui/pointer/use-click-outside.ts
hooks/ui/layout/use-element-size.ts
```
Refs, local state, effects, DOM/native subscriptions, timers, platform UI APIs. **Best practice:** keep them dumb and reusable, return a stable value/callback, clean up every listener/timer. Never reference sessions, workspaces, agents, billing, repos, or cloud.

### Access hooks — external-system wrappers
```text
hooks/access/cloud/billing/use-cloud-billing.ts
hooks/access/anyharness/runtime/use-runtime-workspaces.ts
hooks/access/cloud/automations/query-keys.ts        # keys live beside the owner
hooks/access/cloud/automations/use-automations.ts
```
Own query keys, `useQuery`/`useMutation`, retry policy, invalidation, cache shape, request telemetry. **Best practices:** one external resource per hook; **gate queries with `enabled`** instead of firing with null params; keep **mutation invalidation + optimistic update/rollback co-located here** (`onSuccess`/`onError`) so callers never touch the cache. No product workflow branching.

### Product cache hooks — compose multiple sources
```text
hooks/<domain>/cache/<cache-name>-query.ts
hooks/<domain>/cache/<cache-name>-cache.ts
```
**Best practice:** use only when composing **≥2** external/local sources into one product model. A single endpoint is an `access` hook, not a cache hook.

### Derived hooks — read-only UI state
```text
hooks/<domain>/derived/use-<thing>-state.ts
hooks/<domain>/derived/use-<thing>-model.ts
```
Read stores, providers, and queries; return UI-ready state. **Best practices:** pure read — the moment you reach for a setter, fetch, or callback it's the wrong type; **select narrow store slices** (not the whole store) to avoid over-render; memoize expensive computations. Need actions too? compose `derived` + `workflow` behind a `facade`.

### Workflow hooks — user-action orchestration
```text
hooks/<domain>/workflows/use-<workflow>-actions.ts
hooks/<domain>/workflows/use-<workflow>-workflow.ts
```
Read stores/providers/access hooks, expose callbacks, call `lib/domain/**` for pure decisions and `lib/workflows/**` for sequences. **Best practices:** return **stable** callbacks (`useCallback`); keep one short intent inline, extract to `lib/workflows` once it has ordering/branching/rollback/retries; the lib fn takes `(input, deps)` and **never imports hooks**. Must not build raw clients, define query keys, or hand-edit cache shape.

### Lifecycle hooks — mounted background behavior
```text
hooks/<domain>/lifecycle/use-<thing>-lifecycle.ts
hooks/<domain>/lifecycle/use-<thing>-dispatcher.ts
hooks/<domain>/lifecycle/use-<thing>-reconciler.ts
```
Streams, dispatchers, subscriptions, polling, bootstrap/teardown, cross-store reconciliation, external-event-driven behavior. **Best practices:** mount once at the owning boundary; **clean up every timer/listener/observer/handle/subscription it creates**; never use it to derive state-from-state or to fetch (that's React Query).

### Product UI hooks — UI mechanics with product vocabulary
```text
hooks/<domain>/ui/use-<mechanic>.ts
```
**Best practice:** use only when the mechanic needs product vocabulary; generic mechanics stay in `hooks/ui/**`, workflows in `workflows/**`.

### Facade hooks — thin composition
```text
hooks/<domain>/facade/use-<surface>.ts
```
Group and rename values for a component. **Best practice:** the moment it branches, fetches, or adds behavior, it's no longer a facade — and keep its outputs stable.

## Actions vs. workflows

Keep a callback inline in the workflow hook when it's one short user intent: validate a snapshot, call one access function/mutation, update owned local state/cache, return.

Move a sequence to `lib/workflows/<domain>/**` when it has ordering invariants, branching on fetched data, rollback, retries, multi-step error recovery, or a useful unit-test boundary. Keep dependency objects narrow — a large `EverythingDeps` type means the boundary is too broad.

- **`input`** = state that changes per call.
- **`deps`** = stable capabilities: access calls, store setters, cache invalidation, navigation, toasts, telemetry, clocks, id generation.

## Effects

Valid `useEffect` ownership: SSE/WebSocket connections · Tauri IPC listeners · DOM/native event subscriptions · resize/intersection observers · timers/debouncing/polling · one-time app init · lifecycle reconciliation driven by external events.

Invalid `useEffect` ownership: fetching data that should use React Query · deriving state from other state · watching one state value only to set another.

Avoid `useEffect(fn)` with no dependency array unless every-render execution is intentional and documented.

## Cross-platform binding

- Tauri/DOM/RN-native behavior is **platform-specific**: the hook lives in the owning app (or behind a platform boundary), never in a shared package.
- A **shared/cross-platform hook must be platform-neutral** — it must not import a platform-bound access hook.
- **Mobile (React Native) has no DOM** — generic `hooks/ui` DOM mechanics don't apply there; mobile uses native equivalents.

## Naming

- `use-` prefix for hooks; **the suffix signals the type** — `-state`/`-model` (derived), `-actions`/`-workflow` (workflow), `-lifecycle`/`-dispatcher`/`-reconciler` (lifecycle).
- One primary hook per file (the named export).
- Reducers are pure functions, not hooks — **no `use-` prefix on a reducer**.
- Non-trivial hooks open with a one-line ownership comment when the name isn't enough.

## Rules (hard)

- Product hooks must not construct raw Cloud/AnyHarness/MCP/Tauri clients, define query keys, or own cache object shape — that's `access`.
- **Hooks return data or callbacks, never JSX** (that's a component).
- **Return stable references** — memoize returned callbacks/objects so consumers and effects don't thrash.
- Components must not call `queryClient.invalidateQueries` or sequence multiple store setters — put that in a workflow hook.
- **Errors flow by layer:** access surfaces a typed error → workflow decides the UX (toast/retry) → component renders. Hooks don't swallow errors; components don't parse raw error payloads.
- Query/mutation wrappers for external systems live in `hooks/access/**`, not product-domain hook folders.
- Another hook is only warranted when the extracted code owns React behavior.

## Placement & testing

- Raw external calls → `lib/access/**` or `hooks/access/**`.
- Pure product decisions → `lib/domain/**` or `product-domain`.
- Real multi-step sequences → `lib/workflows/**`.
- **Test the pure `lib/workflows` function, not the rendered hook** — push testable logic into `lib` with `(input, deps)` so tests don't render; only render-test what genuinely owns React behavior. Focused tests live next to risky domain/workflow logic.