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
- If an operation needs multiple store writes or coordinates with React Query,
  it belongs in a workflow hook.
- Pure domain helpers do not belong in store files.

Stores should expose simple verbs such as `setActiveSessionId`, `patchDraft`,
or `clearSelection`. Avoid verbs that imply orchestration, such as `submit`,
`sync`, `load`, `refresh`, or `bootstrap`.

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
- Product workflow hooks may coordinate invalidation, but the query/mutation
  primitive belongs in an access hook.

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
