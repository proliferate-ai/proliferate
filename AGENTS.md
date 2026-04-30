# AnyHarness

Focused runtime for coding agents. Exposes an HTTP + SSE API for session
management, agent orchestration, and tool execution.

- Repo: <https://github.com/proliferate-ai/proliferate>

## Build & Dev

Runtime baseline: Rust stable, Node 22+, pnpm, Python 3.12, and `uv` for the
server.

```bash
# Runtime
cargo build
cargo run -- serve

# Core SDK
cd anyharness/sdk
pnpm install
pnpm run generate
pnpm run build

# Server
cd server
uv run pytest -q
```

## Local Full-Stack Profiles

Use `make dev PROFILE=<name>` for full-stack local development, especially when
multiple worktrees need to run at the same time. Do not use the default-port
`make dev-runtime`, `make dev-server`, or `make dev-desktop` shortcuts for
multi-worktree testing.

Useful commands:

```bash
make dev-init PROFILE=<name>
make dev-list
make dev PROFILE=<name>
make dev PROFILE=<name> STRIPE=1
```

Profile state lives under
`~/.proliferate-local/dev/profiles/<name>/`; AnyHarness runtime state lives
under `~/.proliferate-local/runtimes/<name>/`. Read
`docs/reference/dev-profiles.md` before changing profile launch behavior,
ports, generated Tauri config, or dev app identity.

## Read This First

Start with:

1. `docs/README.md`

The docs under `docs/**` are the authoritative standards for their area. If
this file overlaps with an area doc, the area doc wins.

You MUST READ the relevant area doc before touching code in that area.
Always do so at the start of the task, not halfway through implementation.

## Area Read Order

### Frontend (`desktop/src/**`)

1. `docs/frontend/README.md`
2. `docs/frontend/styling.md` when the change touches UI styling, primitives,
   tokens, or theme usage
3. `docs/frontend/chat-composer.md` when the change touches the chat composer,
   the panels above it (todo tracker, approval card, workspace/cloud status),
   or the Claude plan card in the transcript

### SDK (`anyharness/sdk/**`, `anyharness/sdk-react/**`)

1. `docs/sdk/README.md`

### Server (`server/**`)

1. `docs/server/README.md`

### AnyHarness Runtime (`anyharness/crates/**`)

1. `docs/anyharness/README.md`
2. `docs/anyharness/contract.md` if the change touches contract schemas
3. `docs/anyharness/binary.md` if the change touches the binary crate
4. the relevant subsystem doc under `docs/anyharness/src/**` when the change
   touches runtime logic

### CI/CD, Release, and Deployment (`.github/workflows/**`, `desktop/infra/**`, `server/infra/**`, updater publishing, desktop updater flow)

1. `docs/ci-cd/README.md`

If the release or deployment change also touches frontend, server, SDK, or
AnyHarness code, read the relevant area doc too.

## Repo-Wide Expectations

- Read the relevant area doc as early as possible before editing code in that
  area.
- Preserve current behavior unless an explicit behavior change is requested.
- Prefer ownership-correct extractions over cosmetic churn.
- Do not leave duplicate old and new code paths behind after a migration.
- Keep the repo buildable and run targeted verification when feasible.
- Follow the area docs before inventing new folders, layers, or patterns.

## Desktop Release Procedure

**NEVER trigger `Release Desktop` via `workflow_dispatch` on `main`.** The
updater manifest version is derived from `${GITHUB_REF_NAME#desktop-v}`. When
triggered on `main`, the manifest gets `version: "main"` instead of valid
semver, and the Tauri updater silently ignores it — users never see the update.

Correct procedure:

1. Bump the version in all three files (must match):
   - `desktop/package.json`
   - `desktop/src-tauri/tauri.conf.json`
   - `desktop/src-tauri/Cargo.toml`
2. Commit and push to `main`.
3. Create and push a tag: `git tag desktop-v<VERSION> && git push origin desktop-v<VERSION>`
4. The workflow triggers automatically on the tag push, or run manually
   **from the tag ref**: `gh workflow run "Release Desktop" --ref desktop-v<VERSION>`



----


# Repeated version of `docs/frontend/README.md`



# Frontend Standards

Status: authoritative for frontend code in this repo.

Scope:

- `desktop/src/**`

Use this doc to decide where new frontend logic goes and what rules it must
follow. Read [styling.md](styling.md) only when the change touches styling,
primitives, tokens, or theme usage.
Read [telemetry.md](telemetry.md) when the change touches analytics, error
capture, Sentry, PostHog, replay masking, or telemetry payloads.
Read [chat-composer.md](chat-composer.md) when the change touches the chat
composer area — the input, the panels that sit above it (todo tracker,
approval card, workspace status, cloud runtime), or the Claude plan card in
the transcript.

