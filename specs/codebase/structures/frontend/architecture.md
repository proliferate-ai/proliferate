# Frontend Architecture

Status: consolidated architecture reference for Desktop, Web, Mobile, and shared
frontend packages. The per-layer guides remain the detailed canon; this doc is
the single structured overview — purpose, the 20k-foot model, core workflows,
and each folder's best practices.

---

## 1. Purpose / Ownership

The frontend is split into distinct folders for UI, state, long-lived client
state, access, reusable logic, workflows, providers, and shared packages. The
goals:

- **Predictable placement** — a file path tells you what kind of code is allowed
  there *before you open it*.
- **Legible decomposition** — complicated product work is decomposed and
  reviewable; you never have to follow imports through unrelated layers to
  understand a feature.
- **Build broadly without re-learning** — the same folder logic across apps.

**Scope:** `apps/desktop/src/**`, `apps/web/src/**`, `apps/mobile/src/**`, and
`apps/packages/**`. Desktop/Web/Mobile share folder logic; platform-specific
folders exist only where the platform genuinely differs (Tauri + local
AnyHarness on Desktop; browser/Cloud on Web; native nav/RN on Mobile).

**The three rules that generate everything:**

1. **Lowest layer that can own it cleanly.** Push logic down: component → hook →
   `lib`. Never solve in a component what a hook can own, or in a hook what a
   plain function can own.
2. **A path tells you what's allowed before you open it.**
3. **Dependency direction is one-way:**
   ```text
   components → hooks → hooks/access → lib/access → SDK/platform
                     → lib/workflows → lib/domain / lib/infra
                     → stores / providers
   ```
   `lib/**` never calls hooks or reads stores. Packages never import app code.

The corollary that decides placement: **pure code is reachable by `import`;
live code (stores, access, effects) must be handed in as a dependency.**

---

## 2. 20k-Foot Detailed View

Every file is one of **four substances**. Hooks are the only layer allowed to
mix them.

| Substance | What it is | Lives in |
| --- | --- | --- |
| **State** | memory | `useState`, `stores/**`, React Query, `providers/**` |
| **Access** | transport to systems | `hooks/access/**`, `lib/access/**`, SDK packages |
| **Work** | logic | `lib/domain/**`, `lib/workflows/**`, `lib/infra/**` |
| **Composition** | the glue | `hooks/**`, `components/**` |

### State — place by source of truth

The axis is **who owns the truth**, not "external vs product."

- **A system owns it** (Cloud, AnyHarness, native) → **remote state** → TanStack
  Query, reached only through the access layer. Never mirror it into a store;
  the query cache *is* the cache.
- **The client owns it** → **client-only state**, smallest owner that works:
  - **Local** (`useState`): one subtree. Lift only when shared (drilling 1–2
    levels is fine and preferred over a store).
  - **Store** (Zustand, `stores/<domain>/**`): shared/cross-screen facts —
    selected ids, tabs, drafts, runtime UI. Setters are single `set()` intents.
  - **Provider** (`providers/**`): scoped *dependencies* and subtree boundaries
    (query client, auth, theme, runtime context), not mutable data.

Two laws: **derived values never live in a store** (use a `derived` hook), and
**persistence never lives in the store file** (a `lifecycle` hook owns the
disk↔store bridge).

### Access — a fixed grid

Three systems × two stages. Clients are never constructed elsewhere.

| System | Raw transport | React-facing |
| --- | --- | --- |
| Cloud | `@proliferate/cloud-sdk`, `lib/access/cloud/**` | `@proliferate/cloud-sdk-react`, `hooks/access/cloud/**` |
| AnyHarness | `@anyharness/sdk` | `@anyharness/sdk-react`, `hooks/access/anyharness/**` |
| Tauri | `lib/access/tauri/**` (only `invoke`) | `hooks/access/tauri/**` |

