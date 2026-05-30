# Frontend State

Use the smallest state owner that can solve the problem.

## Local State

Use component state for local presentation state that only one subtree needs:
menus, hover, temporary input, local measurement, drag state, and one-off
visibility toggles.

Lift state only when another component needs to read or write the same state.

## Stores

Zustand stores hold shared client-only state.

```text
stores/<domain>/<concern>-store.ts
```

Owns:

- selected ids
- active panels and tabs
- drafts
- resize/editor/runtime UI state
- local preferences
- synchronous multi-field local invariants

Must not own:

- API calls
- React Query invalidation or cache writes
- navigation
- telemetry
- toasts
- persistence bootstrap/subscriptions
- timers, listeners, streams, or retry loops
- cross-store/product workflows

Rules:

- Always use selectors: `useStore((state) => state.field)`.
- Use `useShallow` when selecting multiple fields into an object.
- Store setters should be single `set()` calls.
- Name setters as local state intents, such as `setActiveSessionId`,
  `patchDraft`, or `clearSelection`.
- Avoid setter names that imply orchestration, such as `submit`, `sync`,
  `load`, `refresh`, or `bootstrap`.
- Non-trivial normalization, equality, schema upgrade, and indexing helpers
  live in `lib/domain/**`.

## Store Persistence

Persistence belongs outside the store file.

```text
stores/<domain>/<concern>-store.ts
hooks/<domain>/lifecycle/use-<concern>-lifecycle.ts
```

The lifecycle hook owns loading, hydration, subscriptions, writes, and teardown.
The store may expose explicit hydration metadata such as `_hydrated` or
`_persistedMetadata`, but UI code should use normal user-facing setters.

Keep read normalization and write eligibility separate. A loaded value may
normalize to `null` without meaning live transient state should overwrite the
last persisted stable value.

## Store Facades

Cross-store facades are allowed only as local state adapters.

Allowed:

- read from multiple stores
- write to multiple stores with simple local setters
- hide storage layout during a store split

Not allowed:

- API calls
- query invalidation or cache writes
- navigation, telemetry, or toasts
- timers, streams, subscriptions, or wait loops
- raw client construction

If a facade coordinates external work or product sequencing, move that logic to
a workflow hook or `lib/workflows/**`.

## Remote State

TanStack Query owns authoritative remote state from Cloud, AnyHarness, and
other external systems.

```text
hooks/access/<system>/**       # app-owned query/mutation hooks
@anyharness/sdk-react          # generic AnyHarness query/mutation hooks
@proliferate/cloud-sdk-react   # generic Cloud query/mutation hooks
product-surfaces               # shared Desktop/Web Cloud surfaces
```

- Do not copy refetchable server/runtime data into Zustand as a cache.
- Access hooks own query keys, queries, mutations, invalidation, cache shape,
  and retry policy.
- Product workflow hooks may request refresh/update through access-owned
  callbacks; they should not construct query keys or write cache objects
  directly.
- Generated response types or SDK types are the source of truth for remote
  transport shapes.

## Providers

Providers define scoped dependencies and app/subtree boundaries.

```text
providers/<ProviderName>.tsx
providers/<domain>/<ProviderName>.tsx
```

Use providers for query clients, auth, telemetry, theme, runtime context, and
subtree-specific services. Do not use providers as a general mutable state
store.

Provider values that are objects or callback bundles should be stable.

## Derived State

Do not store derived values in Zustand. Use component expressions for trivial
derived state and `hooks/<domain>/derived/**` for non-trivial composition.

Avoid inline fallback defaults in query destructuring:

```ts
const EMPTY_ITEMS: Item[] = [];
const { data: items = EMPTY_ITEMS } = useItems();
```

Inline object/array defaults create new references while loading and break
`useMemo`, `React.memo`, and shallow comparisons.