Cloud note:

- The cloud guidance below describes the target architecture now, even where
  some current hooks are still transitional.

Component note:

- The component guidance below describes the target architecture now, even
  where some current folders still reflect an older mixed layout.

## 1. File Tree

```text
desktop/src/
  App.tsx
  main.tsx
  assets/
  components/
    ui/
    <domain>/
  config/
  hooks/
    ui/
    <domain>/
  lib/
    domain/
      <domain>/
    infra/
    integrations/
      cloud/
      anyharness/
  pages/
  platform/
    tauri/
  providers/
  stores/
    <domain>/
  index.css
```

Use this as the default shape. Do not add new top-level frontend folders
without explicit approval.

## 2. Non-Negotiable Rules

- Use `@/` imports for app-root paths under `desktop/src/**`.
- Keep imports direct and concrete. No barrel files or convenience re-export
  files.
- `components/**` is `.tsx` only.
- `hooks/**`, `lib/**`, `stores/**`, `config/**`, and `platform/tauri/**` are
  `.ts` only.
- `pages/**` is route orchestration only.
- New root folders under `components/` should be product areas, not visual-type
  buckets like `modals`, `panels`, or `topbar`.
- Do not render raw `<button>`, `<input>`, `<label>`, `<select>`, or
  `<textarea>` outside approved primitives in `components/ui/**`.
- Reusable icons belong in `components/ui/icons.tsx`, not inline inside feature
  components.
- Put foundational component primitives and shells in `components/ui/**`.
  Examples: base buttons and inputs, reusable modal shells, confirmation
  dialogs, popover surfaces, and generic layout surfaces.
- Prefer `className` for callsite styling. Use inline `style={...}` only for
  truly dynamic values that cannot be expressed cleanly with existing utilities
  or CSS variables, such as runtime-calculated panel widths.
- Keep domain-aware flows in their owning product area even when they render as
  dialogs, panels, sidebars, or top bars. Do not promote a component into
  `components/ui/**` if it knows about product workflows, store state, request
  logic, or domain-specific copy.
- No raw Tailwind palette classes. Use semantic theme tokens only.
- Do not add a parallel generic AnyHarness request layer in desktop.
- Generic React-facing AnyHarness access goes through `@anyharness/sdk-react`.
- Low-level AnyHarness streaming and transcript primitives stay in
  `@anyharness/sdk`.
- Do not create ad hoc `openapi-fetch` clients outside
  `lib/integrations/cloud/client.ts`.
- Raw cloud client calls and raw endpoint paths belong only in
  `lib/integrations/cloud/**`.
- Pages, components, and stores must not call raw cloud client methods.
- Hooks should call named cloud request helpers, not inline `client.GET`,
  `client.POST`, `client.PUT`, or `client.DELETE` with raw path strings.
- Use generated OpenAPI request and response types as the source of truth for
  cloud transport shapes.
- Add a thin cloud type alias only when it materially improves reuse or
  narrows a too-loose generated type for UI logic.
- Raw Tauri access belongs only in `platform/tauri/**`.
- `lib/integrations/anyharness/**` is reserved for product-specific desktop
  runtime and connection logic, not generic AnyHarness resource wrappers.
- Hooks and providers own telemetry. Components render and should not emit
  telemetry directly, except explicit error boundaries.
- Analytics payloads must not include prompts, transcript content, terminal
  output, file contents, absolute paths, repo names, or raw error strings.
- Replay and session recording must be safe-by-default and opt-in. Workspace
  and settings surfaces should be blocked unless there is a reviewed reason
  not to.
- Global React Query error capture must not double-report failures already
  captured in a query or mutation hook.
- Avoid god modules and god stores. If one file mixes multiple domains or too
  many responsibilities, split it.
- Prefer splitting before roughly 400 lines. Files at 600+ lines need a strong
  reason to stay whole. Mixed ownership should be split even below those
  thresholds.
- Preserve the current UI unless an explicit redesign is requested.
- Delete dead code.
- Colocate types with the code that owns them. Rust return shapes live
  in `platform/tauri/`. Generated API types live in cloud client. App-defined
  domain models live in `lib/domain/`. Store types live in store files.
  Do not create shared type folders.

## 3. State Management Rules

These rules govern how state is stored, accessed, and derived across the
frontend. Violations here are the most common source of unnecessary re-renders,
stale data, and subtle bugs.

### Store consumption