Query keys live beside the access hook that owns the resource — never in
`lib/access`, never in a product folder. CI enforces raw client verbs stay under
`lib/access/cloud/**` and `useQueryClient` stays out of product hooks.

### Work — decide / sequence / plumb

| Stage | Address | Signature | Owns |
| --- | --- | --- | --- |
| **Domain** | `lib/domain/**` | `(data) → decision` | validation, projections, view models, presentation maps, reducers, side-effect *planners* |
| **Workflow** | `lib/workflows/**` | `async (input, deps)` | ordered sequences, branching on fetched data, retries, rollback, recovery |
| **Infra** | `lib/infra/**` | generic fn | persistence, scheduling, ids, batching, measurement |

The `(input, deps)` contract: **`input`** = per-call values; **`deps`** = live
capabilities (access calls, store setters, invalidation, navigation, toasts,
telemetry, clocks, ids). Pure helpers/constants are imported, never passed as
deps. A fat `EverythingDeps` means the boundary is wrong.

### Composition — the hook types

| Type | Address | Gathers | Returns |
| --- | --- | --- | --- |
| access | `hooks/access/<system>/**` | raw SDK/clients | query/mutation objects, keys, invalidation |
| derived | `hooks/<domain>/derived/**` | stores + providers + access *reads* | UI-ready state (no callbacks) |
| workflow | `hooks/<domain>/workflows/**` | stores + access + *capabilities* | callbacks (user actions) |
| lifecycle | `hooks/<domain>/lifecycle/**` | streams, timers, subscriptions, plans | nothing — cleans up everything |
| ui | `hooks/ui/**`, `hooks/<domain>/ui/**` | refs, DOM events, measurement | UI mechanics |
| cache | `hooks/<domain>/cache/**` | multiple sources | one product-composed cache |
| facade | `hooks/<domain>/facade/**` | several hooks above | renamed/grouped bundle (no new behavior) |

The one word separating **derived** from **workflow** is *capabilities* — the
power to cause effects. Read-only ingredients describe state (derived);
read + capabilities cause actions (workflow).

### The folder tree (per app source root)

```text
<app>/src/
  App.tsx · main.tsx          # bootstrap + provider composition
  assets/
  components/<domain>/<surface>/<role>/   # RENDER only (.tsx)
  config/ · copy/
  hooks/
    access/<system>/
    ui/
    <domain>/ derived/ workflows/ lifecycle/ ui/ cache/ facade/
  lib/
    access/<system>/
    domain/<domain>/<subdomain>/
    workflows/<domain>/
    infra/<concern>/
  navigation/ · pages/ · providers/
  stores/<domain>/
  styles/ · index.css
```

### Shared packages — two foundations + a three-layer DOM stack

```text
DOM stack (Desktop/Web):        Foundations (everyone):
  product-surfaces  connected     product-domain   pure shared rules (Mobile's sharing point)
  product-ui        presentation  design           tokens + css (the look)
  ui                primitives
  design            css/tokens
```

`apps → product-surfaces → product-ui → ui → design`; everyone → `product-domain`.
Mobile uses only `design/react-native` + `product-domain` + SDK — never the DOM
packages.

---

## 3. Core Workflows

**Recipe A — show + do (derived + workflow behind a facade).** A screen that
must both display and act:
```text
facade hook
  ├─ derived hook   → reads stores/query → returns view state   (no writes)
  └─ workflow hook  → gathers capabilities → returns callbacks  (no view logic)
```
A derived hook must not return mutating callbacks; if the component needs both,
compose a derived + workflow hook behind a facade.

**Recipe B — fallible sequence (workflow hook → `lib/workflows` → `lib/domain`).**
```text
workflow hook        gathers React mutations/stores/capabilities into `deps`,
                     passes per-call `input`, owns try/finally + isRunning state
  └─ lib/workflows fn  runs the ordered sequence using injected deps
       └─ lib/domain fn  makes the hard branching decision, pure + tested
```
Extract to `lib/workflows` only when the sequence has ordering invariants,
branching on fetched data, rollback, retries, recovery, or a real test boundary.
Otherwise keep the callback inline in the workflow hook.

