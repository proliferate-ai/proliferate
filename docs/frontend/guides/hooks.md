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
hooks/access/cloud/billing/use-cloud-billing.ts
hooks/access/cloud/mobility/use-cloud-mobility-workspaces.ts
hooks/access/anyharness/runtime/use-runtime-workspaces.ts
hooks/access/tauri/updater/use-updater-actions.ts
```

Access hooks own query keys, `useQuery`, `useMutation`, retries, invalidation,
and request telemetry. Product hooks should use access hooks instead of
constructing clients or calling raw endpoint helpers directly.

If a hook directly wraps an external request with `useQuery` or `useMutation`,
it belongs under `hooks/access/<boundary>/**`. Do not put query/mutation hooks
inside product-domain folders such as `hooks/workspaces/**`, `hooks/agents/**`,
or `hooks/sessions/**`.

Query keys live with the access hooks for the same external boundary and
resource:

```text
hooks/access/cloud/mobility/query-keys.ts
hooks/access/cloud/mobility/use-cloud-mobility-workspaces.ts
```

The concrete access folder map lives in `docs/frontend/guides/access.md`.
Follow that map before inventing a new access folder or leaving query keys in a
product hook directory.

For example, automation list/detail/run keys belong with the cloud automation
access hooks, not in `hooks/automations/query-keys.ts`:

```text
hooks/access/cloud/automations/query-keys.ts
hooks/access/cloud/automations/use-automations.ts
hooks/access/cloud/automations/use-automation-mutations.ts
```

Do not create `hooks/<domain>/access/**` by default. Product domains consume
access hooks; they do not own raw external access. If a product domain needs a
local cache adapter over remote data, name that folder by the product
responsibility, such as `derived/`, `workflows/`, or `cache/`, not `access/`.

Access hook naming:

- `use-<resource>.ts` for queries
- `use-<resource>-detail.ts` for one entity
- `use-<action>-mutation.ts` for one mutation
- `use-<resource>-actions.ts` only for a tight group of related mutations
- `query-keys.ts` for key factories in the same access domain

Access hooks may call `lib/access/**`, `@anyharness/sdk-react`, or
`@anyharness/sdk`. They should not contain product workflow branching.

Query cache writes belong here too. Access hooks own query cache shape,
`queryClient.invalidateQueries`, and `queryClient.setQueryData` for their
resource. Product workflow hooks may call access-provided callbacks such as
`invalidateWorkspaceSessions` or `upsertSession`, but should not hand-edit
query cache keys or cache object shapes directly.

### Product Cache Hooks

Product cache hooks are rare React Query caches that combine multiple
external/local sources into one product-owned data model. They are not raw
access wrappers.

Path:

```text
hooks/<domain>/cache/<cache-name>-query.ts
hooks/<domain>/cache/<cache-name>-cache.ts
```

Use this only when the cache is genuinely product-composed rather than one
external resource. For example, a workspace collection cache may combine local
runtime workspaces, cloud workspaces, repository roots, cleanup state, and
diagnostics. A simple cloud endpoint query still belongs in `hooks/access/**`.

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

Derived hooks are read-only. A hook named `use-*-state`, `use-*-model`, or
living under `derived/` must not return mutating callbacks such as `save`,
`submit`, `update`, `set`, `dismiss`, or `retry`. Split actions into a workflow
hook and compose them with a facade only when a component genuinely benefits
from one combined interface.

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

Do not create more hooks just to hide complexity. Extract to another hook only
when the extracted code genuinely owns React state, effects, context,
subscriptions, or query behavior. Otherwise extract a plain function into
`lib/domain`, `lib/workflows`, `lib/access`, or `lib/infra`.

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
- call access-owned invalidation/cache callbacks and store setters at the
  React boundary

Workflow hooks must not:

- construct raw clients
- call raw endpoint paths or raw Tauri invoke wrappers
- contain large reusable algorithms inline
- define query keys or hand-edit React Query cache object shapes
- become a grab bag of unrelated actions

The workflow hook is the React boundary. It is allowed to call hooks. Plain
`lib/workflows` functions are not.

The default split is:

```text
workflow hook = gathers React/store/query/provider deps + returns callbacks
lib/workflows function = receives input + deps and runs the product sequence
```

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

### Actions vs. Workflows

Most exposed callbacks are actions, not workflows.

An action is one user intent with a short, mostly linear body: validate a
snapshot, call one access function or mutation, update local state/cache through
owned callbacks, and return. Keep actions inline in the workflow hook when they
are easy to scan.

A workflow earns `lib/workflows/<domain>/**` only when it has sequencing worth
testing: ordering invariants, branching on fetched data, rollback, retries,
multi-step error recovery, or a body that keeps growing past the point where
the hook remains readable.

Before extracting to `lib/workflows`, check:

1. It is a sequence, not a single action.
2. The dependency object is narrow, usually five capabilities or fewer.
3. The sequence is reused, likely to be reused, or naturally unit-testable with
   fake deps.

If any answer is no, leave it in the hook and instead extract pure decisions to
`lib/domain/**` or repeated access/cache details to access hooks.

Do not extract actions just to make files look layered. Thin wrappers with no
information value make the code harder to read.

Workflow shape:

```ts
export interface DoThingInput {
  workspaceId: string;
  promptText: string;
}

export interface DoThingDeps {
  createSession(input: CreateSessionInput): Promise<Session>;
  promptSession(sessionId: string, prompt: PromptInput): Promise<void>;
  rollbackSession(sessionId: string): Promise<void>;
}

export type DoThingResult =
  | { kind: "completed" }
  | { kind: "interrupted" }
  | { kind: "failed"; message: string };

export async function doThing(
  input: DoThingInput,
  deps: DoThingDeps,
): Promise<DoThingResult> {
  // Ordered product sequence.
}
```

State values that change per call belong in `input`. Stable capabilities belong
in `deps`. Do not pass state snapshots, pure helpers, constants, or formatting
functions as deps.

If a workflow appears to need many deps, investigate before accepting it:

- State values may belong in `input`.
- Several setters for one store may be one writer capability.
- One function may really be two workflows.
- Heavy branching may want a pure `plan(input) -> Command[]` domain planner
  plus a small executor.
- Some callbacks should return tagged results so the hook can decide whether
  to toast, navigate, or call `onCompleted`.

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

Lifecycle hooks may manage imperative controllers, not only passive
`useEffect` blocks. Streams, reconnect loops, background dispatchers, hot
session ingest, and long-lived subscriptions are lifecycle concerns when their
main trigger is mounting or external events. The hook should make the owned
system obvious and keep timers, handles, and cleanup in one readable place.

If extracting lifecycle logic creates one giant dependency interface, the
extraction boundary is too large. Keep the lifecycle hook as the readable
orchestrator and extract smaller substeps instead.

### Facade Hooks

Thin composition wrappers around several hooks. Facades are acceptable when
they create a simpler interface for a component or preserve compatibility
during a migration. If a facade grows large or contains branching business
logic, split the underlying responsibilities.

Path:

```text
hooks/<domain>/facade/use-<surface>.ts
```

Facade hooks should mostly rename and group values. They should not introduce
new product behavior. A facade that only re-exports one or two callbacks is
usually noise; keep the public hook or use a plain function instead.

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

Existing domain folders may still be transitional. New hooks and cleanup work
should move toward the taxonomy above.

For product domains, responsibility folders are mandatory for new
non-migration files. A tiny domain does not need every folder, but it should
still use the folder for the kind it has:

```text
hooks/automations/workflows/use-automation-actions.ts
hooks/chat/derived/use-chat-surface-state.ts
hooks/workspaces/lifecycle/use-workspace-metadata-sync.ts
hooks/workspaces/cache/workspace-collections-query.ts
```

Do not add new flat files directly under `hooks/<domain>/`. During migrations,
flat files should be treated as transitional and moved into the appropriate
responsibility folder as the area is touched.

Do not create empty or speculative folder trees. Add the folders needed for the
files being moved now, and let later cleanup passes add more responsibility
folders as real files need them.

## Hook Cleanup Playbook

Use this sequence when cleaning an existing hook:

1. Classify the hook as access, UI, derived, workflow, lifecycle, or facade.
2. Write the ownership boundary first: "Owns X. Does not own Y."
3. Preserve the public hook API unless the task explicitly changes callsites.
4. Extract non-React code before creating more hooks.
5. Move pure product decisions to `lib/domain/**`.
6. Move multi-step product sequences to `lib/workflows/**`.
7. Move raw external calls to `lib/access/**` or `hooks/access/**`.
8. Create another hook only when the extracted code owns React behavior.
9. Keep dependency objects narrow; giant `EverythingDeps` types usually mean
   the workflow boundary is too broad.
10. Add or adjust focused tests around moved domain/workflow logic.

Prefer modest cleanup passes over idealized rewrites. The target architecture
guides direction; it is not a request to introduce every possible future file
or split a stable hook only to match a diagram. Preserve behavior, move the
obvious ownership violations first, and leave invasive rewrites explicit for a
separate plan.

When reading a hook, separate three regions:

```text
1. React reads: stores, queries, context, access hooks
2. Pure logic: inline if tiny, otherwise `lib/domain/**`
3. Async glue: inline if linear, `lib/workflows/**` if sequenced/branchy
```

Most god hooks are not solved by immediately creating workflows. First look for
pure decisions trapped in hooks, repeated selector boilerplate, and raw access
or cache code in the wrong layer.

Example: terminal actions should usually stay as one public
`useTerminalActions` hook. The hook gathers React dependencies and returns
`createTab`, `closeTab`, `renameTab`, and related callbacks. Record actions
move to `lib/workflows/terminals/terminal-record-workflows.ts`, stream
connection behavior moves to `terminal-stream-workflows.ts`, and normal
terminal resource calls should use `@anyharness/sdk-react` hooks. Desktop
access should keep only runtime/transport wiring that SDK React cannot own.

Example: prompt outbox dispatch should stay as one app-mounted lifecycle hook.
The hook owns singleton mount behavior, store subscription, and in-flight loop
coordination. It should extract focused substeps such as block preparation,
failure classification, runtime prompt access, and history reconciliation. Do
not replace it with one mega-workflow that needs every outbox, session,
latency, title, and access dependency in the app.

## Rules

- Product hooks should not construct raw cloud clients, AnyHarness clients, or
  Tauri invocations directly.
- Components should not call `queryClient.invalidateQueries` directly.
- Product hooks should not define query keys or own cache object shape.
- Components should not call multiple store setters in sequence; put that in a
  workflow hook.
- Product workflow hooks should read like route handlers. If the middle of the
  hook is the business algorithm, extract that algorithm to `lib/domain` or
  `lib/workflows`.
- Hooks may call hooks. Plain functions in `lib/**` must not call hooks.
- Query key helpers live alongside their access/query hooks.
- Product-domain `query-keys.ts` files are migration debt unless they cache
  product-composed state rather than one external resource.
- Query/mutation wrappers for external systems live in `hooks/access/**`, not
  product-domain hook folders.
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