- Always use selectors when reading from Zustand stores:
  `useStore(s => s.field)`. Never call `useStore()` without a selector.
  Grabbing the whole store subscribes the component to every change in the
  store and defeats the purpose of Zustand's selector-based subscription
  model.
- When selecting multiple fields, use `useShallow` from
  `zustand/react/shallow` to avoid new-reference re-renders:
  `useStore(useShallow(s => ({ a: s.a, b: s.b })))`.

### Store scope

- Store setters should be single `set()` calls. They receive a value and put
  it in the store. No API calls, no query invalidation, no multi-step
  orchestration.
- If an operation requires more than one `set()` call, coordinates with
  React Query, closes SSE handles, or reaches into other stores, it belongs
  in a workflow hook, not a store action.
- Stores hold pointers and UI interaction state: what is selected, what is
  open, what is active. They do not hold server data or become a cache for
  remote resources.
- Stores do not reach into other stores. If two stores need coordinated
  updates, a workflow hook orchestrates both.
- Pure domain helper functions (e.g. `isSessionSlotBusy`) do not belong in
  store files. Put them in `lib/domain/<domain>/`.

### Query defaults and reference stability

- Do not use inline fallback defaults in query destructuring:
  `{ data: items = [] }` creates a new empty array reference on every render
  while the query is loading, which breaks downstream `useMemo` and
  `React.memo` comparisons.
- Define stable constants outside the component and use those as defaults:
  ```ts
  const EMPTY: never[] = [];
  // inside component
  const { data: items = EMPTY } = useSomeQuery();
  ```
- The same applies to object defaults: `{ data: config = {} }` creates a new
  reference every render. Use a module-level constant instead.

### Derived state

- If a value can be computed from existing state, compute it inline or in a
  hook. Do not store it in Zustand or `useState`.
- Do not use `useEffect` to watch one piece of state and set another. That
  pattern creates unnecessary render cycles (render → effect → set state →
  re-render) where a simple `const derived = computeFrom(source)` would give
  the same result in one render.
- Extract non-trivial derived computations into dedicated hooks when they
  compose multiple sources or when the same derivation is needed in more than
  one component.
- Zustand getter properties that compute values from other store fields
  should be extracted into derived hooks instead.

### useMemo and useCallback

- `useMemo` and `useCallback` are only as stable as their dependencies. If a
  dependency is a new reference every render (e.g. the whole Zustand store,
  an inline `= []` default), the memo recalculates every render and provides
  no benefit.
- Before adding a `useMemo`, verify that each dependency is reference-stable.
  Fix unstable dependencies first.

### useEffect

- Valid uses: SSE/WebSocket connections, Tauri IPC listeners, DOM event
  subscriptions (click outside, keyboard shortcuts, resize observers), timers,
  debouncing, and one-time initialization (theme, auth bootstrap).
- Invalid uses: fetching data (use React Query), deriving state from other
  state (compute inline), and watching one state to set another state.
- Always include a dependency array. `useEffect(fn)` with no deps runs every
  render and is almost always a bug.

## 4. Ownership Model

Use the lowest layer that can own the logic cleanly.

| Concern                                    | Owner                                               | Rule of thumb                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local presentational state                 | component state                                     | Keep it local when only one subtree needs it.                                                                                                                                                                                                                                                             |
| Shared client-only state                   | `stores/**`                                         | Selection, panels, dialogs, drafts, resize state, and approved local runtime/editor state only. Single `set()` setters only.                                                                                                                                                                              |
| UI-facing orchestration                    | `hooks/**`                                          | Repeated effects, query and mutation behavior, route gates, multi-step workflows, and logic that composes remote data with local state.                                                                                                                                                                   |
| Derived UI state                           | `hooks/**`                                          | Computed from store + query + provider state. No persistent storage. If you can compute it, do not store it.                                                                                                                                                                                              |
| Pure domain logic                          | `lib/domain/**`                                     | No React, no JSX, no stores.                                                                                                                                                                                                                                                                              |
| Cloud access                               | `lib/integrations/cloud/**` plus hooks              | `client.ts` owns the singleton OpenAPI client plus auth/refresh and error middleware; `lib/integrations/cloud/<domain>.ts` owns named request helpers and transport normalization; hooks own query keys, `useQuery` / `useMutation`, invalidation, retries, telemetry, and other UI-facing orchestration. |
| Generic AnyHarness React access            | `@anyharness/sdk-react`                             | Providers, query hooks, mutation hooks, query keys, and shared client access.                                                                                                                                                                                                                             |
| Low-level AnyHarness streams and reducers  | `@anyharness/sdk`                                   | `streamSession`, `connectTerminal`, transcript reducers, and other framework-agnostic primitives.                                                                                                                                                                                                         |
| Product-specific AnyHarness desktop wiring | `lib/integrations/anyharness/**` plus product hooks | Runtime bootstrap, credentials, runtime target resolution, workspace connection mapping, and app-specific orchestration only.                                                                                                                                                                             |
| Raw Tauri access                           | `platform/tauri/**`                                 | Typed wrappers only. No raw `invoke(...)` elsewhere.                                                                                                                                                                                                                                                      |
| Static product definitions                 | `config/**`                                         | Labels, options, navigation definitions, and status/display maps.                                                                                                                                                                                                                                         |
| App-wide context boundaries                | `providers/**`                                      | Rare and explicit: query client, theme, telemetry, auth/session wrappers.                                                                                                                                                                                                                                 |

