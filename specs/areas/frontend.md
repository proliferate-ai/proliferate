# Frontend Standards

## Scope

These standards apply to all frontend app logic and shared frontend packages:

- `apps/desktop/src/**`
- `apps/web/src/**`
- `apps/mobile/src/**`
- `apps/packages/design/**`
- `apps/packages/product-client/**`

ProductClient and Mobile use the layered folder logic below. Desktop and Web
are thin hosts: Desktop keeps Tauri and local-runtime adapters, Web keeps
browser adapters, and both mount the connected product owned by ProductClient.

## Launch configuration authority

Every pre-launch surface reads the selected target's
`HarnessLaunchOptionsResponse` and may only decorate exact keys. It must not
import static executable membership, seed missing values, filter unknown IDs,
or apply a first-model fallback. When the response carries a `modelControls`
row for the selected model, that exact row replaces the flat control statement;
a present empty row means no controls. Pickers submit the raw `modelId` plus
one `controlValues` entry for each selected rendered control and discard stale
control selections when the model changes.

Once a session exists, all model/control rendering and mutation reads that
session's `SessionLiveConfigSnapshot` only. Target launch options and catalog
state may not add to, remove from, or invalidate active-session choices.
Mobile keeps native navigation, native styling, and React Native UI while
sharing only concrete ProductClient domain modules.

## Goal

The frontend is organized into distinct folders and subfolders for UI, state,
long-lived client state, access, reusable product logic, workflows, providers,
and shared packages.

The explicit goals are:

- make it predictable where UI, state, logic, access, and shared code live
- make complicated product work legible, decomposed, and reviewable
- make it easy to build broadly without re-learning the app structure per app

A file path should tell a developer what kind of code is allowed there before
they open the file. If understanding a feature requires following imports
through unrelated layers, the structure is wrong.

## Target Shape

The layered product tree is relative to ProductClient or a native app source
root. Desktop and Web are thin hosts and keep only bootstrap plus their genuine
native/browser adapters:

- `apps/packages/product-client/src/`
- `apps/mobile/src/`

ProductClient and Mobile start from this shape and omit folders they do not
need. A host does not recreate this tree around the shared product.

```text
<app>/src/
  App.tsx
  main.tsx

  assets/

  components/
    <domain>/
      <surface>/
        <role>/

  config/
  copy/

  hooks/
    access/
      <external-system>/
    ui/
    <domain>/
      derived/
      workflows/
      lifecycle/
      ui/
      cache/
      facade/

  lib/
    access/
      <external-system>/
    domain/
      <domain>/
        <subdomain>/
    workflows/
      <domain>/
    infra/
      <technical-concern>/

  navigation/
  pages/
  providers/

  stores/
    <domain>/

  styles/
  index.css
```

Shared package shape:

```text
apps/packages/
  design/
    src/
      tokens.ts
      css/product.css
      react-native.ts

  product-client/
    src/
      domain/
        <domain>/
      primitives/
        patterns/
        icons/
        utils/
        overlays/
      components/
      hooks/
      lib/
      pages/
      providers/
      stores/
```

Platform notes:

- ProductClient owns the connected Desktop/Web access hooks, including
  `hooks/access/{anyharness,cloud,tauri}/**`, plus its shared Cloud and
  AnyHarness raw helpers. Its Tauri hooks call the typed Desktop bridge; they do
  not import Tauri.
- Desktop owns raw `lib/access/tauri/**`, local-runtime/native bridge
  implementation, host authentication, and vendor bootstrap. Web owns browser
  authentication, storage, links, telemetry, and Cloud-client construction.
  Neither host rebuilds ProductClient controllers or presentation locally.
- Mobile uses Cloud/native access, native navigation, React Native components,
  `design/react-native`, and concrete
  `@proliferate/product-client/internal/domain/<file>` modules. It never imports
  ProductClient's package root, DOM primitives, components, hooks, stores, CSS,
  or host code.

## What Goes Where

Use the lowest layer that can own the logic cleanly.

| Area | Path | Owns | Must Not Own | Canon |
| --- | --- | --- | --- | --- |
| App entry | `<app>/src/App.tsx`, `<app>/src/main.tsx` | App bootstrap, provider composition, root shell mounting. | Product workflows, reusable rules, remote cache shape. | This doc |
| Pages | `<app>/src/pages/**` | Desktop/Web route entrypoints: params, navigation state, page-level screen render. | Product visuals, access details, heavy orchestration. | This doc |
| Navigation | `<app>/src/navigation/**` | Mobile navigation model and route typing. | Product business logic or remote access. | This doc |
| Components | `<app>/src/components/<domain>/<surface>/<role>/**` | App-local product UI. Components render, call hooks, and forward callbacks. | Raw access, query invalidation, multi-step workflows, reusable product rules. | [components.md](frontend.md) |
| Access hooks | `<app>/src/hooks/access/<system>/**` | React Query/mutation wrappers, query keys, invalidation, retry policy, UI-safe access state. | Product workflow branching or JSX. | [hooks.md](frontend.md), [access.md](frontend.md), [state.md](frontend.md) |
| Generic UI hooks | `<app>/src/hooks/ui/<mechanic>/**` | Generic UI mechanics: keyboard, pointer, layout, measurement. | Product concepts. | [hooks.md](frontend.md) |
| Derived hooks | `<app>/src/hooks/<domain>/derived/**` | UI-ready state computed from stores, providers, and queries. | Writes, effects, access construction, navigation, telemetry. | [hooks.md](frontend.md) |
| Workflow hooks | `<app>/src/hooks/<domain>/workflows/**` | User-action callbacks and React-facing orchestration. | Large algorithms, raw clients, query key definitions. | [hooks.md](frontend.md) |
| Lifecycle hooks | `<app>/src/hooks/<domain>/lifecycle/**` | Mounted background behavior: streams, dispatchers, polling, reconciliation, persistence bootstrap. | Render logic or click-driven branching. | [hooks.md](frontend.md) |
| Product UI hooks | `<app>/src/hooks/<domain>/ui/**` | Product-specific UI mechanics. | Generic UI mechanics or product workflows. | [hooks.md](frontend.md) |
| Product cache hooks | `<app>/src/hooks/<domain>/cache/**` | Product-composed caches combining multiple external/local sources. | Simple one-resource external queries. | [hooks.md](frontend.md), [state.md](frontend.md) |
| Facade hooks | `<app>/src/hooks/<domain>/facade/**` | Thin composition wrappers that simplify a component API. | New product behavior or business branching. | [hooks.md](frontend.md) |
| Raw access | `<app>/src/lib/access/<system>/**` | App-local raw client setup, platform bridges, native wrappers, auth/storage integration. | Product UI state, product branching, shared package logic. | [access.md](frontend.md) |
| App product rules | `<app>/src/lib/domain/<domain>/<subdomain>/**` | Pure app-local product rules. | React, stores, query clients, access helpers, platform APIs. | [lib.md](frontend.md) |
| App workflows | `<app>/src/lib/workflows/<domain>/**` | Non-React product sequences with dependencies passed in. | React hooks, hidden singletons, raw endpoint construction. | [lib.md](frontend.md) |
| Infra | `<app>/src/lib/infra/<technical-concern>/**` | Generic technical machinery: persistence, scheduling, ids, batching, measurement. | Product-domain behavior. | [lib.md](frontend.md) |
| Providers | `<app>/src/providers/**` | Scoped dependencies and app/subtree boundaries. | General mutable UI state. | [state.md](frontend.md) |
| Stores | `<app>/src/stores/<domain>/**` | Shared client-only state: selected ids, drafts, panels, local UI preferences. | Remote caches, APIs, navigation, telemetry, multi-store orchestration. | [state.md](frontend.md) |
| Config | `<app>/src/config/**` | Static constants, limits, option sets, default ids, ordering. | Copy, presentation mappings, runtime state. | [config.md](frontend.md) |
| Copy | `<app>/src/copy/**` | Authored user-facing copy and prompt/content strings. | Logic, access, status-to-style mappings. | [copy.md](frontend.md) |
| Styling | `<app>/src/styles/**`, `<app>/src/index.css` | App-local style entrypoints, native token bridge, app-specific third-party CSS. | Shared tokens or reusable DOM primitives. | [styling.md](frontend.md) |
| Telemetry | `<app>/src/hooks/**`, `<app>/src/lib/**`, `<app>/src/providers/**` | Product event wiring and replay/privacy boundaries at the owning app layer. | Hidden tracking inside shared product UI. | [telemetry.md](frontend.md) |
| Design package | `apps/packages/design/**` | Shared tokens, DOM CSS entrypoint, React Native-safe token values. | Product concepts, app code, SDK clients. | [packages.md](frontend.md) |
| ProductClient domain | `apps/packages/product-client/src/domain/**` | Pure shared product rules, vocabulary, validation, projections, view models, and planners; the Mobile-safe sharing boundary. | React, DOM, React Native components, SDK clients, query clients, stores, access, primitives, or higher ProductClient layers. | [packages.md](frontend.md) |
| Product client package | `apps/packages/product-client/src/**` outside `domain/**` | Canonical Desktop/Web DOM primitives under `primitives/**`, shared product presentation, and the connected application: routes, components, layered access/workflow/domain hooks and logic, stores, providers, Cloud/gateway/AnyHarness orchestration, and the typed host boundary. | Either host (`apps/desktop/**`, `apps/web/**`), `@tauri-apps/**`, raw Tauri `invoke`, Desktop-relative `@/` aliases, React Native, or product/SDK/query dependencies from the nested primitives subtree. | [packages.md](frontend.md), [web-desktop-unification/README.md](../systems/desktop-host/web-desktop-unification.md) |

## Read Order

Always start with this file. Then read the focused guide or package doc for the
layer you are changing:

- [components.md](frontend.md)
- [hooks.md](frontend.md)
- [state.md](frontend.md)
- [lib.md](frontend.md)
- [access.md](frontend.md)
- [config.md](frontend.md)
- [copy.md](frontend.md)
- [styling.md](frontend.md)
- [telemetry.md](frontend.md)
- [packages.md](frontend.md)

## Hard Rules

- Keep imports direct and concrete. Do not add barrel files or convenience
  re-export modules.
- Use `@/` imports for app-root paths in apps where the alias is configured.
- `components/**` is `.tsx` only.
- `hooks/**`, `lib/**`, `stores/**`, `config/**`, `copy/**`, and
  `providers/**` are `.ts` only unless a file must render JSX.
- Pages are route entrypoints only: read params/navigation state, call
  page-level hooks, and render a screen component.
- Product hook domains use responsibility folders. Hook files should not sit
  directly under `hooks/<domain>/`.
- Components render. Hooks own React behavior. Stores hold shared client-only
  state. `lib/domain` holds app-local or connected-client rules;
  `product-client/src/domain/**` holds pure rules shared with Mobile.
- ProductClient code uses `apps/packages/product-client/src/primitives/**` for
  DOM primitives. Desktop and Web mount product UI through ProductClient's
  public host boundary and do not import its internal primitives directly.
  Existing explicitly named internal host-assembly/auth seams remain narrow;
  Mobile's separate domain-only restriction does not apply to those hosts.
- Do not define DOM primitive components outside
  `apps/packages/product-client/src/primitives/**`. This
  includes differently named local wrappers around buttons, inputs, dialogs,
  menus, tabs, tooltips, badges, layout shells, or similar reusable controls.
- Desktop and Web share presentational product components through
  ProductClient, which owns them alongside connected Cloud surfaces using its
  standard component, access-hook, workflow-hook, and domain layers.
- Mobile shares product rules through concrete ProductClient
  `internal/domain/<file>` imports and renders native UI in the app.
- Preserve current UI and behavior unless an explicit behavior change is
  requested.
- Delete dead code when replacing an implementation.
- Do not create empty folder trees or speculative abstractions.
- Avoid god modules and god stores. Prefer splitting before roughly 400 lines.
  Files at 600+ lines need a strong reason to stay whole. Mixed ownership
  should be split even below those thresholds.
