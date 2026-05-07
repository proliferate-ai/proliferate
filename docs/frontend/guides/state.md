# Frontend State

Use the smallest state owner that can solve the problem.

## Local State

Use component state for local presentational concerns that only one subtree
needs: open/closed menus, hover state, temporary input state, local measurement,
or drag state.

Do not lift state unless two siblings need to share it.

## Stores

Zustand stores hold shared client-only state: selected ids, active panels,
drafts, resize state, local UI preferences, and approved local runtime/editor
state.

Path:

```text
stores/<domain>/<concern>-store.ts
```

Store rules:

- Always use selectors: `useStore((state) => state.field)`.
- Use `useShallow` when selecting multiple fields into an object.
- Store setters should be single `set()` calls.
- Stores do not call APIs, query invalidation, navigation, telemetry, toasts,
  or other stores.
- Stores do not own persistence bootstrap or persistence subscriptions.
- If an operation needs multiple store writes or coordinates with React Query,
  it belongs in a workflow hook.
- Pure domain helpers do not belong in store files.

Stores should expose simple verbs such as `setActiveSessionId`, `patchDraft`,
or `clearSelection`. Avoid verbs that imply orchestration, such as `submit`,
`sync`, `load`, `refresh`, or `bootstrap`.

Atomic local transactions are allowed. A setter such as `activateWorkspace`
may update several fields when those fields form one local invariant and the
operation is synchronous with no external side effects. Do not move atomic
local state transitions to `lib/workflows/**` just because they touch multiple
fields.

Dangerous primitive setters need narrow names or comments. If a setter updates
one piece of a larger invariant, such as a selected id without clearing related
state, either expose a more specific intent method or mark the primitive as
internal to lifecycle/workflow code.

### Store Persistence

Persistence belongs outside the store file. Stores should not export
`bootstrapX()`, call `readPersistedValue`, call `persistValue`, or subscribe to
themselves at module scope.

Target shape:

```text
stores/<domain>/<concern>-store.ts
hooks/<domain>/lifecycle/use-<concern>-lifecycle.ts
```

The lifecycle hook owns:

- loading persisted state on mount
- hydrating the store
- subscribing after hydration
- persisting selected store slices
- cleaning up subscriptions on unmount

Stores with persisted metadata should make that metadata explicit local state,
not module-level mutable state:

```ts
_hydrated: boolean;
_persistedMetadata: PersistedXMetadata;
hydrate(...);
setPersistedMetadata(...);
```

`hydrate` and metadata setters are internal. UI code should call user-facing
setters such as `set` or `setMultiple`; lifecycle/workflow hooks call the
internal hydration and metadata methods.

Do not create generic persistence infrastructure on the first cleanup. Build
one or two concrete lifecycle hooks first. Generalize only after the repeated
shape is clear.

Keep read normalization and write eligibility separate. A value may normalize
to `null` when loaded from disk but still be skipped, not overwritten, when it
appears in live UI state. For example, transient pending workspace ids should
not replace the last persisted stable workspace id.

### Store Cleanup Playbook

When cleaning a store, move ownership violations in this order:

1. Move async bootstrap, persistence reads/writes, and subscriptions to a
   lifecycle hook.
2. Move timers, waits, listeners, and retry loops to lifecycle/workflow hooks.
3. Move pure normalization, equality, migration, persisted-slice selection,
   and index helpers to `lib/domain/<domain>/<subdomain>/**` once they are
   non-trivial or make the store hard to read.
4. Keep synchronous multi-field local transactions in the store when they
   preserve one local invariant.
5. Split the store only when ownership is mixed; do not split only because the
   store contains legitimate local state transitions.

Examples:

- `user-preferences-store`: persistence bootstrap and metadata adoption move to
  lifecycle/workflow hooks; persisted metadata becomes explicit store state.
- `session-selection-store`: persisted selected workspace loading/saving moves
  to a lifecycle hook; pure hot-paint helpers move to domain logic.
- `repo-preferences-store`: persisted repo config loading/saving moves to a
  lifecycle hook while `setRepoConfig` remains a local state transaction.

### Store Facades

Cross-store facades are allowed only as local state adapters. Use them when a
domain has split stores but callers need one narrow way to read or patch the
local state model.

Allowed:

- read from multiple stores
- write to multiple stores with simple local setters
- hide storage layout during a store split
- expose local state helpers with no remote side effects

Not allowed:

- API calls
- React Query invalidation or cache writes
- navigation
- telemetry
- toasts
- timers, streams, or subscriptions
- raw client construction

If a facade starts coordinating external work or product sequences, move that
logic to a workflow hook or `lib/workflows/**`.

Facades may coordinate local reads and synchronous writes, but they must not
wait for state changes, set timeouts, install listeners, or subscribe for
completion. Wait-or-timeout behavior belongs in a lifecycle hook, workflow
hook, or explicitly dependency-injected `lib/workflows/**` function.

## Remote State

TanStack Query owns authoritative remote state from cloud, AnyHarness, and
other external systems.

Path:

```text
hooks/access/<system>/**       # app-owned query and mutation hooks
@anyharness/sdk-react          # generic AnyHarness query/mutation hooks
```

- Do not copy refetchable server/runtime data into Zustand as a cache.
- Access hooks own query keys, queries, mutations, invalidation, and retry
  policy.
- Use generated response types or SDK types as the source of truth for remote
  transport shapes.
- Product workflow hooks may decide that remote state needs refreshing or
  updating, but access hooks own the query keys and cache shape. Product
  workflow hooks should call access-owned callbacks instead of constructing
  query keys or writing cache objects directly.

## Providers

Providers define scoped dependencies and app boundaries: query client, auth,
telemetry, theme, runtime context, or a subtree-specific service.

Path:

```text
providers/<ProviderName>.tsx
providers/<domain>/<ProviderName>.tsx
```

Use a provider when consumers need a scoped dependency or context value that
should not be globally addressable through a store.

Provider rules:

- Keep provider values small and stable.
- `useMemo` provider values that are objects or callback bundles.
- Do not use providers as a generic state store.
- Do not stack providers casually; each provider should represent a real
  boundary.

Derived UI state belongs in components for trivial expressions or
`hooks/<domain>/derived/**` for non-trivial composition. Do not store derived
values in Zustand.

## Reference Stability

Avoid inline fallback defaults in query destructuring:

```ts
const EMPTY_ITEMS: Item[] = [];

const { data: items = EMPTY_ITEMS } = useItems();
```

Inline defaults like `{ data: items = [] }` create new references while loading
and break downstream `useMemo`, `React.memo`, and shallow comparisons.

The same rule applies to object defaults.