Remote state rule:

- TanStack Query owns authoritative remote state.
- Stores do not become a cache for AnyHarness or cloud resources.

## 5. Hook Organization

Organize hooks by domain. File names indicate purpose.

```text
hooks/
  ui/                                # generic interaction primitives
    use-resize.ts
    use-click-outside.ts
    use-keyboard-shortcut.ts
  workspaces/
    query-keys.ts                    # key factories for this domain
    use-workspaces.ts                # useQuery — fetches workspace list
    use-workspace-detail.ts          # useQuery — fetches single workspace
    use-create-worktree.ts           # useMutation — creates worktree
    use-workspace-selection.ts       # workflow — orchestrates switching
  sessions/
    query-keys.ts
    use-sessions.ts                  # useQuery — fetches sessions
    use-create-session.ts            # useMutation — creates session
    use-session-runtime.ts           # SSE connection hook + uses reducer
    session-reducer.ts               # pure function, no React, no use- prefix
  chat/
    use-chat-view-mode.ts            # derived — computes screen mode
    use-chat-defaults.ts             # derived — resolves model/agent
    use-ready-configs.ts             # derived — filters ready providers
  cloud/
    query-keys.ts
    use-cloud-credentials.ts         # useQuery
    use-cloud-billing.ts             # useQuery
    use-cloud-credential-actions.ts  # useMutation (sync, delete)
    use-cloud-workspace-actions.ts   # useMutation (create, start, stop)
```

Naming conventions:

- `use-[things].ts` — query (plural usually means list)
- `use-[thing]-detail.ts` — query for single item
- `use-create-[thing].ts` or `use-[thing]-actions.ts` — mutation(s)
- `use-[thing]-selection.ts` or `use-[thing]-runtime.ts` — workflow hooks
- `use-[thing]-mode.ts` or `use-[thing]-state.ts` — derived hooks
- `[thing]-reducer.ts` — pure reducer function (no `use-` prefix, not a hook)
- `query-keys.ts` — key factories, colocated with their domain queries

Rules:

- `hooks/ui/` is for domain-agnostic interaction primitives (resize, click
  outside, keyboard shortcuts). The hook equivalent of `components/ui/`.
- Query key helpers live alongside their queries in the same domain folder.
- Each mutation or closely related group of mutations gets its own file.
- Reducers are pure functions, not hooks. They live next to the hook that
  consumes them. No `use-` prefix.
- Do not create god hooks that mix five mutations with retry logic,
  credential syncing, telemetry, invalidation, and store updates.
- Components should not call `queryClient.invalidateQueries` directly or
  call multiple store setters in sequence. That logic belongs in a workflow
  or mutation hook.

## 6. Component Patterns

- Components render. They do not compute, orchestrate, or fetch.
- If a component has a `useMemo` doing real computation (not a trivial
  derivation), extract it into a hook. The component calls the hook and
  renders the result.
- Functions flow down (parent defines what happens), events flow up (child
  defines when it happens via callbacks).
- Push state down. Only lift state when two siblings need to share it.
- Use the children pattern to avoid re-rendering expensive subtrees when
  unrelated state changes in a parent.
- Use `React.memo` when a component re-renders often due to parent state
  changes but its own props rarely change. Verify that props are
  reference-stable first — `React.memo` is useless if props are new
  references every render.
- Use error boundaries around major sections to prevent one component's
  crash from killing the entire app.
- Split components at data boundaries: if a child needs data that requires
  a guard (`if (!data) return <Spinner />`), make the guard the parent and
  the data consumer the child. This avoids hooks-after-early-return issues
  and makes the child's hooks safe.

## 7. Folder Guide

Use these folder-level guidelines after the ownership model above has already
told you which layer should own the logic.