- Colocate types with the code that owns them. Generated API types live with
  the generated client. App-defined domain models live with their owning
  domain logic. Store types live with their store.

## Dependency Direction

App dependency direction:

```text
components -> hooks
hooks -> hooks/access -> lib/access -> external SDK/platform
hooks -> lib/workflows -> lib/domain/lib/infra
hooks -> stores/providers
```

Stores are read by hooks. `lib/**` files do not call hooks or read stores
directly. Product workflows receive access calls, store setters, navigation,
telemetry, and cache callbacks through dependency arguments.

Shared package dependency direction:

```text
desktop/web
  -> product-client public host entries
  -> retained explicit product-client/internal/* host-adapter seams
  -> product-client/internal/domain/<file> when a host adapter needs a pure rule

mobile
  -> product-client/internal/domain/<file>
  -> design/react-native

product-client connected layers
  -> design
  -> product-client/src/domain
  -> product-client/src/primitives
```

ProductClient's `domain/**` subtree is pure. It does not import React, DOM,
React Native, SDK clients, access helpers, stores, query clients, primitives, or
higher ProductClient layers. ProductClient's connected tier owns both
presentational DOM UI and connected behavior, but Cloud SDK React hooks belong
under `hooks/access/cloud/**`; components and product workflow hooks consume
those access seams rather than importing query hooks directly. ProductClient
code imports the nested owner through `#product/domain/<file>`; host and Mobile
code use the concrete package-internal form above.

Within ProductClient, `primitives/**` remains a lower, DOM-safe component
library. It may import `design`, React, DOM-safe libraries, and other files in
the same primitives subtree; it must not import `#product/domain/*`, SDK/query
clients, host code, or any higher ProductClient layer.

## CI-Enforced Repo Shape

Frontend ownership boundaries are enforced by
`scripts/check_frontend_boundaries.py` in CI. The repo-shape job should enforce
the ownership rules in this document.

React Query cache shape is owned by access hooks by default. The only
product-composition exception is a cache under
`hooks/<domain>/cache/**`; ordinary workflow, lifecycle, derived, and component
files should call access/cache callbacks instead of importing `useQueryClient`
or hand-editing query keys.

## Change Discipline

- Keep ownership boundaries intact before introducing new abstractions.
- Do not leave duplicate code paths behind.
- Do not create one-file folders or empty target trees to satisfy a diagram.
- Prefer one bounded product area per PR.
- Keep public hook/component APIs stable unless the task explicitly changes
  callsites.
- When splitting a file, preserve behavior first; improve behavior separately.
- Use focused tests around moved domain/workflow logic when the logic is
  meaningful or risky.