**The side-effect planner.** A pure `lib/domain` function that *decides what
effects should happen* and returns a typed plan, executing nothing. The executor
lives in a hook. Turns the hardest-to-test logic (effect orchestration) into a
pure, tested function.

**Persistence.** The store holds the shape + setters + `hydrate`. A `lifecycle`
hook owns the disk↔store bridge: load once → subscribe-and-write → tear down.
Never put disk I/O or subscriptions in the store file.

**The placement algorithm — three questions in order:**
1. What substance is this? (state / access / work / render / content)
2. What's the source of truth, and who else needs it?
3. What's the lowest layer that can own it cleanly?

---

## 4. Each Folder's Best Practices

### `components/<domain>/<surface>/<role>/**`
- **Owns:** render, call hooks, forward callbacks, subtree presentation state.
- **Never:** raw access, query invalidation, multiple store setters in one
  callback, repeated status→label maps, non-trivial `useMemo`/`useEffect`, async
  mutations, multi-step transitions. Those are the red flags → move to a hook/lib.
- `PascalCase.tsx` only — **no `.ts`** files. Top-level folders are *product
  areas*, never UI shapes (`modals/`, `sidebar/`, `shared/` are banned). Domain =
  "what area," surface = "where it renders," role = "what part."

### `pages/**` (Desktop/Web) · `navigation/**` (Mobile)
- Thin route entrypoints: read params/navigation state, call a page hook, render
  a screen component. No product visuals, access, or orchestration.

### `hooks/access/<system>/**`
- React Query/mutation wrappers. **Owns** query keys (`query-keys.ts` beside the
  hook), `useQuery`/`useMutation`, invalidation, retry, request telemetry.
- A Cloud endpoint wrapped with `useQuery` lives here **even if** the resource is
  product-specific. No product workflow branching, no JSX.

### `hooks/ui/**` (generic) · `hooks/<domain>/ui/**` (product)
- Generic UI mechanics with **no product concepts** (`useClickOutside`,
  `useElementSize`, `useKeyboardShortcut`). Product `ui/` is for mechanics that
  need product vocabulary. Mechanism, not meaning (meaning is a workflow).

### `hooks/<domain>/derived/**`
- Read stores/providers/access → return **UI-ready state**.
- **Never** write, fetch, invalidate, navigate, emit telemetry, or return
  mutating callbacks. If the component needs actions too, compose with a workflow
  hook behind a facade.

### `hooks/<domain>/workflows/**`
- User-action callbacks. Gather stores + access + **capabilities**; return
  callbacks. Call `lib/domain` for pure decisions, `lib/workflows` for sequences.
- **Never** construct raw clients, hit raw endpoints, define query keys,
  hand-edit cache shape, or bury large reusable algorithms.
- Keep one short intent inline; extract a `lib/workflows` runner only when the
  sequence earns it (ordering/branching/rollback/retry/testability).

### `hooks/<domain>/lifecycle/**`
- Mounted background behavior: streams, dispatchers, polling, subscriptions,
  bootstrap, reconciliation, persistence.
- **Must clean up every** timer/listener/observer/handle it creates. Valid
  `useEffect` ownership only (SSE/IPC/DOM subscriptions, timers, one-time init,
  external-event reconciliation) — never data-fetching (use Query) or deriving
  state from state.

### `hooks/<domain>/cache/**`
- Rare: a **product-composed** React Query cache combining multiple
  external/local sources into one product-owned model. A single external resource
  belongs in `hooks/access/**`, not here.

### `hooks/<domain>/facade/**`
- Thin composition wrapper that groups/renames values for a component. **No** new
  product behavior, raw access, query keys, or business branching.

