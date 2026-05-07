# Frontend Lib

`lib/**` is for non-component logic. Keep React behavior in hooks and raw
external access in `lib/access/**`.

## `lib/domain/**`

Pure product logic.

Use this for rules that understand Proliferate concepts but do not need React,
stores, query clients, platform APIs, or external clients.

Examples:

- chat surface mode transitions
- session status labels
- workspace display names
- prompt outbox reconciliation
- validation rules for product models

Rules:

- No React, JSX, hooks, stores, query clients, telemetry, or raw access.
- Keep functions deterministic when possible.
- Organize large domains by subdomain and product purpose, not by generic file
  types like `utils` or `helpers`.
- Pure side-effect planners belong here when the decision is product logic.
  They inspect state/events and return an explicit plan; they do not execute
  the effects.

Target shape:

```text
lib/domain/
  chat/
    composer/
    launch/
    models/
    outbox/
    session-controls/
    subagents/
    surface/
    tools/
    transcript/
  workspaces/
    changes/
    cloud/
    creation/
    display/
    mobility/
    selection/
    shell/
    sidebar/
    tabs/
    viewer/
```

File naming:

- `<specific-rule>.ts` for pure decisions and computations
- `<thing>-model.ts` for model construction
- `<thing>-reducer.ts` for pure reducers
- `<thing>-effect-plan.ts` for pure side-effect planning
- `<thing>-presentation.ts` or `presentation.ts` for state-to-display metadata
- `<thing>.test.ts` next to meaningful pure logic when coverage is useful

Avoid names like `utils.ts`, `helpers.ts`, or `types.ts` unless the file is
truly tiny and local to one subdomain. Prefer names that state the product rule.

### Side-Effect Planners

Use this pattern when product logic needs to decide what effects should happen
but should not execute those effects directly.

Domain planner:

```ts
export function planSessionStreamEffects(input): SessionStreamEffectPlan {
  return {
    refreshSummary: true,
    playTurnEndSound: false,
    mountLinkedSessionIds: [],
  };
}
```

Workflow or lifecycle hook executor:

```ts
const plan = planSessionStreamEffects(snapshot);
if (plan.refreshSummary) {
  await deps.refreshSummary();
}
if (plan.playTurnEndSound) {
  deps.playTurnEndSound();
}
```

The planner belongs in `lib/domain/**` because it is pure product decision
logic. The executor belongs in a workflow hook, lifecycle hook, or
`lib/workflows/**` because it performs side effects.

## `lib/workflows/**`

Plain non-React product sequences.

Use this when logic coordinates multiple dependencies but should not be tied to
React. The hook gathers dependencies and passes them in; the workflow runs the
sequence.

Examples:

- create workspace then create initial session
- prepare prompt payload then dispatch
- reconcile materialized workspace metadata

Rules:

- No React hooks.
- Dependencies are passed in as arguments.
- Keep side effects explicit in the dependency interface.
- Workflow hooks should remain thin controllers around these functions.
- Do not import access hooks, stores, query clients, or React providers.
- Do not construct raw clients or call raw endpoint paths unless the workflow is
  explicitly designed as an access-layer helper. Product workflows should
  receive access callbacks from the hook that calls them.

Target shape:

```text
lib/workflows/
  sessions/
    create-session-workflow.ts
    prompt-session-workflow.ts
  workspaces/
    materialize-workspace-workflow.ts
```

Workflow functions should accept a small dependency object instead of importing
singletons. That keeps the sequence testable and makes side effects visible.
Use an `(input, deps)` shape by default. The dependency object should expose
side effects as named callbacks, not hidden imports.

### Workflow Dependency Interfaces

Dependencies are for live side effects and runtime collaborators: access
calls, store setters, cache invalidation, navigation, toasts, telemetry,
runtime connection resolution, clocks, and id generation when testability
requires it.

Do not pass pure helpers, constants, or simple formatting functions as
dependencies. Import pure domain helpers and static config directly.

Prefer small capability interfaces and compose narrow workflow deps:

```ts
interface TerminalRuntimeDeps {
  getWorkspaceRuntimeBlockReason(workspaceId: string): string | null;
  resolveWorkspaceConnection(workspaceId: string): Promise<TerminalConnection>;
}

interface TerminalCacheDeps {
  invalidateWorkspaceTerminals(workspaceId: string): Promise<void>;
}

interface TerminalRecordAccessDeps {
  createTerminal(
    connection: TerminalConnection,
    input: CreateTerminalRequest,
  ): Promise<TerminalRecord>;
  closeTerminal(connection: TerminalConnection, terminalId: string): Promise<void>;
  isMissingTerminalError(error: unknown): boolean;
}

type CreateTerminalDeps =
  TerminalRuntimeDeps
  & Pick<TerminalRecordAccessDeps, "createTerminal">
  & TerminalCacheDeps;
```

Each workflow should receive only the capabilities it uses. Avoid one giant
`TerminalEverythingDeps` or `PromptOutboxEverythingDeps` object. If a workflow
needs a very large dependency type, split the workflow into smaller substeps or
keep the owning hook as the readable orchestrator.

Use one workflow file per cohesive family at first:

```text
lib/workflows/terminals/
  terminal-record-workflows.ts
  terminal-stream-workflows.ts
```

Split into per-action files only when a family file becomes too large or mixes
unrelated ownership:

```text
lib/workflows/terminals/
  create-terminal-workflow.ts
  close-terminal-workflow.ts
```

Example shape:

```ts
export async function createWorkspaceWorkflow(input, deps) {
  const workspace = await deps.createWorkspace(input.workspace);
  const session = await deps.createSession({ workspaceId: workspace.id });
  deps.activateWorkspace({ workspaceId: workspace.id, sessionId: session.id });
  return { workspace, session };
}
```

Another example:

```ts
export async function closeTerminalWorkflow(input, deps) {
  const blockedReason = deps.getBlockReason(input.workspaceId);
  if (blockedReason) {
    deps.showToast(blockedReason);
    return "blocked";
  }

  try {
    await deps.closeTerminal(input.terminalId, input.workspaceId);
    deps.clearTerminalState(input.terminalId, input.workspaceId);
    return "closed";
  } finally {
    await deps.invalidateTerminals(input.workspaceId);
  }
}
```

The corresponding hook wires the dependencies:

```ts
export function useCreateWorkspaceActions() {
  const createWorkspace = useCreateWorkspaceMutation();
  const createSession = useCreateSessionMutation();
  const activateWorkspace = useSelectionStore((state) => state.activateWorkspace);

  return {
    create: (input) => createWorkspaceWorkflow(input, {
      createWorkspace: createWorkspace.mutateAsync,
      createSession: createSession.mutateAsync,
      activateWorkspace,
    }),
  };
}
```

## `lib/infra/**`

Generic technical machinery that does not care about product domains.

Examples:

- persistence helpers
- scheduling and batching
- ids and stable key helpers
- measurement plumbing
- safe JSON parsing
- logging utilities

If a function knows about chats, sessions, workspaces, agents, billing, or
repositories, it is not infra.

Target shape:

```text
lib/infra/
  persistence/
  scheduling/
  measurement/
  ids/
  logging/
```

Organize infra by technical mechanism, not by product domain.

## `config/**`

Real static configuration: constants, limits, option sets, route ids, default
ids, ordering, and runtime-independent knobs.

Good examples:

- route ids
- maximum composer rows
- known provider ids
- ordered settings sections
- runtime default constants

Do not put human-facing copy or presentation mappings here.

File naming should name the constant area, not the component using it:

```text
config/app-routes.ts
config/chat-layout.ts
config/runtime.ts
config/shortcuts.ts
```

## `copy/**`

Human-facing words and authored text.

Examples:

- titles and subtitles
- button labels
- empty-state copy
- onboarding text
- user-facing prompt templates

Prefer complete copy variants over tiny string shards. It is okay for copy to
be conditional, but the condition should usually live in domain/presentation
logic rather than in a component.

Target shape:

```text
copy/home/home-screen-copy.ts
copy/cloud/cloud-status-copy.ts
copy/plans/plan-prompts.ts
```

## Presentation Mappings

Presentation mappings convert product state to display metadata: labels, tones,
icons, descriptions, ordering, and visibility flags.

Put reusable mappings in `lib/domain/<domain>/<subdomain>/presentation.ts`.
Keep them component-local only when they are purely visual and not reused.

Examples:

- cloud workspace status -> label/tone/description
- session control -> display label/icon
- agent availability -> badge tone

Presentation mappings are not access logic and are not remote caches.
