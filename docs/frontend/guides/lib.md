# Frontend Lib

`lib/**` is non-component logic. Hooks own React behavior. Access layers own
external systems.

## `lib/domain/**`

Pure product logic for one app.

Use app-local `lib/domain/**` when the rule is platform/app-specific. Move the
rule to `apps/packages/product-domain/**` when Desktop, Web, or Mobile need the
same decision or view model.

Owns:

- product validation and normalization
- status labels, tones, icons, and display metadata
- workspace/session/chat projection models
- pure reducers
- pure side-effect planners

Must not import:

- React, JSX, hooks, stores, providers, query clients
- DOM, React Native components, Tauri, or platform APIs
- SDK clients, raw access helpers, or app code from another boundary

Shape:

```text
lib/domain/<domain>/<subdomain>/<rule>.ts
```

Name files for the product rule: `<specific-rule>.ts`,
`<thing>-model.ts`, `<thing>-reducer.ts`, `<thing>-effect-plan.ts`, or
`<thing>-presentation.ts`. Avoid `utils.ts`, `helpers.ts`, and broad
`types.ts` files unless the scope is tiny and local.

### Side-Effect Planners

A planner decides what effects should happen and returns an explicit plan. It
does not execute effects. The executor belongs in a workflow hook, lifecycle
hook, or `lib/workflows/**`.

Use planners when product decisions are pure but the resulting effects are not,
such as stream refresh decisions, toast decisions, or reconciliation commands.

## `lib/workflows/**`

Plain non-React product sequences.

Use this when a user or lifecycle action coordinates multiple dependencies and
the sequence should be readable/testable outside React. The owning hook gathers
dependencies and calls the workflow.

Owns:

- ordered product sequences
- branching across fetched/local data
- retries, rollback, and multi-step error recovery
- app-local orchestration that should not call hooks directly

Must not import:

- React hooks, providers, stores, or query clients
- hidden singletons for app state
- raw endpoint paths or client construction for product workflows

Shape:

```text
lib/workflows/<domain>/<workflow>.ts
```

Use an `(input, deps)` shape. Per-call values belong in `input`. Live
capabilities belong in `deps`: access calls, store setters, cache invalidation,
navigation, toasts, telemetry, runtime resolution, clocks, and id generation.

Do not pass pure helpers, constants, or formatting functions as deps. Import
pure domain helpers and static config directly.

Keep a sequence in the workflow hook when it is a short single action. Move it
to `lib/workflows/**` when ordering, branching, rollback, retry, or testability
is the reason for the extraction.

## `lib/access/**`

Raw app-local access helpers.

Use this for client setup, platform bridges, native wrappers, auth/storage
integration, and thin app-specific adapters around SDK clients. Query/mutation
hooks that expose this access to React live in `hooks/access/**`.

Must not own product workflow branching, UI state, stores, or reusable shared
package logic.

See [access.md](access.md) for the concrete system map.

## `lib/infra/**`

Generic technical machinery with no product-domain vocabulary.

Owns:

- persistence helpers
- scheduling, batching, and timers
- ids and stable keys
- measurement plumbing
- safe JSON parsing
- logging utilities

If a function knows about chats, sessions, workspaces, agents, billing,
repositories, or prompts, it is not infra.

Shape:

```text
lib/infra/<technical-concern>/<helper>.ts
```