### `lib/domain/<domain>/<subdomain>/**`
- Pure product logic: validation, normalization, status→label/tone/icon maps,
  projection/view models, reducers, **side-effect planners**. Synchronous,
  returns data.
- **Never** import React/JSX/hooks/stores/providers/query clients, DOM/RN/Tauri,
  SDK clients, or app code from another boundary. Name files for the rule, not the
  component (avoid `utils.ts`/`helpers.ts`).

### `lib/workflows/<domain>/**`
- Plain non-React product sequences with `(input, deps)`. Ordered sequences,
  branching on fetched data, retries, rollback, recovery.
- **Never** import React hooks/providers/stores/query clients, hidden singletons,
  or construct raw clients. Live capabilities arrive via `deps`; pure helpers are
  imported.

### `lib/infra/<concern>/**`
- Generic technical machinery with **no product vocabulary**: persistence,
  scheduling/timers, ids, batching, measurement, safe JSON. If it knows about
  sessions/workspaces/agents, it's not infra.

### `lib/access/<system>/**`
- App-local raw client setup, platform bridges, native wrappers, auth/storage
  integration. **Never** product workflow branching, UI state, stores, or shared
  package logic. The only place `@tauri-apps/api`/`invoke` and raw `client.GET`
  may appear (Tauri / Cloud respectively).

### `stores/<domain>/**`
- Zustand client-only state: selected ids, tabs/panels, drafts, runtime UI, local
  prefs. Always **selectors** (`useStore(s => s.x)`, `useShallow` for objects).
  Setters are single `set()` calls named as intents (`setActiveSessionId`).
- **Never** own API calls, invalidation, navigation, telemetry, toasts,
  persistence subscriptions, timers/streams, or cross-store workflows. Banned
  setter names: `load`/`sync`/`submit`/`refresh`/`bootstrap`. No derived values in
  stores.

### `providers/**`
- Scoped dependencies and subtree boundaries (query client, auth, telemetry,
  theme, runtime context). **Not** a general mutable store. Object/callback
  bundle values must be stable references.

### `config/**`
- Static constants: route ids, limits, option sets, ordering, default ids.
  Anything runtime/user/remote-dependent is **not** config — it's a hook/store/
  domain. No copy, no presentation mappings.

### `copy/**`
- Human-facing words: titles, labels, empty states, prompt templates. **No**
  React/stores/access. The mapping from *state → label/tone/icon* is **not copy**
  — it's a presentation map in `lib/domain/**/presentation.ts`.

### `styles/**` · `index.css`
- App-local style entrypoints, native token bridge, app-specific third-party CSS.
  Shared tokens/primitives belong in the `design`/`ui` packages, not here.

### Shared packages
- **`design`** — tokens + DOM css + React-Native-safe token values. No product
  concepts, no app code, no SDK.
- **`ui`** — the **single** DOM primitive system (Button, Dialog, Input, layout).
  *Hard invariant:* no DOM primitive defined anywhere else, even a renamed
  wrapper. Need a variant? Add it to `ui`.
- **`product-ui`** — presentational product components: **data in, callbacks
  out**; composes `ui` + `product-domain`. No SDK, access, stores, routes, Tauri,
  React Native.
- **`product-surfaces`** — the *connected* sibling: product presentation wired to
  **Cloud** (SDK React hooks + mutations). No app stores/routes/Tauri/local
  AnyHarness — pass those in as callbacks. Small by design.
- **`product-domain`** — pure shared decisions; the **Mobile sharing point**. No
  React/DOM/SDK clients/stores.

---

## The Compression

**Three questions place any file:** what substance · who owns the truth + who
needs it · lowest layer that can own it. **Access transports, stores remember,
domain decides, workflows sequence, infra plumbs, components render** — and hooks
are the *only* place those mix. Pure code is imported; live code is injected.
That single split, plus one-way dependencies, is the whole architecture.