> [!note]
> This is the frontend area doc: package layout, state, hooks, styling, telemetry, plus the generated SDKs. Stitched sections below, one per former owner doc:
> `mental-model.md` → [Frontend Mental Model](#frontend-mental-model)
> `architecture.md` → [Frontend Architecture](#frontend-architecture)
> `packages.md` → [Frontend Packages](#frontend-packages)
> `components.md` → [Frontend Components](#frontend-components)
> `state.md` → [Frontend State](#frontend-state)
> `hooks.md` → [Frontend Hooks](#frontend-hooks)
> `lib.md` → [Frontend Lib](#frontend-lib)
> `config.md` → [Frontend Config](#frontend-config)
> `copy.md` → [Frontend Copy](#frontend-copy)
> `styling.md` → [Frontend Styling](#frontend-styling)
> `telemetry.md` → [Frontend Telemetry Standards](#frontend-telemetry-standards)
> `access.md` → [Frontend Access Boundaries](#frontend-access-boundaries)
> `sdk.md` → [SDK Structure](#sdk-structure)

---

# Frontend Mental Model

## The Core Idea

Three rules generate the entire structure. Everything else is a consequence.

1. **Lowest layer that can own it cleanly.** Push logic down: component -> hook
   -> `lib`. Never solve in a component what a hook can own, or in a hook what a
   plain function can own.
2. **A path tells you what is allowed before you open the file.** If
   understanding a feature means chasing imports through unrelated layers, the
   structure is wrong.
3. **Dependency direction is one-way.**

   ```text
   components -> hooks -> hooks/access -> lib/access -> SDK/platform
                      -> lib/workflows -> lib/domain / lib/infra
                      -> stores / providers
   ```

   `lib/**` never calls hooks or reads stores. Packages never import app code.

The corollary that makes placement easy: anything **pure** is reachable by
`import`; anything **live** (stores, access, effects) must be **handed in** as a
dependency. That single split decides where most code goes.

## The Four Substances

Every file is one of four things. Hooks are the only layer allowed to mix them.

| Substance | What it is | Lives in |
| --- | --- | --- |
| **State** | memory | `useState`, `stores/**`, React Query, `providers/**` |
| **Access** | transport to systems | `hooks/access/**`, `lib/access/**`, SDK packages |
| **Work** | logic | `lib/domain/**`, `lib/workflows/**`, `lib/infra/**`, shared `product-client/src/domain/**` |
| **Composition** | the glue | `hooks/**`, `components/**` |

## State: Place By Source Of Truth

The axis is not "external vs product." Remote data is also product data. The
question is **who owns the truth**.

- **A system owns it** (Cloud, AnyHarness, native) -> **remote state** ->
  TanStack Query, reached only through the access layer. Do not mirror it into a
  store; the query cache is the cache.
- **The client owns it** -> **client-only state** -> smallest owner that works:
  - **Local** (`useState`): one subtree. Lift only when shared; drilling one or
    two levels is fine and preferred over a store.
  - **Store** (Zustand, `stores/<domain>/**`): shared/cross-screen facts -
    selected ids, tabs, drafts, runtime UI. Setters are single `set()` calls
    named as intents (`setActiveSessionId`), never `load`/`sync`/`submit`.
  - **Provider** (`providers/**`): scoped *dependencies* and subtree boundaries
    (query client, auth, theme, runtime context), not mutable data.

Two boundary laws: derived values never live in a store (use a `derived` hook),
and persistence never lives in the store file (a `lifecycle` hook owns the
disk/store bridge - load once, subscribe-and-write, tear down).

## Access: A Small, Fixed Set Of Addresses

Three external systems, two stages each. You never construct a client elsewhere.

| System | Raw transport (no React) | React-facing (query/mutation) |
| --- | --- | --- |
| Cloud | `@proliferate/cloud-sdk`, `lib/access/cloud/**` | `@proliferate/cloud-sdk-react`, `hooks/access/cloud/**` |
| AnyHarness | `@anyharness/sdk` | `@anyharness/sdk-react`, `hooks/access/anyharness/**` |
| Tauri | `lib/access/tauri/**` (only place `invoke` is allowed) | `hooks/access/tauri/**` |

Query keys live beside the access hook that owns the resource, never in
`lib/access` and never in a product hook folder. CI enforces that raw client
verbs stay under `lib/access/cloud/**` and that `useQueryClient` stays out of
product hooks.

## Work: Decide, Sequence, Plumb

Three stages of pure work, none of which touch React.

| Stage | Address | Signature | Owns |
| --- | --- | --- | --- |
| **Domain** | `lib/domain/**`; shared `product-client/src/domain/**` | `(data) -> decision` | validation, projections, view models, presentation maps, reducers, side-effect *planners* |
| **Workflow** | `lib/workflows/**` | `async (input, deps)` | ordered sequences, branching on fetched data, retries, rollback, recovery |
| **Infra** | `lib/infra/**` | generic fn | persistence, scheduling, ids, batching, measurement |

The `(input, deps)` contract is the heart of the system. **`input`** is values
that change per call. **`deps`** is live capabilities handed in: access calls,
store setters, cache invalidation, navigation, toasts, telemetry, clocks, ids.
Pure helpers and constants are imported directly, never passed as deps. A fat
`EverythingDeps` type means the boundary is drawn too wide.

The highest-leverage pattern is the **side-effect planner**: a pure
`lib/domain` function that decides *what effects should happen* and returns a
typed plan, executing nothing. The executor lives in a hook. This turns the
hardest-to-test logic (effect orchestration) into a pure, tested function.

### When To Extract

These are two separate decisions, governed by different triggers:

- **Calling `lib/domain`** is ungated - reach for it for any pure decision, even
  a tiny one. Both hooks and `lib/workflows` call down into `lib/domain`;
  `lib/domain` calls nothing above it.
- **Extracting to `lib/workflows`** is gated on complexity - do it only when the
  sequence has ordering invariants, branching on fetched data, rollback,
  retries, multi-step recovery, or a real unit-test boundary. A short single
  intent stays inline in the workflow hook.

## Composition: Hook Types

Hooks own React behavior. Each type gathers a fixed set of substances and
returns a fixed kind of output.

| Type | Address | Gathers | Returns | Verb |
| --- | --- | --- | --- | --- |
| access | `hooks/access/<system>/**` | raw SDK/clients | query/mutation objects, keys, invalidation | wrap |
| derived | `hooks/<domain>/derived/**` | stores + providers + access *reads* | UI-ready state, no callbacks | read |
| workflow | `hooks/<domain>/workflows/**` | stores + access + *capabilities* | callbacks (user actions) | act |
| lifecycle | `hooks/<domain>/lifecycle/**` | streams, timers, subscriptions, plans | nothing - mounted effect, cleans up everything | run |
| ui | `hooks/ui/**`, `hooks/<domain>/ui/**` | refs, DOM events, measurement | UI mechanics | mechanic |
| cache | `hooks/<domain>/cache/**` | multiple sources | one product-composed cache | compose |
| facade | `hooks/<domain>/facade/**` | several hooks above | renamed/grouped bundle, no new behavior | bundle |

The one word that separates **derived** from **workflow** is *capabilities* -
the power to cause effects (toast, navigate, invalidate, mutate). Read-only
ingredients can only describe state (`derived`). Read + capabilities can also
cause actions (`workflow`).

Two composition recipes cover most work:

- **derived + workflow behind a facade** - a screen that must both show and do.
- **workflow hook -> `lib/workflows` runner -> `lib/domain` decision** - a
  fallible sequence. The hook gathers deps, the runner sequences, the domain
  function makes the hard branching call.

You cannot fully judge a workflow hook in isolation. The most common smell -
the same product rule decided in two places - is only visible by following the
usages. Always ask: is this decision made anywhere else?

## Render And Content Layers

- **`components/**`** render only: render, call hooks, forward callbacks, own
  subtree presentation state. Anything else is a red flag (raw access, query
  invalidation, multiple store setters in one callback, repeated status maps,
  non-trivial effects, async mutations). Shape:
  `components/<domain>/<surface>/<role>/Component.tsx`, `PascalCase.tsx` only,
  no `.ts` files. Top-level folders are product areas, never UI shapes.
- **`pages/**`** (Desktop/Web) and **`navigation/**`** (Mobile) are thin route
  entrypoints: read params/navigation state, call a page hook, render a screen.
- **`config/**`** holds static constants (route ids, limits, option sets,
  ordering). Anything runtime-dependent is not config.
- **`copy/**`** holds human-facing words. The mapping from product state to
  label/tone/icon is *not* copy - it is a presentation map in
  `lib/domain/**/presentation.ts` (or ProductClient `src/domain/**` if shared
  with Mobile).
- **Telemetry** is split at the host boundary while retaining one product tree.
  ProductClient's `TelemetryProvider`, hooks, and `lib/domain/telemetry/**`
  catalog own product event meaning. They emit through `ProductHost.telemetry`.
  Desktop implements that transport under `lib/integrations/telemetry/**`; Web
  implements it under `browser/telemetry/**`; Mobile keeps its native provider
  and integration. Components do not import telemetry. Payloads stay
  low-cardinality and carry no prompts, paths, repo names, or secrets.

## Shared Packages And Nested Owners

One connected app over two nested lower layers plus the Design package. See
[packages.md](frontend.md) for the authoritative table.

```text
product-client/src/
  domain/       pure shared rules (the Mobile-safe sharing point)
  primitives/   Desktop/Web DOM library
  components/ · hooks/ · stores/ · providers/ · lib/
                connected shared Desktop/Web client

design/         tokens + CSS; React Native-safe token values
```

- **design** - shared design *values*, not just css: tokens, DOM css, and
  React-Native-safe token values. Mobile consumes the tokens, not the css.
- **product-client** - the shared Desktop/Web product. Components own product
  presentation, access hooks own SDK/query state, workflow hooks sequence
  actions, native capability enters through the typed host contract, and its
  nested `primitives/**` subtree owns the single DOM primitive system. That
  subtree may depend only on `design`, React/DOM-safe libraries, and itself.
- **product-client `src/domain/**`** - pure shared decisions, the twin of app or
  connected `lib/domain`, and the primary sharing point for Mobile. No React,
  DOM, SDK clients, stores, primitives, or higher ProductClient layers.

Platform matrix: Desktop/Web mount ProductClient and may use concrete domain
subpaths from host adapters. Mobile uses only `design` React Native tokens, SDK
packages, and concrete
`@proliferate/product-client/internal/domain/<file>` modules—never the package
root or its DOM layers.

## The Placement Algorithm

Three questions, in order, give every file exactly one home.

1. **What substance is this?** state / access / pure work / render / content.
2. **What is the source of truth, and who else needs it?** Places state and
   decides whether a decision is shared with Mobile (`product-client/src/domain`)
   or app/connected-client local (`lib/domain`).
3. **What is the lowest layer that can own it cleanly?** Places everything else.

## Debugging: Symptom To Root Concept

Most bugs map to one concept. Reach for it before reading more code.

| Symptom | Root concept |
| --- | --- |
| Effect loops forever | reference stability / dependency arrays |
| Stale data, or update did not show | query keys and invalidation |
| Re-renders far too often | Zustand selectors / `useShallow` / memoization |
| Works but cannot be unit-tested | logic trapped in a hook - extract to `lib` with deps |
| Type will not narrow / is `unknown` | discriminated unions and narrowing |
| Intermittent, order-dependent failure | race condition - missing cancel/in-flight guard |
| Did not react to a server event | stream/subscription lifecycle |
| Import error / circular dep | module graph and package boundaries |
| Unsure which folder | substance + source-of-truth + domain vocabulary |

## What To Grok First

The structure is essentially **React + TanStack Query + Zustand, disciplined by
TypeScript unions and dependency injection, over a Tauri/SSE substrate**. The
four forces that carry most organizing and debugging decisions:

1. **React render/effect model and reference stability** - dependency arrays,
   `useCallback`/`useMemo`, why object/array literals are new each render.
2. **TanStack Query** - query keys as cache identity, invalidation vs refetch vs
   `setQueryData`, `enabled`, `mutateAsync`.
3. **Zustand** - selectors, `useShallow`, `getState()` vs subscribed reads,
   `.subscribe()` as the observer seam.
4. **TypeScript discriminated unions and generics** - the language the planners,
   workflow steps, and `(input, deps)` contracts are written in.

Then: async/concurrency (races, cancellation, `Promise.allSettled`), dependency
injection and purity, event-driven/streaming patterns, the module/monorepo
graph, and the product domain vocabulary (sessions, workspaces, runtimes,
agents, mobility). Grok the four forces and the folder structure stops being
rules to memorize and becomes the obvious consequence of them.

---

# Frontend Architecture

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
- **Build broadly without re-learning** — the same folder logic in
  ProductClient and native product roots, with Desktop/Web reduced to thin
  platform hosts.

**Scope:** `apps/desktop/src/**`, `apps/web/src/**`, `apps/mobile/src/**`, and
`apps/packages/**`. ProductClient and Mobile use the layered folder logic;
Desktop and Web are thin hosts that keep only genuine platform differences
(Tauri + local AnyHarness on Desktop and browser adapters on Web). Mobile owns
native navigation and React Native UI and imports only concrete ProductClient
domain modules.

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
| **Work** | logic | `lib/domain/**`, `lib/workflows/**`, `lib/infra/**`, shared `product-client/src/domain/**` |
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

Three systems × two stages. Construction and React-facing ownership stay in
the named boundary, even when the two stages cross the host contract.

| System | Raw transport / host implementation | React-facing ProductClient owner |
| --- | --- | --- |
| Cloud | `@proliferate/cloud-sdk`, ProductClient `lib/access/cloud/**`; each host constructs its authenticated client | `@proliferate/cloud-sdk-react`, ProductClient `hooks/access/cloud/**` |
| AnyHarness | `@anyharness/sdk`, ProductClient `lib/access/anyharness/**`; Desktop supplies local-runtime capability through `DesktopBridge` | `@anyharness/sdk-react`, ProductClient `hooks/access/anyharness/**` |
| Tauri | Desktop `lib/access/tauri/**` (the only raw `invoke` owner) | ProductClient `hooks/access/tauri/**`, using the typed bridge rather than Tauri imports |

Query keys live beside the access hook that owns the resource — never in
`lib/access`, never in a product folder. CI enforces raw client verbs stay under
`lib/access/cloud/**` and `useQueryClient` stays out of product hooks.

### Work — decide / sequence / plumb

| Stage | Address | Signature | Owns |
| --- | --- | --- | --- |
| **Domain** | `lib/domain/**`; shared `product-client/src/domain/**` | `(data) → decision` | validation, projections, view models, presentation maps, reducers, side-effect *planners* |
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

### The folder tree (per product source root)

ProductClient and Mobile use this layered shape. Desktop and Web are thin hosts
that keep only bootstrap and genuine native/browser adapters.

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

### Shared package — connected app and nested foundations

```text
product-client/src/
  domain/       pure shared rules (Mobile-safe)
  primitives/   Desktop/Web DOM library
  components/ · hooks/ · stores/ · providers/ · lib/
                connected shared Desktop/Web client

design/         tokens + CSS; react-native token values
```

Connected ProductClient code imports pure rules through
`#product/domain/<file>` and primitives through concrete `#product/primitives/*`
paths. Desktop and Web mount public ProductClient host entries; host adapters may
also use concrete `@proliferate/product-client/internal/domain/<file>` modules.
They retain other explicitly named internal seams required by host assembly and
authentication; those paths are not Mobile-safe and are not a general internal
import license.
Mobile uses only those concrete domain modules plus `design/react-native` and
SDK packages—never the package root, DOM primitives, components, hooks, stores,
CSS, or host code.

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
  Shared tokens and primitives belong in `design` and ProductClient's nested
  `primitives/**` owner, not here.

### Shared packages
- **`design`** — tokens + DOM css + React-Native-safe token values. No product
  concepts, no app code, no SDK.
- **`product-client`** — the shared Desktop/Web product: components own product
  presentation, access hooks own SDK/query state, workflow hooks sequence
  actions, pure projections live in `lib/domain`, and `primitives/**` owns the
  single DOM primitive system. Native host capabilities arrive through the
  typed host contract. The nested primitives subtree remains DOM-safe and
  cannot import product or connected-client layers.
- **`product-client/src/domain/**`** — pure shared decisions; the **Mobile
  sharing point**. It is distinct from connected `src/lib/domain/**` and imports
  no React, DOM, SDK clients, stores, primitives, or higher ProductClient
  layers.

---

## The Compression

**Three questions place any file:** what substance · who owns the truth + who
needs it · lowest layer that can own it. **Access transports, stores remember,
domain decides, workflows sequence, infra plumbs, components render** — and hooks
are the *only* place those mix. Pure code is imported; live code is injected.
That single split, plus one-way dependencies, is the whole architecture.

---

# Frontend Packages

Scope: `apps/packages/{design,product-client}/**`

**Packages are the shared product tier, not a second frontend taxonomy.** Most
are 1-1 with an app-local layer. `product-client` is the deliberate exception:
it is the connected Desktop/Web application shared by two thin hosts.

| Package | = the shared tier of |
|---|---|
| `design` | app `styles/` + tokens |
| `product-client` | pure cross-client domain rules plus the shared Desktop/Web product (primitives + components + pages + hooks + stores + providers) |

## The two governing rules

Everything else derives from these:

1. **Future-facing.** When adding new code, consider whether multiple clients
   need it. Promote a pure rule into ProductClient's nested `src/domain/**`
   owner **only when ≥2 clients need the same thing.** Shared ownership is
   never the default home.
2. **Platform — Mobile is DOM-free.** Mobile may import **only concrete
   `@proliferate/product-client/internal/domain/<file>` modules** plus
   `design/react-native` and SDK packages. It must never import ProductClient's
   root, another internal subtree, or its DOM primitives.

ProductClient owns shared Desktop/Web components alongside routes, stores,
hooks, and Cloud/AnyHarness wiring, while raw host implementation such as Tauri,
browser auth transport, and vendor bootstrap stays in the thin hosts.

## Package map

| Owner | Shared tier of | Owns | May import | Must NOT import |
|---|---|---|---|---|
| `design` | styles/tokens | shared tokens, DOM CSS, RN-safe token values | token/build tooling | product concepts, app code, SDK clients, hooks, stores |
| `product-client/src/domain/**` | cross-client `lib/domain` | pure shared product rules, vocab, validation, projections, view models, planners | relative pure utilities inside the domain root; Cloud SDK contract types; AnyHarness contract types plus the four allowlisted pure runtime helpers named below | React, DOM, RN components, SDK clients or other runtime SDK values, query clients, stores, app code, raw access, primitives, higher ProductClient layers |
| `product-client/src/primitives/**` | Desktop/Web primitive layer | canonical DOM primitives and generic patterns | `design`, React/DOM-safe libraries, itself | domain rules, SDK/query clients, hooks, stores, host code, higher ProductClient layers, RN |
| connected `product-client/src/**` | shared Desktop/Web product | shared product presentation, routes, pages, layered access/workflow/domain hooks and logic, stores, providers, Cloud/gateway/AnyHarness orchestration, and the typed host boundary | `#product/domain/*`, `#product/primitives/*`, `design`, Cloud/AnyHarness SDKs, React/router/query | Desktop/Web app internals, `@tauri-apps/**`, raw `invoke`, host auth transport, vendor telemetry implementations, RN, primitives outside `src/primitives/**` |

## Shape

```text
apps/packages/
  design/src/        tokens.ts · css/{product.css,desktop.css} · react-native.ts
  product-client/src/
    ProductClient.tsx
    domain/<domain>/  # pure, Mobile-safe shared rules
    primitives/
      *.tsx              # root DOM primitives
      patterns/          # generic primitive compositions
      icons/             # concrete glyph modules; no aggregate barrel
      utils/ · overlays/ # DOM-safe primitive infrastructure
    app/ · pages/ · components/ · hooks/ · stores/ · providers/ · lib/
    host/                # ProductHost, DesktopBridge, ProductHostProvider
```

## Dependency direction

```text
desktop/web -> product-client connected tier -> design
                                           \----> src/domain
                                           \----> src/primitives
                                           \----> Cloud/AnyHarness SDKs

product-client/primitives -> design + React/DOM-safe libraries
product-client/domain     -> contract types + exact pure runtime helpers below
```

Mobile: `design/react-native` + SDK packages + concrete
`@proliferate/product-client/internal/domain/<file>` imports only. **Never** the
ProductClient root or another internal subtree.

## Per package

### `design`
The shared tier of app `styles/` + tokens. Owns serializable design values and generated CSS — tokens, DOM CSS, React Native-safe token values.

```text
design/src/tokens.ts · css/{product.css,desktop.css} · react-native.ts · dist/theme.css
```

Must not hold product copy, product status colors, route concepts, or component behavior. Imports token source + build tooling only — never React, app code, SDK clients, stores, providers, query clients, or product concepts.

### ProductClient `primitives/**`

The **single DOM primitive system** for the shared Desktop/Web product. It is a
nested lower layer inside ProductClient, not a second package.

```text
product-client/src/primitives/*.tsx
product-client/src/primitives/{patterns,icons,utils,overlays,__tests__}/**
```

**Hard invariant: no DOM primitive component may be defined outside `apps/packages/product-client/src/primitives/**`.** A primitive is any generic reusable control/shell/low-level building block — *including a differently-named wrapper* around a raw DOM control.

Primitives that belong here: `Button`/`IconButton`, `Input`/`Textarea`/`Label`/`Select`, `Checkbox`/`Switch`/radio, `Tabs`/segmented controls, `Menu`/`Popover`/`Tooltip`, `Dialog`/modal shells, badges/pills/separators/scroll-areas/layout shells.

#### Root files — the base tier

Root files hold Radix-backed base controls (`Dialog`, `AlertDialog`, `Popover`, `DropdownMenu`, `Sonner`, `Command`, plus the raw `checkbox-primitive`/`tooltip-primitive` pair) alongside low-level wrappers that compose them (`PopoverButton`, icon-button shells, and the `Checkbox`/`Tooltip` re-export shims). Every component is styled to the design contract via `design` tokens. `patterns/` holds compositions one level up (`ModalShell`, `ConfirmationDialog`, `CommandPalette`, and other multi-primitive assemblies).

- ProductClient code imports exact internal subpaths such as `#product/primitives/Dialog`; no barrels.
- `utils/class-names.ts` owns `cn()` and `utils/tw-merge.ts` owns the configured Tailwind merge wrapper.
- **New code imports the base primitive directly** when one exists for the need.

Two component families still ship a raw/wrapper pair under the same `primitives/` directory — `Checkbox` (`checkbox-primitive.tsx` + `Checkbox.tsx`) and `Tooltip` (`tooltip-primitive.tsx` + `Tooltip.tsx`) — because the wrapper's public name collided with the base primitive's. This overlap is **transitional, with the raw `-primitive` module as the survivor**: do not extend the wrapper further; add capability to the raw primitive and thin the wrapper.

Rules:
- Do **not** define primitives in `apps/desktop/src`, `apps/web/src`, or outside
  ProductClient's `src/primitives/**` subtree.
- Do **not** define a second button/input/dialog/menu/select/tabs primitive under another name, or restyle raw DOM controls at callsites to mimic one. *(Transitional exception: the `checkbox-primitive`/`tooltip-primitive` pairs above, resolving toward the raw module. No new pairs.)*
- Do **not** render raw `<button>`/`<input>`/`<label>`/`<select>`/`<textarea>` outside the primitives subtree.
- Need a new size/tone/density/icon-position/loading/destructive/layout mode? **Add the API to the owning primitive first.**
- Callsite classes may handle layout/spacing; the primitive owns color, border, radius, typography, focus, hover, disabled, and loading behavior.
- Mobile has a separate **native** component layer and does not import DOM primitives.

May import `design`, React, DOM-safe libraries, and files that resolve inside
`src/primitives/**`. Must not escape through relative, `#product/*`, or
internal ProductClient subpaths, or import `#product/domain/*`, Cloud/AnyHarness
SDKs, React Query, hooks, stores, host/Tauri code, app aliases, or React Native.
Patterns may depend on sibling primitive owners inside the same logical
subtree.

### ProductClient `domain/**`
The cross-client tier of `lib/domain` — same purity and shape (validation,
vocabulary, projections, view models, **pure planners**), promoted for reuse by
more than one client.

```text
product-client/src/domain/<domain>/**
```

This is **Mobile's primary sharing point**: if Mobile and Desktop/Web need the
same behavior, share the rule here and render it separately in native and DOM
UI. ProductClient-internal callers use `#product/domain/<file>`. Desktop, Web,
and Mobile use the concrete package subpath
`@proliferate/product-client/internal/domain/<file>`; no client may import a
domain barrel. The subtree may import `@proliferate/cloud-sdk` as contract types
only. From `@anyharness/sdk` it may import contract types plus exactly four pure
runtime helpers: `createTranscriptState`, `deriveCanonicalPlan`,
`parseToolBackgroundWork`, and `reduceEvents`. Every other SDK runtime value or
client is forbidden, as are React, DOM/RN components, app code, stores, query
clients, access helpers, primitives, and higher ProductClient layers. *Promote
when:* ≥2 clients need the same decision or view model.

### `product-client`
The shared connected Desktop/Web application, per
[`../codebase/systems/product/clients/web-desktop-unification/README.md`](../systems/desktop-host/web-desktop-unification.md).
Desktop is the baseline; Desktop and Web are thin hosts that each construct
one typed `ProductHost` and mount the same product through `ProductHostProvider`.
Like the other shared packages, it builds to `dist` and is consumed through
`dist` export-map subpaths.

```text
product-client/src/host/**   # ProductHost + DesktopBridge types, ProductHostProvider
```

It owns shared Desktop/Web product presentation and may depend in the correct
direction on `#product/domain/*`, `design`, and the Cloud/AnyHarness SDKs.
Connected surfaces use one ownership grid: components render, access hooks own
SDK React/query state, workflow hooks sequence actions, and `lib/domain` owns
pure projections.

Each thin host owns the infrastructure instances that mount the product: its
React root, router transport, Query client, Cloud-client construction/provider,
and `ProductHostProvider`. ProductClient owns product providers, routes, stores,
lifecycles, and Cloud/AnyHarness product composition. Its build and host builds
prove dynamic imports, generated inputs, CSS, fonts, assets, and both hosts.

It must **never** import either host (`apps/desktop/**`, `apps/web/**`), any
`@tauri-apps/**` package, raw Tauri `invoke`, or Desktop-relative `@/` aliases;
shared product code reaches native capability only through the optional
`host.desktop` bridge. Mobile stays outside ProductClient's connected/DOM tier,
but depends on the package for concrete `internal/domain/<file>` modules only.

Desktop and Web mount ProductClient through public host entries. Their existing
host assembly and authentication adapters also retain explicitly named
`internal/*` seams; this consolidation does not narrow or generalize those
paths. Mobile has no such exception: its only ProductClient source imports are
concrete `internal/domain/<file>` modules.

## Package rules

- Inside ProductClient, use concrete `#product/primitives/...` subpaths; **no barrels.**
- Package code must not import app code via `@/` or relative paths into an app, nor app stores/providers/routes/Tauri/AnyHarness wiring unless the map above allows it.
- Do not add generic `shared`/`common`/`types`/`utils` buckets outside the
  explicitly owned `primitives/utils/**` support tier. Name files for the
  rule, primitive, component, or surface they own.
- If sharing needs many app-specific branches, keep it app-local and extract
  only the pure rule into `product-client/src/domain/**`.
- Tests live with shared logic when it's meaningful or risky.

---

# Frontend Components

Components render UI. Hooks own React behavior, `lib/**` owns reusable logic,
and access layers own external systems.

This file owns the behavioral rules (what a component may do). The visual-vocabulary rules — the five jobs of UI code, the tier placement algorithm (primitives vs patterns vs domain patterns vs surfaces), area kits, the rule of two for promoting shapes into the library, and the UI-conformance review checklist — live in [DESIGN_SYSTEM.md § Component Library](../DESIGN_SYSTEM.md#component-library). Read that section before creating any component that renders something new.

## Ownership

- Components may render, call hooks, forward callbacks, and own local
  presentation state for their subtree.
- Components must not fetch, invalidate queries, construct clients, call raw
  Tauri/Cloud/AnyHarness helpers, coordinate multi-step workflows, or own
  reusable product rules.
- Product conditions reused across components belong in `lib/domain/**` or
  `apps/packages/product-client/src/domain/**` when shared with Mobile.
- A component callback that coordinates stores, queries, navigation, or remote
  mutations belongs in a workflow hook.

Red flags:

- raw Cloud, AnyHarness, MCP, or Tauri calls
- `queryClient.invalidateQueries` or direct query-key construction
- multiple store setters in one component callback
- repeated status-to-label/tone/icon maps
- non-trivial `useMemo` or `useEffect`
- async mutations, file parsing, product sorting/filtering, or multi-step state
  transitions

## Folder Shape

Organize app product components by domain, surface, then role:

```text
components/<domain>/<surface>/<role>/<Component>.tsx
```

Use fewer levels only when the domain is small. Domain answers "what product
area owns this?" Surface answers "where does this render?" Role answers "what
part of the surface is this?"

Rules:

- Top-level `components/<domain>/` folders are product areas, not UI shapes or
  transport boundaries.
- Avoid root buckets like `modals`, `panels`, `sidebar`, `topbar`, `shared`, or
  `common`.
- Single-file folders are usually noise unless the folder is the start of a
  cohesive surface or role.
- Pick one shape per parent. Do not mix many direct component files with nested
  role folders unless the direct files are surface entrypoints.
- When a flat component folder grows past roughly ten files, introduce
  surface/role folders before adding unrelated components.
- Component files use `PascalCase.tsx`.
- Do not put `.ts` files under `components/**`. Static metadata, copy, config,
  and pure presentation helpers belong in `config/**`, `copy/**`, or
  `lib/domain/**`.

## Shared UI

`apps/packages/product-client/src/primitives/**` is the only DOM primitive
layer.

Hard invariant: do not define DOM primitive components anywhere else.

A primitive component is any generic reusable control, shell, or low-level UI
building block: `Button`, `IconButton`, `Input`, `Textarea`, `Label`, `Select`,
`Checkbox`, `Switch`, `Tabs`, `Menu`, `Popover`, `Tooltip`, `Dialog`, `Modal`,
`Badge`, `Pill`, `Separator`, `ScrollArea`, layout shell, or a differently
named component that wraps/restyles the same raw DOM control.

New primitive definitions are forbidden in:

- `apps/desktop/src/**`
- `apps/web/src/**`
- `apps/packages/product-client/src/**` outside `primitives/**`

Primitive definitions outside
`apps/packages/product-client/src/primitives/**` violate this standard. Do
not add them, copy them, or create local variants beside them. Put the
primitive in ProductClient's primitives subtree, add the needed variant/prop
there, and update callsites to import it.

### `apps/packages/product-client/src/primitives`

- Owns base DOM controls and layout primitives: buttons, icon buttons, inputs,
  textareas, labels, selects, checkboxes, switches, tabs, menus, popovers,
  dialogs, tooltips, badges, separators, scroll areas, and layout shells.
- Must not import app code, SDK clients, stores, product hooks, access helpers,
  Tauri APIs, React Native, routes, or product concepts.
- May import `design`, React/DOM-safe libraries, and sibling owners that resolve
  inside the same primitives subtree. `patterns/**` may compose root primitives.
- Must expose variants/props for repeated visual treatments. Do not create a
  one-off restyled button/input/dialog at the callsite.
- Is the only place in DOM frontend code that should define the base visual
  contract for raw controls.

### ProductClient feature code, Desktop, and Web

- ProductClient feature code must use exact `#product/primitives/...` imports
  for base controls. Desktop and Web consume the public ProductClient surface
  and must not reach into internal primitive subpaths.
- Must not define or redefine primitive components, even with different names.
- Must not render raw `<button>`, `<input>`, `<label>`, `<select>`, or
  `<textarea>` outside ProductClient's primitives subtree.
- May pass layout/sizing classes when the primitive API allows it, but must not
  rebuild color, border, radius, typography, focus, disabled, or hover behavior
  at the callsite.
- If a needed primitive variant does not exist, add it to
  `apps/packages/product-client/src/primitives/**` and then consume it
  everywhere.

### `apps/packages/product-client`

- Owns shared Desktop/Web presentation and connected surfaces under its
  standard component, hook, and library roots.
- Components render and call ProductClient hooks; Cloud SDK React access
  belongs under `hooks/access/cloud/**`, never in components.
- Feature components may consume pure shared models through concrete
  `#product/domain/<file>` imports.
- Must use its nested `primitives/**` owner for base controls.
- Must not import Desktop/Web host internals, Tauri, or React Native.

### Mobile

- Renders native components under `apps/mobile/src/components/**`.
- May share concrete
  `@proliferate/product-client/internal/domain/<file>` view models and
  `apps/packages/design/src/react-native.ts` tokens.
- Must not import the ProductClient root, another internal subtree, or any DOM
  ProductClient component.

Within ProductClient, use concrete subpaths such as
`#product/primitives/Button` or
`#product/components/settings/panes/account/AccountSettingsPane`; do not add
barrels.

---

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
  live in `lib/domain/**`, or in `apps/packages/product-client/src/domain/**`
  when the same pure rule is shared with Mobile. Neither domain owner stores
  state.

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
product-client/hooks/access    # shared connected Desktop/Web resource access
```

- Do not copy refetchable server/runtime data into Zustand as a cache.
- Access hooks own query keys, queries, mutations, invalidation, cache shape,
  and retry policy.
- Product workflow hooks may request refresh/update through access-owned
  callbacks; they should not construct query keys or write cache objects
  directly.
- Generated response types or SDK types are the source of truth for remote
  transport shapes.
- ProductClient `src/domain/**` may project those transport shapes into
  serializable models, but it owns no Query cache, Zustand store, provider,
  hook, or persistence lifecycle.

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

---

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
- **Raw platform hooks stay in the owning app.** ProductClient may own a
  Desktop-only capability hook behind the typed `ProductHost.desktop` bridge,
  but that hook must not import Tauri or the Desktop app. DOM-subscription hooks
  do not exist on Mobile, and a genuinely cross-platform hook must not import a
  platform-specific capability hook.

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
hooks/access/anyharness/workspaces/use-workspace-bootstrap-cache.ts
hooks/access/cloud/integrations/query-keys.ts       # keys live beside the owner
hooks/access/cloud/integrations/use-integration-catalog.ts
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

- Raw Tauri/DOM/RN-native behavior is **platform-specific** and lives in the
  owning app. ProductClient may own bridge-backed Tauri capability hooks for
  its Desktop product behavior; they mount only when `host.desktop` exists and
  never import raw Tauri APIs.
- A **shared/cross-platform hook must be platform-neutral** — it must not import
  a platform-bound access hook. A Desktop-only ProductClient hook is explicitly
  capability-bound, not cross-platform.
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
- Query/mutation wrappers for external systems live in `hooks/access/**`, never
  in ProductClient's pure `src/domain/**` subtree.
- Another hook is only warranted when the extracted code owns React behavior.

## Placement & testing

- Raw external calls → `lib/access/**` or `hooks/access/**`.
- Pure product decisions → `lib/domain/**`, or
  `product-client/src/domain/**` when shared with Mobile.
- Real multi-step sequences → `lib/workflows/**`.
- **Test the pure `lib/workflows` function, not the rendered hook** — push testable logic into `lib` with `(input, deps)` so tests don't render; only render-test what genuinely owns React behavior. Focused tests live next to risky domain/workflow logic.

---

# Frontend Lib

`lib/**` is **non-component, non-React** logic. Hooks own React behavior; `lib` owns the logic underneath. **Nothing in `lib/**` imports React, hooks, stores, providers, or query clients** — hooks call `lib`, never the reverse.

## Axes — how to place anything in `lib`

Ask *what the code touches*:
- a **pure product decision or model** (no I/O) → `domain`
- a **multi-step product sequence** (touches the world only via injected deps) → `workflows`
- **raw access to your product's own backends/runtimes** → `access`
- a **third-party cross-cutting provider** (auth, analytics, error reporting) → `integrations`
- **generic technical machinery** with no product and no vendor → `infra`

Two discriminators: **purity** (`domain`/`workflows` are logic; `access`/`integrations`/`infra` are access layers) and **what external thing it touches** (*your backend* → access · *third-party provider* → integrations · *nothing external* → infra).

## Shape

```text
lib/
  domain/<domain>/<subdomain>/<rule>.ts
  workflows/<domain>/<workflow>.ts
  access/<system>/<helper>.ts
  integrations/<provider>/<file>.ts
  infra/<technical-concern>/<helper>.ts
```

## Imports / use (layer-wide)

- **No `lib/**` file imports React, hooks, stores, providers, or query clients.**
- `domain` is pure — imports only other `domain`/`infra` pure helpers.
- `workflows` reach the world **only through injected `deps`**.
- `access` / `integrations` may import SDK / platform / vendor clients.
- `infra` imports only low-level/generic libraries.

## The lib folders (index)

| Folder | Purpose | Touches | May import | Must NOT |
|---|---|---|---|---|
| **domain** | pure product logic for one app | nothing (data in → decision/model out) | other `domain` + `infra` pure helpers | React/hooks/stores/query, DOM/RN/Tauri, SDK clients, raw access |
| **workflows** | non-React product sequences | the world via injected `deps` | `domain` directly, `infra` | React hooks/stores/query, hidden singletons, raw endpoints/client construction |
| **access** | raw access to *your* backends/runtimes | Cloud SDK, AnyHarness, Tauri, browser | SDK clients, platform bridges | product workflow branching, UI state, stores, shared-package logic |
| **integrations** | third-party cross-cutting providers | auth provider, Sentry, PostHog, analytics | vendor SDKs | product workflow branching, core-backend access (→ `access`), React behavior |
| **infra** | generic technical machinery | nothing external or product | low-level/generic libs | any product vocabulary (chats/sessions/agents/…) |

## Per folder

### `lib/domain/**`
Pure product decisions and models for **one app or the connected Desktop/Web
client**. Keep them local first; promote a rule to
`apps/packages/product-client/src/domain/**` when Mobile and another client need
the same decision or view model.

**Owns:** validation/normalization · status labels, tones, icons, display metadata · workspace/session/chat projection (view) models · pure reducers · **pure side-effect planners**.

**Must not import:** React/JSX/hooks/stores/providers/query clients · DOM/RN/Tauri/platform APIs · SDK clients, raw access, or other-boundary app code.

**Shape:** `lib/domain/<domain>/<subdomain>/<rule>.ts` — named for the rule (`<rule>.ts`, `<thing>-model.ts`, `<thing>-reducer.ts`, `<thing>-effect-plan.ts`, `<thing>-presentation.ts`). No `utils.ts`/`helpers.ts`/broad `types.ts`.

**Side-effect planners.** A planner **decides what effects should happen and returns an explicit plan — it does not execute.** The executor lives in a workflow hook, lifecycle hook, or `lib/workflows`. Use when the *decision* is pure but the *effects* aren't (stream-refresh, toast, reconciliation decisions). This is the "decide here, execute there" split.

**Best practice:** if it needs I/O, a client, or a store, it isn't `domain` — it takes data in and returns data out.

### `lib/workflows/**`
Plain non-React product sequences a hook orchestrates; use when an action coordinates multiple deps and should be readable/testable **outside React**.

**Owns:** ordered sequences · branching across fetched/local data · retries, rollback, multi-step error recovery · app-local orchestration that must not call hooks.

**Must not import:** React hooks/providers/stores/query clients · hidden singletons · raw endpoint paths or client construction.

**Shape:** `lib/workflows/<domain>/<workflow>.ts`.

**`(input, deps)` contract:** per-call values → `input`; **live capabilities → `deps`** (access calls, store setters, cache invalidation, navigation, toasts, telemetry, runtime resolution, clocks, id generation). **Do not pass pure helpers/constants/formatting as deps — import those directly.**

**Best practice:** keep a short single action inline in the workflow hook; extract here only when ordering/branching/rollback/retry/testability is the reason. Keep deps narrow — a large `EverythingDeps` means the boundary is too broad. The lib fn never imports hooks.

### `lib/access/**`
Raw app-local access to the systems your product **is**: client setup, platform bridges, native wrappers, low-level auth/storage bridges, thin SDK adapters. The **React-facing query/mutation wrappers live in `hooks/access/**`**; this is the raw layer beneath.

**Must not own:** product workflow branching, UI state, stores, or reusable shared-package logic.

**Shape:** `lib/access/<system>/<helper>.ts`. See `access.md` for the system map.

**Best practice:** raw and thin — if it branches on product data it's a `workflow`; if it's React-facing it's a hook.

### `lib/integrations/**`
Integration with third-party **services** the app plugs into — **auth** (provider flow) and **telemetry** (analytics/error reporting). Distinct from `access` (your own backends) and `infra` (no vendor).

**Owns:** the vendor SDK wiring + flow. Examples:
```text
integrations/auth/        proliferate-auth · orchestration-{bootstrap,callback,redirect,transport,effects,provider-flow}
integrations/telemetry/   sentry · posthog · anonymous · scrub · client · config
```

**Must not own:** product workflow branching · core-backend access (→ `access`) · React behavior (the provider/hook that consumes it lives above).

**Shape:** `lib/integrations/<provider>/<file>.ts`.

**Best practices:** one provider family per folder; keep product decisions *out* (pass them in); **scrub/redact at this boundary** (telemetry); generic local logging without a vendor belongs in `infra`.

### `lib/infra/**`
Generic technical machinery with **no product vocabulary and no vendor**.

**Owns:** persistence helpers · scheduling/batching/timers · ids/stable keys · measurement plumbing · safe JSON parsing · generic logging and diagnostics utilities.

**Must not:** know about chats/sessions/workspaces/agents/billing/repos/prompts (→ `domain`) · be a vendor integration like Sentry/PostHog (→ `integrations/telemetry`).

**Shape:** `lib/infra/<technical-concern>/<helper>.ts`.

## Rules (hard)

- **No `lib/**` file imports React, hooks, stores, providers, or query clients.** Hooks call lib; lib never calls hooks.
- `domain` is pure (data in/out); the moment it needs I/O, a client, or a store, it isn't domain.
- `workflows` reach the world only through `deps`, and `deps` are **capabilities, not pure helpers**.
- Keep the three access-ish layers distinct: **`access` = your backends · `integrations` = third-party providers · `infra` = no external system.**
- **Local first:** promote a pure rule to ProductClient's nested `src/domain/**`
  only when Mobile and another client need it. The nested owner has the same
  purity rules and cannot import upward into connected ProductClient.
- No `utils.ts`/`helpers.ts`/`misc.ts` — name the concept.

## Placement & testing

- Pure decision/model/reducer/**planner** → `lib/domain`, or ProductClient
  `src/domain/**` if shared with Mobile.
- Multi-step sequence → `workflows`.
- Raw backend/platform access → `access`.
- Third-party provider wiring → `integrations`.
- Generic machinery → `infra`.
- **Everything in `lib` is non-React → unit-test functions directly** (`domain` purely, `workflows` via `(input, deps)`); no rendering. Tests live beside risky domain/workflow logic.

---

# Frontend Config

`config/**` is for real static configuration: constants, limits, option sets,
route ids, default ids, ordering, and runtime-independent knobs.

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

Keep config values static. If a value depends on runtime state, user settings,
remote data, or a selected workspace/session, it belongs in a hook, store,
domain helper, or access layer instead.

---

# Frontend Copy

`copy/**` is for human-facing words and authored text.

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

Copy files should not import React, stores, query clients, access helpers, or
platform APIs. They may export plain strings, string factories, and typed copy
maps when the conditions are simple and already decided by the caller.

## Presentation Mappings

Presentation mappings convert product state to display metadata: labels, tones,
icons, descriptions, ordering, and visibility flags.

Put reusable mappings in `lib/domain/<domain>/<subdomain>/presentation.ts`.
Move them to `apps/packages/product-client/src/domain/<domain>/**` when the same
mapping is shared with Mobile. Desktop/Web-only mappings remain in connected
ProductClient `lib/domain/**`. Keep them component-local only when they are
purely visual and not reused.

Examples:

- cloud workspace status -> label/tone/description
- session control -> display label/icon
- agent availability -> badge tone

Presentation mappings are not access logic and are not remote caches.

---

# Frontend Styling

Scope:

- `apps/desktop/src/**`
- `apps/web/src/**`
- `apps/mobile/src/**`
- shared styling under `apps/packages/design/**` and
  `apps/packages/product-client/**`

This file covers styling-only rules. Read
[README.md](../README.md) for structure, ownership, and data-flow guidance.
ProductClient's `src/domain/**` subtree is included in the package path above
but is headless: it imports no CSS, Tailwind vocabulary, Design package, DOM
primitive, or visual component.

For which layer may style what — the five jobs of UI code (paint/anatomy/state/layout/behavior) and the component placement algorithm — see [DESIGN_SYSTEM.md § Component Library](../DESIGN_SYSTEM.md#component-library).

## Semantic Tokens

Always use semantic theme tokens such as:

- `bg-background`
- `bg-card`
- `text-foreground`
- `text-muted-foreground`
- `border-border`
- `bg-success`
- `bg-destructive`

If a new color meaning is truly needed, add a semantic token and update all
supported themes instead of dropping palette classes into a component.

Shared token ownership:

- `apps/packages/design/src/tokens.ts` owns serializable cross-client token
  values.
- `apps/packages/design/dist/theme.css` is generated from those tokens and exposes
  shared CSS theme variables plus shared non-product animation utilities for
  Desktop/Web. Do not hand-edit generated theme output.
- `apps/packages/design/src/css/product.css` owns the shared Desktop/Web
  product entrypoint: Tailwind setup, shared package `@source` entries, shared
  reset/root/body defaults, fonts, shared scrollbar utilities, and global
  runtime selectors. The ProductClient package entry imports it as
  `@proliferate/design/product.css`, and `apps/web/src/index.css` imports the
  same stylesheet.
- `apps/packages/design/src/css/desktop.css` owns genuine Desktop/native-only
  CSS (drag regions and other Tauri-specific overrides). Desktop imports this
  as `@proliferate/design/desktop.css`.
- Client-specific global selectors are allowed only when explicitly scoped
  under `[data-proliferate-client="desktop"]` or
  `[data-proliferate-client="web"]`.
- Desktop keeps Desktop-only global CSS, third-party overrides, and theme
  runtime behavior in `apps/desktop/src/**`.
- Third-party dependency CSS, such as `@xterm/xterm/css/xterm.css`, is imported
  by the owning app directly. Do not put third-party dependency CSS in
  `apps/packages/design`.
- Mobile consumes React Native-safe values from
  `@proliferate/design/react-native`, not DOM CSS.

## No Raw Tailwind Palette Classes

Do not use raw palette classes such as:

- `bg-red-500`
- `text-zinc-300`
- `border-blue-600`
- `from-slate-900`

Theme decisions belong in tokens, not ad hoc callsite classes.

## Sidebar Tokens

Components rendered inside the right panel or sidebar background
(`bg-sidebar-background`) use the shared state tokens for interaction paint and
sidebar-specific tokens for text:

- `bg-hover` / `hover:bg-hover` for hover and active states, `bg-selected` for
  persistent selection — the same three state roles as everywhere else
- `text-sidebar-foreground` / `text-sidebar-muted-foreground` for text
- `border-border` for borders

Do not use `hover:bg-muted` or ad-hoc overlays inside sidebar surfaces — the
shared state tokens are what keep the shell, sidebar, lists and menus from
drifting apart.

## No Partial-Opacity Hover Transitions on Glyphs

Never animate `opacity` between two visible values (e.g. `opacity-75` →
`hover:opacity-100`) on always-visible text or icons. The opacity animation
creates a compositing layer that collapses at 1.0, re-rasterizing the glyph's
anti-aliasing on every hover — which reads as shimmer/jitter even though
nothing moves. Express the same muted→prominent promotion as a **color**
change instead:

```tsx
{/* BAD: shimmer on every hover */}
<span className="opacity-75 transition-opacity group-hover:opacity-100" />

{/* GOOD: same visual weight, no re-rasterization */}
<span className="text-current/75 transition-colors group-hover:text-current" />
{/* or with explicit tokens: */}
<span className="text-muted-foreground/75 transition-colors group-hover:text-muted-foreground" />
```

`text-current/75` (a color-mix on currentColor) preserves inheritance so
tinted rows (`text-destructive`) still color their glyphs. This rule is only
about *transitions between two visible states* — the 0→100 hover-reveal
pattern below is fine because the element starts invisible.

## Hover Reveal Pattern

Use `group` + `opacity-0 group-hover:opacity-100` for actions that should
appear on hover. Name the group when nesting is possible:

```tsx
<div className="group/file-diff ...">
  {/* Always visible content */}
  <div className="opacity-0 transition-opacity group-hover/file-diff:opacity-100">
    {/* Hover-revealed actions */}
  </div>
</div>
```

Use `transition-opacity duration-200` for smooth reveal. Keep the always-
visible element (like a chevron or status indicator) outside the hidden
container.

## Card Surfaces

Reach for the `Card` pattern
(`#product/primitives/patterns/Card`) before hand-rolling a card-like
container (diff cards, file entries). It owns the whole recipe below.
The recipe is documented here because it is what `Card` paints, not as a
licence to re-assemble it.

- Background: `bg-surface-elevated-secondary` for a subtle tint against
  any surface. This is the token form of the theme-stable card tint —
  3% white in dark, 4.9% light ink in light. Do not write
  `bg-foreground/5`: the appearance gate's `FOREGROUND_ALPHA_RE` rejects
  raw `foreground/<alpha>` fills, and the token is the sanctioned way to
  name the same wash.
- Header: double-layer pattern for opaque sticky headers. A sticky
  header over a tinted card cannot just repeat the tint, or the body
  shows through it — so the outer layer paints the opaque plane behind
  the card and the inner layer repaints the tint on top, resolving to
  exactly the body's colour. The ground is whatever the card's own
  parent paints, and `Card`'s `plane` axis names the two grounds it
  supports: `content` is `bg-background`, `rail` is `bg-sidebar` — the
  ground the git/review rail that hosts these cards paints
  (`GitPanel.tsx`). `bg-sidebar-background` is a *third*, darker plane
  (`#181818` against `bg-sidebar`'s `#222222`) painted by the right-panel
  frame, the attached pane shell and the file-tree pane; a card whose
  parent is one of those cannot ground on `plane="rail"` without seaming,
  and needs a review decision rather than a guessed token.
- Border radius: `rounded-lg` with `overflow-clip`. Never
  `overflow-hidden`, which establishes a scroll container and freezes a
  sticky header inside a box that never scrolls.
- Spacing between cards: `gap-2`, owned by the container.

Do not use `bg-hover/30` or similar opacity-based backgrounds that
shift meaning across themes.

## RTL Truncation for File Paths

Long file paths should truncate from the left (showing the filename end).
Use the RTL direction trick:

```tsx
<span className="min-w-0 truncate text-start [direction:rtl]" title={fullPath}>
  <span className="[direction:ltr] [unicode-bidi:plaintext]">
    {fullPath}
  </span>
</span>
```

The outer span truncates from the left via `[direction:rtl]`. The inner span
restores left-to-right rendering for the actual text.

## Syntax Highlighting

Use Shiki for syntax-highlighted code outside of the Monaco editor:

- `lib/infra/highlighting.ts` owns the Shiki highlighter singleton
- Always pass a `theme` parameter (`"dark"` or `"light"`) — never hardcode a
  single theme
- Use `highlightLines()` for per-line token arrays (diffs, inline code)
- Use `highlightCode()` for full HTML blocks (code panels, previews)
- Hooks own the async Shiki call; components render the result

The `proliferate-dark` and `proliferate-light` Shiki themes live in
`highlighting.ts`. When adding new token scopes, update both themes.

## Monaco Editor

Use the custom `proliferate-dark` / `proliferate-light` Monaco themes defined
in `lib/infra/monaco-theme.ts`. Register both in `beforeMount` and select
based on `useResolvedMode()`.

Key options to preserve:
- `useShadows: false` on scrollbar (no scroll shadow)
- `glyphMargin: false`, `lineNumbersMinChars: 3`
- Font: `'Geist Mono', monospace`

## Git Diff Colors

All themes define git-specific tokens:

- `text-git-green` / `text-git-red` for inline stats
- `text-git-new-line` / `text-git-removed-line` for diff line text
- `bg-[var(--git-new-line-bg)]` / `bg-[var(--git-removed-line-bg)]` for line
  backgrounds
- Border and highlight variants at different opacity levels

These are defined per-theme in `index.css`. Do not hardcode green/red — use
the tokens.

## UI Primitives First

In DOM package code,
`apps/packages/product-client/src/primitives/**` owns the primitive visual
contract. Do not define primitive components outside that subtree.
The sibling `product-client/src/domain/**` subtree is not a styling or primitive
owner and cannot depend on this DOM layer.

Forbidden outside `apps/packages/product-client/src/primitives/**`:

- defining a local `Button`, `IconButton`, `Input`, `Dialog`, `Menu`, `Select`,
  `Tabs`, `Tooltip`, `Badge`, layout shell, or equivalent lookalike
- wrapping raw DOM controls in a reusable locally styled primitive
- restyling raw controls at callsites to mimic a primitive
- rendering raw controls directly:

- `<button>`
- `<input>`
- `<label>`
- `<select>`
- `<textarea>`

If a visual treatment is missing, extend the primitive API or add a dedicated
primitive in `apps/packages/product-client/src/primitives/**`. Callsite classes
may handle layout, spacing, and sizing; primitives own color, border, radius,
typography, focus, hover, disabled, and loading states.

When using ProductClient primitives or shared ProductClient components,
import `@proliferate/design/product.css`;
that shared entrypoint owns the Tailwind package source scanning.

Reusable icons belong in app/package primitive icon modules, not inline inside
feature components.

## Callsite Styling

Allowed at callsites:

- spacing
- layout
- sizing
- composition

Callsite styling means `className` at the callsite. Prefer utility classes for
static layout, spacing, sizing, and composition.

Use inline `style={...}` only when the value is truly dynamic and cannot be
expressed cleanly with existing utilities or CSS variables. Typical examples
are runtime-calculated widths, heights, positions, or custom properties passed
to a class-driven layout.

Do not rebuild the product visual language at the callsite with ad hoc
border/color/typography stacks that should come from the primitive contract.

## Global CSS

Global CSS is for:

- theme tokens
- theme definitions
- resets
- third-party overrides

Component-specific styling belongs with the component or primitive, not in
`index.css`.

Shared element resets in `product.css` (e.g. the `a` color/underline reset) must
live in `@layer base`, never unlayered. Tailwind v4 puts utilities in
`@layer utilities`, and unlayered CSS beats every layer regardless of
specificity — an unlayered reset silently strips intentional utility classes
(link color, underline, the file/provider mention styles) off the matching
element, which then renders as plain inherited text. A `<button>`-based mention
escapes an `a` reset and looks fine while the equivalent `<a>` does not, which is
exactly how this hides.

App stylesheets should be import-only where possible. `apps/web/src/index.css`
imports only `@proliferate/design/product.css`. Desktop imports
`@proliferate/design/desktop.css` in `apps/desktop/src/main.tsx`; the shared
product theme rides with the compiled ProductClient package entry, whose
`index.css` imports `@proliferate/design/product.css`. Mobile uses
`apps/mobile/src/styles/**` and `@proliferate/design/react-native`, not DOM
CSS.

---

# Frontend Telemetry Standards

Use this doc for analytics events, exception capture, anonymous telemetry,
session replay, and telemetry-related provider and hook ownership.

## Ownership

- `providers/**` owns app-wide telemetry boundaries such as bootstrap wiring.
- `hooks/**` owns UI-facing telemetry side effects.
- `components/**` render and should not import telemetry helpers directly,
  except explicit error boundaries.
- `lib/integrations/telemetry/**` owns transport mechanics for both vendor and
  anonymous telemetry, not product workflow decisions.
- `lib/domain/telemetry/**` owns typed event catalogs, safe enums, and pure
  telemetry helpers.
- Keep one telemetry tree and one `TelemetryProvider`. Anonymous telemetry is a
  second backend inside the existing telemetry system, not a parallel provider
  or folder tree.

## Runtime Modes

- Desktop runtime telemetry routing uses one mode field:
  - `local_dev`
  - `self_managed`
  - `hosted_product`
- `trackProductEvent(...)` remains the frontend fanout seam. Hooks continue to
  emit typed product events, and the telemetry client decides whether they go to
  vendor telemetry, anonymous telemetry, or both.
- Web and Mobile telemetry stays coarse unless a typed product event is added:
  route/screen events, hosted authenticated identity sync, and reviewed product
  events only.
- Vendor telemetry is enabled only in `hosted_product`.
- Anonymous telemetry may be enabled in all runtime modes unless explicitly
  disabled.

## Anonymous Records

- Anonymous telemetry records must stay install-level and structured.
- Current anonymous record types are:
  - `VERSION`
  - `ACTIVATION`
  - `USAGE`
- Anonymous payloads must not include user identity, transcript content,
  terminal output, repo names, raw paths, raw error strings, or other
  free-form/high-cardinality strings.

## Events

- Product events must be defined in the typed event catalog under
  `lib/domain/telemetry/events.ts`.
- Event names should stay stable when possible. Prefer changing payload shape
  and ownership over renaming events.
- Hosted-product PostHog events should stay explicitly permitted. If an event
  is not permitted for the vendor backend, it may still produce Sentry
  breadcrumbs without becoming a PostHog event.
- Event payloads must be low-risk and structured: enums, booleans, counts,
  versions, provider kinds, workspace kind, and similar fields.
- Do not send prompts, transcript content, terminal output, file contents,
  repo names, absolute paths, raw URLs with secrets, or raw error messages in
  analytics payloads.
- Do not use arbitrary string bags for analytics. Add the field to the typed
  event map first.

## Exception Capture

- Vendor exception capture (Sentry) is hosted-product only in v1.
- Prefer one capture path per failure.
- For a handled AnyHarness failure, suppress ProductClient capture only when
  the cause chain contains an exact
  `urn:proliferate:anyharness:incident:<uuid>` RFC 7807 instance. Old runtimes,
  malformed or foreign instances, transport failures, and unrelated errors
  retain the sanitized client capture path.
- If a query or mutation hook captures its own exception, mark it with
  `meta.telemetryHandled = true` so the global React Query handlers do not
  report it again.
- The global query handler leaves cancellation, unambiguous auth/permission
  gates, explicitly coded GitHub App or AnyHarness hosting-availability states,
  and the Cowork `COWORK_THREAD_NOT_FOUND` lifecycle state in React Query
  without sending them as exceptions. Generic 4xx responses remain reportable,
  as do request, network, and unknown failures. The global mutation handler does
  not apply this query disposition rule; it separately leaves only explicitly
  coded repository-selection validation states to their owning mutation
  workflow. Other mutation failures remain reportable.
- Global query and mutation capture extras use versioned, fixed-width opaque
  fingerprints for their serialized key identities. The underlying stable
  serialization remains the React Query cache identity. The non-cryptographic
  digest is diagnostic correlation only, never a cache identity, security
  boundary, authorization input, or reversible lookup.
- The global query handler also leaves non-5xx `INVALID_FILE_PATH`,
  `FILE_NOT_FOUND`, `FILE_PERMISSION_DENIED`, and `NOT_A_DIRECTORY` AnyHarness
  responses in React Query as expected file state. A 5xx carrying any of those
  codes remains reportable, as does `PATH_OUTSIDE_WORKSPACE` unless an existing
  status rule suppresses it. Mutation disposition remains unchanged.
- Auth workflows treat only `AbortError` and the explicitly branded local
  interactive poll timeout as
  typed, rendered control states. Generic HTTP 4xx responses (including an
  unbranded 408), network failures, security failures, and unknown errors remain
  reportable.
- Sentry tags must stay low-cardinality. Prefer stable keys such as `domain`,
  `action`, `provider`, `workspace_kind`, and `route`.
- Put high-cardinality or diagnostic values in scrubbed extras, not tags.
- Background callback and deep-link error handling may capture inside the
  orchestration layer when there is no clean hook boundary, but that should be
  the exception, not the rule.

## Replay and Privacy

- Web and Mobile PostHog recording and Desktop renderer Sentry replay stay
  source-disabled: no enabling flag, options object, or start call, and
  Web/Mobile Sentry replay rates are zero. No build value, environment value,
  optional native package, or provider-side setting turns any of them on.
- Desktop PostHog recording is start-gated, not source-disabled.
  `disable_session_recording` is a literal `true` at init and there is no
  `loaded` callback, so nothing auto-starts. Recording begins only when the
  signed-in address matches the closed internal audience in
  `product-client/src/domain/telemetry/replay-audience.ts`, and only if the
  PostHog project also has replay enabled server-side. Customer recording is
  off.
- Route identifiers never reach a replay payload. Masking hides page content
  and does nothing about URLs, so URL reduction is a separate mechanism:
  `product-client/src/domain/telemetry/route-id-redaction.ts` reduces every URL
  to a bounded route template from a closed table. The load-bearing boundary is
  `before_send`, which covers every `$current_url`-style property, the rrweb
  Meta event `href`, and every URL-valued DOM attribute inside
  `$snapshot_data`. The same reducer is also wired as the recorder-boundary
  `maskAttributeFn`, but the pinned `posthog-js@1.386.8` never invokes it, so
  that boundary is dormant forward-compatibility and must not be counted as
  coverage. A pathname matching no template becomes `/unknown`.
- Widening Desktop recording to customers, or re-enabling replay on any other
  surface, requires a new reviewed source change that first proves, with
  synthetic sensitive content, the route/screen block-and-mask policy,
  metadata policy, log/network policy, provider arrival, and the absence of
  prompts, transcripts, terminal text, file contents, repo/path data, tokens,
  credentials, identity beyond the permitted opaque ID, and
  workspace/session/workflow identifiers. The rules below are its contract.
- Shared client payload scrubbing bounds container traversal by depth, array
  positions, and object properties. It replaces cyclic back-edges with
  `[circular]` and structural overflow with `[truncated]`, reuses a completed
  scrubbed value for repeated references, and redacts enumerable accessors
  without evaluating them. These are structural bounds; strings retain their
  existing redaction behavior and are not truncated by length.
- Recorder capabilities that resolve against the provider's remote flags are
  pinned in source, not left unset. Canvas recording
  (`captureCanvas: { recordCanvas: false }`) and console capture
  (`enable_recording_console_log: false`) both resolve local-first, so an unset
  value would let the PostHog project turn them on by itself. Canvas frames are
  pixels and console arguments are arbitrary strings; neither is reached by
  text masking or by route-id redaction.
- Recorded content control is masking plus blocking, and the two have
  different coverage. Desktop recording masks all text (`maskTextSelector="*"`)
  and all inputs, so rendered prompts, transcripts, terminal text, and paths
  are masked wherever they appear. `[data-telemetry-block]` removes a subtree
  entirely and is currently applied by `ProductPageShell` (when
  `telemetryBlocked` is set, as the workflows surfaces do), `SettingsScreen`,
  `ModalShell`, and `CommandPalette`. The main workspace/chat surface is masked
  but not blocked; widening replay beyond the internal audience should settle
  whether it must also be blocked.
- Continue using explicit masking for input areas that may contain sensitive
  text.
- If a new surface can display prompts, files, paths, repo metadata, tokens,
  or credentials, block it unless there is a reviewed reason not to.

## Practical Rules

- Track analytics from hooks such as action hooks, mutation hooks, and
  telemetry bootstrap hooks.
- Prefer deriving anonymous telemetry from existing typed product events rather
  than adding a second telemetry call at each workflow hook.
- Capture exceptions from hooks or boundaries, not from ordinary render
  components.
- If a platform wrapper currently swallows errors, move the fallback behavior
  up into a hook when the UI needs telemetry around that failure.

---

# Frontend Access Boundaries

External systems have one clear access boundary. Components and product hooks
do not construct clients, call raw endpoint paths, or invoke platform APIs
directly.

## Shape

```text
lib/access/
  <external-system>/
    <capability>.ts

hooks/access/
  <external-system-or-capability>/
    <resource>/
      query-keys.ts
      use-<resource>.ts
      use-<action>-mutation.ts
```

Common external systems:

- `cloud`
- `anyharness`
- `tauri`
- `browser`
- `native`

Folder names under `hooks/access/**` describe the external system or cached
access capability, not the product screen that happens to render the data. A
capability folder such as `mcp` is allowed when one React-facing access API
intentionally coordinates more than one external boundary, such as cloud
connector records plus local OAuth/native setup.

Illustrative examples only, not a complete inventory:

```text
hooks/access/cloud/billing/use-billing-plan.ts
hooks/access/cloud/billing/use-llm-balance.ts
hooks/access/cloud/billing/use-team-checkout.ts

hooks/access/tauri/app/query-keys.ts
hooks/access/tauri/app/use-app-version.ts
hooks/access/tauri/use-updater.ts

hooks/access/anyharness/workspaces/use-workspace-bootstrap-cache.ts
hooks/access/anyharness/sessions/use-workspace-session-cache.ts
```

Do not create access folders just to mirror another client. Each owner keeps
only the systems it actually uses:

- ProductClient owns connected Desktop/Web `cloud` and `anyharness` hooks. It
  may own `tauri` capability hooks only when they call the typed Desktop bridge
  and never import Tauri directly.
- Desktop owns raw Tauri/local-runtime implementation plus host authentication
  and vendor adapters. Web owns browser authentication, storage, links,
  telemetry, and Cloud-client construction.
- Mobile owns its `cloud` and native authentication/storage helpers.

## Query Key Ownership

Query keys are part of the React-facing access contract. They live beside the
access hook that owns the same remote resource cache.

```text
hooks/access/<system>/<resource>/query-keys.ts
hooks/access/<system>/<resource>/use-<resource>.ts
hooks/access/<system>/<resource>/use-<action>-mutation.ts
```

Do not put React Query key factories in `lib/access/**`; that layer owns raw
transport, not React cache identity. Do not define remote-resource query keys
inside product hook folders such as `hooks/workspaces/**` or
`hooks/sessions/**`.

Product hook folders may keep key helpers only for product-composed caches
that combine multiple sources into one product-owned projection.

```text
hooks/workspaces/cache/workspace-collections-query.ts
hooks/workspaces/cache/workspace-collections-cache.ts
```

Access hooks own one external resource cache. Product cache folders own
cross-boundary product projections.

## Cloud

`@proliferate/cloud-sdk` owns shared raw Proliferate Cloud API helpers.
`@proliferate/cloud-sdk-react` owns generic React Query hooks and providers for
Cloud resources. App code imports reusable SDK helpers directly instead of
adding app-local re-export wrappers.

ProductClient `lib/access/cloud/**` owns connected helpers the shared SDK cannot
know: auth probes and transport contracts, gateway access, owner-context
headers, health/capability checks, request timing, and connection retry rules.
Each host retains authenticated client construction, auth/session bootstrap,
base-url resolution, storage integration, and environment-specific credential
or vendor adapters.

ProductClient `hooks/access/cloud/**` owns connected React-facing access that is
not already generic enough for `@proliferate/cloud-sdk-react`:

- query keys
- `useQuery` and `useMutation`
- invalidation
- retries
- request telemetry
- UI-safe error handling

If a hook wraps a Cloud endpoint with `useQuery` or `useMutation`, it belongs
under `hooks/access/cloud/**` even when the resource is product-specific.
Product hooks consume the access hook and derive product state in their own
domain folder.

Do not create ad hoc `openapi-fetch` clients outside the Cloud access layer.
Do not call raw `client.GET`, `client.POST`, `client.PUT`, or `client.DELETE`
from product hooks or components.

Connected ProductClient code calls `@proliferate/cloud-sdk-react` only from
`apps/packages/product-client/src/hooks/access/cloud/**`. Components and
product workflow hooks consume those access-owned seams. Pure cross-client
rules under `apps/packages/product-client/src/domain/**` may accept generated or
SDK contract types as data, but they never import SDK clients, access hooks,
query clients, providers, or raw transports.

## AnyHarness

Generic AnyHarness React access goes through `@anyharness/sdk-react`.
Product hooks should not call `getAnyHarnessClient` directly for normal
resource operations.

Prefer direct SDK React imports for generic resources:

```ts
import { useAnyHarnessRuntimeWorkspaces } from "@anyharness/sdk-react";
```

Create a ProductClient AnyHarness access hook only when the connected product
adds connection/runtime selection, local/cloud bridging, or cache behavior the
SDK cannot provide. Desktop-specific capability reaches that hook through
`ProductHost.desktop`; the hook does not import the host.

Low-level framework-agnostic primitives, such as streams, transcript reducers,
and terminal connections, belong in `@anyharness/sdk`.

Desktop-capable AnyHarness access in ProductClient is only for product runtime
wiring that the generic SDK cannot know:

- resolving the selected workspace to the correct runtime target
- local/cloud runtime connection mapping
- runtime bootstrap and credentials
- Desktop-specific compatibility adapters

Do not add a parallel AnyHarness request/controller layer in either host. If the
operation is a normal AnyHarness resource operation, ProductClient prefers the
SDK or SDK React hook; Desktop supplies only the raw local-runtime capability
required by the typed bridge.

## Tauri

Raw Tauri access belongs behind the Desktop host boundary.
`apps/desktop/src/lib/access/tauri/**` is the only frontend path that should
import `@tauri-apps/api` or call native `invoke` directly. ProductClient
`hooks/access/tauri/**` is the React-facing capability boundary and calls the
typed `DesktopBridge`; it never imports Tauri.

Use wrappers for native capabilities such as:

- `invoke`
- native events
- updater operations
- filesystem access
- native window operations
- shell/open-in-editor operations

React-facing Tauri behavior belongs in ProductClient
`hooks/access/tauri/**` or a product workflow hook that calls the bridge-backed
wrapper. Raw native implementation stays in Desktop. Components should not
call raw Tauri APIs directly.

## Product Usage Pattern

Product hooks compose access instead of owning it directly.

```text
Component
  -> product workflow hook
    -> access hook or SDK hook
      -> lib/access raw helper or external SDK
    -> lib/workflows function receives access callbacks as dependencies
```

App-local or connected-client business rules live in `lib/domain/**` or
`lib/workflows/**`. Rules shared with Mobile live in
`apps/packages/product-client/src/domain/**` and remain equally isolated from
access. Transport details live in access. Rendering lives in components. Plain
`lib/**` and nested-domain functions do not call React hooks.

Access hooks own query keys, cache object shape, invalidation, and
`setQueryData` for remote resources. Product workflow hooks request refresh or
update through access-owned callbacks instead of constructing query keys or
writing cache objects inline.

---

# SDK Structure

Scope:

- `cloud/sdk/**`
- `cloud/sdk-react/**`
- `anyharness/sdk/**`
- `anyharness/sdk-react/**`

Use this document to choose the SDK family and layer that owns a change. The
Cloud SDK speaks to the Proliferate control plane; the AnyHarness SDK speaks to
an AnyHarness runtime. Neither SDK owns app-specific orchestration or product
policy.

## Harness launch options

The AnyHarness SDK owns the local target contract and client methods for
`HarnessLaunchOptionsResponse`, refresh, `LaunchSelection.controlValues`, and
the full `SessionLiveConfigSnapshot`. `HarnessLaunchOptionsResponse` preserves
the optional exact `modelControls` rows alongside its flat compatibility
statement; it does not synthesize missing model rows. SDK React exposes
query/mutation hooks and keys scoped by runtime, cache scope, and harness.

The Cloud SDK owns the copied target response and reads it by cloud sandbox ID
plus harness kind. Cloud React keys include both values. Neither SDK composes,
seeds, aliases, or filters executable membership; wire types and clients
preserve exact ordered IDs and unknown values.

## 1. File Tree

```text
cloud/
  sdk/
    src/
      index.ts
      client/       # resource-grouped control-plane clients
      streams/      # framework-independent Cloud streams
      types/        # public Cloud SDK types and aliases
      generated/    # generated server OpenAPI types
  sdk-react/
    src/
      index.ts
      context/      # scoped Cloud client provider
      hooks/        # generic Cloud queries and mutations
      lib/          # query keys and React SDK infrastructure

anyharness/
  sdk/
    src/
      index.ts
      client/
        core.ts
        runtime.ts
        agents.ts
        workspaces.ts
        files.ts
        sessions.ts
        git.ts
        pull-requests.ts
        terminals.ts
        processes.ts
      types/
        runtime.ts
        agents.ts
        workspaces.ts
        files.ts
        sessions.ts
        events.ts
        reducer.ts
        git.ts
        hosting.ts
        terminals.ts
        processes.ts
      streams/
        sessions.ts
        terminals.ts
      reducer/
        transcript.ts
      generated/
        openapi.ts
  sdk-react/
    src/
      index.ts
      context/
        AnyHarnessRuntime.tsx
        AnyHarnessWorkspace.tsx
      hooks/
        runtime.ts
        agents.ts
        workspaces.ts
        sessions.ts
        git.ts
        pull-requests.ts
        files.ts
        terminals.ts
      lib/
        client-cache.ts
        query-keys.ts
```

Each family has a framework-independent core package and a generic React and
TanStack Query package. Apps and shared product packages compose them; they do
not move product workflows into either SDK.

## 2. Non-Negotiable Rules

- `@proliferate/cloud-sdk` and `@anyharness/sdk` are pure TypeScript only.
- Core SDKs must not depend on React, TanStack Query, Zustand, Tauri, or app
  code.
- `@proliferate/cloud-sdk-react` owns generic React-facing control-plane
  providers, queries, and mutations.
- `@anyharness/sdk-react` owns generic React-facing bindings for AnyHarness.
- React SDKs must not depend on product policy, app stores, Tauri APIs, or
  synthetic app state.
- Keep the public core client API resource-grouped.
- Keep one clear public API per package. Do not preserve duplicate flat
  methods or duplicate wrapper layers.
- `src/index.ts` is the curated public surface for each package.
- Generated OpenAPI files must not be hand-edited.
- The FastAPI schema is the source of truth for Cloud SDK wire types. Run
  `make cloud-client-generate` after its server contract changes.
- Rust contract types are the source of truth for AnyHarness SDK wire types.
  Run `make sdk-generate` after that contract changes.
- Checked-in generated OpenAPI files are generated artifacts and must not be
  edited by hand.
- SDK HTTP wrapper types in `src/types/*.ts` must alias generated OpenAPI
  schemas instead of hand-maintained mirrors.
- Hand-authored public types should exist only when they materially improve the
  API for non-contract client helpers, reducer state, or streaming helpers.
- Low-level streaming helpers and transcript reducers stay in
  `@anyharness/sdk`.
- Support-window timestamp handling in `@anyharness/sdk` accepts only canonical-equivalent UTC spellings and sends canonical `Z` text on the wire, retaining 3, 6, or 9 digit fractions as given. It is not a compensation layer for a caller that emits a non-canonical window: a producer that needs fixed-millisecond output fixes that at the producer, and this normalization stays as it is.
- Generic React providers, query hooks, mutation hooks, and query keys stay in
  `@anyharness/sdk-react`.
- `useStatWorkspaceFileQuery` treats `path: ""` as an enabled workspace-root
  stat and treats only `path: null` as disabled (subject to workspace id and
  caller `enabled`). `useReadWorkspaceFileQuery` keeps its nonempty-path gate;
  workspace root is not a readable file.

## 3. Ownership Model

Use the lowest package that can own the behavior cleanly.

| Concern | Owner | Rule of thumb |
| --- | --- | --- |
| Typed control-plane HTTP operations | `@proliferate/cloud-sdk` | Add resource-grouped client methods under `cloud/sdk/src/client/**`. |
| Generated control-plane wire types | `@proliferate/cloud-sdk` | Treat `cloud/sdk/src/generated/openapi.ts` as generated input only. |
| Generic Cloud queries, mutations, providers, and query keys | `@proliferate/cloud-sdk-react` | Keep reusable server-resource wiring here; product workflows stay in the consuming product layer. |
| Typed AnyHarness HTTP and resource operations | `@anyharness/sdk` | Add resource-grouped client methods under `src/client/**`. |
| Generated wire contract types | `@anyharness/sdk` | Treat `src/generated/openapi.ts` as generated input only. |
| SDK-facing public types | `@anyharness/sdk` | Prefer thin aliases first; only hand-author when the public API gets meaningfully better. |
| Low-level streams and reducers | `@anyharness/sdk` | Keep transport, event replay, and transcript reduction framework-agnostic. |
| Generic React providers | `@anyharness/sdk-react` | Runtime and workspace scope only. Providers take resolved inputs from the app, not app stores directly. |
| Generic React queries, mutations, query keys, and client cache helpers | `@anyharness/sdk-react` | Reads use `useQuery`, writes use `useMutation`, and invalidation stays with the owning mutation hook. |
| App-specific orchestration and product policy | app layer | Store coordination, preferences, telemetry, onboarding, Tauri flows, and workflow logic stay out of both SDK packages. |

Package split:

- `@proliferate/cloud-sdk` owns typed control-plane clients, Cloud transport,
  public Cloud SDK types, and generated server contract types.
- `@proliferate/cloud-sdk-react` owns generic Cloud client context, query keys,
  queries, and mutations layered on the Cloud core SDK.
- `@anyharness/sdk` owns typed client methods, transport behavior, public SDK
  types, generated contract types, low-level streams, and generic reducers.
- `@anyharness/sdk-react` owns generic React providers plus generic query and
  mutation hooks layered on top of the core SDK.
- App code composes both packages and owns product-specific orchestration.

## 4. Folder Guide

Use these folder notes after the ownership model above has already told you
which package should own the behavior.

- `cloud/sdk/src/client/`: resource-grouped Proliferate control-plane client
  methods; no React or product workflow branching.
- `cloud/sdk/src/streams/`: framework-independent Cloud streams only.
- `cloud/sdk/src/types/`: public Cloud SDK types and generated-contract aliases;
  do not duplicate server schemas by hand.
- `cloud/sdk/src/generated/`: output of `make cloud-client-generate`; never
  hand-edit.
- `cloud/sdk-react/src/context/`, `hooks/`, and `lib/`: generic Cloud React
  context, server-resource queries/mutations, query keys, and client
  infrastructure; no app stores or product-specific orchestration.
- `anyharness/sdk/src/client/`: resource-grouped client methods and request
  helpers only; no React, query state, or app workflow logic; keep one
  resource family per file.
- `anyharness/sdk/src/types/`: public SDK types and aliases only; no duplicate
  handwritten mirrors of generated types or UI state; add an authored type
  only when it materially improves the public contract.
- `anyharness/sdk/generated/openapi.json` and
  `anyharness/sdk/src/generated/openapi.ts`: generated transport truth only;
  do not hand-edit; keep HTTP wrapper aliases in `src/types/*.ts` thin and
  direct over these generated schemas.
- `anyharness/sdk/src/streams/`: low-level session and terminal transport only;
  no React or app reconnect policy; expose generic handles and callbacks.
- `anyharness/sdk/src/reducer/`: transcript and event reduction only; no React
  coupling or product-specific UI assumptions; if multiple consumers could use
  it, it belongs here.
- `anyharness/sdk/src/generated/`: generated OpenAPI output only; no manual API
  shaping; treat generated code as wire-contract input.
- `anyharness/sdk-react/src/context/`: runtime- and workspace-scoped provider
  context only; no app-specific provider wiring or store transport; keep
  providers narrow and explicit.
- `anyharness/sdk-react/src/hooks/`: generic AnyHarness query and mutation
  hooks only; no product-specific workflow logic, store coordination, Tauri
  logic, or low-level stream transport; if it only exists for one app, keep it
  in that app.
- `anyharness/sdk-react/src/lib/`: React SDK infrastructure such as
  client-cache helpers and shared query-key builders only; do not turn it into
  a generic helper bucket.