- `pages/`: keep route files thin; read params and navigation state, call
  page-level hooks, and render one screen component.
- `components/ui/`: use for shared primitives and reusable icons only; do not
  let feature flows or request logic accumulate here. Reusable shells like a
  modal frame, confirmation dialog, popover surface, or generic layout surface
  belong here only when they are truly domain-agnostic.
- `components/<domain>/`: organize UI by domain and keep it rendering-focused;
  move repeated orchestration into hooks. Domain folders should answer "what
  part of the product is this for?" Nested folders can then answer "what part
  of that domain is this?" Examples: `workspace/chat/input/**`,
  `workspace/chat/transcript/**`, `workspace/git/**`, or `workspace/shell/**`.
  New code should prefer domain-first grouping over root buckets like
  `modals/`, `panels/`, `sidebar/`, or `topbar/`.
- `hooks/`: this is where UI-facing orchestration should accumulate; do not add
  JSX, provider composition, raw client construction, or duplicate generic
  AnyHarness resource hooks. `hooks/ui/` holds domain-agnostic interaction
  primitives. Domain folders hold queries, mutations, workflows, and derived
  hooks. For cloud access, `hooks/cloud/**` should compose named request
  helpers from `lib/integrations/cloud/**`, then own query keys, invalidation,
  retries, telemetry, and other UI-facing behavior.
- `lib/domain/`: keep pure logic here; if code needs React, JSX, or stores, it
  belongs somewhere else. Pure domain helpers like `isSessionSlotBusy` belong
  here, not in store files.
- `lib/integrations/cloud/`: `client.ts` owns the singleton Proliferate
  OpenAPI client, auth/refresh middleware, and shared error types. Domain
  modules like `repos.ts`, `workspaces.ts`, `credentials.ts`, `billing.ts`,
  and `support.ts` own thin named request helpers only. Keep raw path strings
  and `client.GET/POST/...` here; keep query invalidation, store writes,
  telemetry, and workflow logic in hooks.
- `lib/integrations/anyharness/`: keep only product-specific desktop runtime
  and connection adapters here; generic AnyHarness resource access belongs in
  `@anyharness/sdk-react`.
- `lib/infra/`: use for low-level shared non-domain helpers, not product-domain
  behavior.
- `stores/`: keep stores narrow and local to one shared client concern; if data
  is authoritative and refetchable, it should not live here. Store setters are
  single `set()` calls only. No workflow logic, no reaching into other stores,
  no SSE handle management.
- `providers/`: add sparingly and only for true app-wide boundaries. Providers
  hold small, slow-changing scope values (identity, connection). Always
  `useMemo` the provider value to prevent unnecessary consumer re-renders.
- `config/`: keep static product definitions here, not runtime state or request
  logic.
- `platform/tauri/`: wrap raw platform APIs once and consume those wrappers
  elsewhere.
- `assets/`: files only; reusable React icons still belong in `components/ui/`.

Canonical cloud pattern:

```ts
// lib/integrations/cloud/repos.ts
import { getProliferateClient, type CloudRepoBranchesResponse } from "./client";

export async function listCloudRepoBranches(
  gitOwner: string,
  gitRepoName: string,
): Promise<CloudRepoBranchesResponse> {
  return (
    await getProliferateClient().GET(
      "/v1/cloud/repos/{git_owner}/{git_repo_name}/branches",
      { params: { path: { git_owner: gitOwner, git_repo_name: gitRepoName } } },
    )
  ).data!;
}

// hooks/cloud/use-cloud-repo-branches.ts
import { useQuery } from "@tanstack/react-query";
import { listCloudRepoBranches } from "@/lib/integrations/cloud/repos";

export function useCloudRepoBranches(
  gitOwner: string,
  gitRepoName: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["cloud", "repos", gitOwner, gitRepoName, "branches"],
    queryFn: () => listCloudRepoBranches(gitOwner, gitRepoName),
    enabled: enabled && gitOwner.trim().length > 0 && gitRepoName.trim().length > 0,
  });
}
```

Canonical component pattern:

```text
components/
  ui/
    ConfirmationDialog.tsx
    ModalShell.tsx
  workspace/
    shell/
      MainScreen.tsx
      TopBar.tsx
      MainSidebar.tsx
    chat/
      input/
        ChatInput.tsx
        SessionModeControl.tsx
    git/
      CommitDialog.tsx
      GitPanel.tsx
```

- `components/ui/**` is for foundational pieces reusable without product
  knowledge.
- Domain folders own workflow-aware UI, even when it renders as a dialog,
  panel, sidebar, or toolbar.
