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
or apply a first-model fallback. Pickers submit the raw `modelId` plus one
`controlValues` entry for each selected rendered control.

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
| Components | `<app>/src/components/<domain>/<surface>/<role>/**` | App-local product UI. Components render, call hooks, and forward callbacks. | Raw access, query invalidation, multi-step workflows, reusable product rules. | [components.md](components.md) |
| Access hooks | `<app>/src/hooks/access/<system>/**` | React Query/mutation wrappers, query keys, invalidation, retry policy, UI-safe access state. | Product workflow branching or JSX. | [hooks.md](hooks.md), [access.md](access.md), [state.md](state.md) |
| Generic UI hooks | `<app>/src/hooks/ui/<mechanic>/**` | Generic UI mechanics: keyboard, pointer, layout, measurement. | Product concepts. | [hooks.md](hooks.md) |
| Derived hooks | `<app>/src/hooks/<domain>/derived/**` | UI-ready state computed from stores, providers, and queries. | Writes, effects, access construction, navigation, telemetry. | [hooks.md](hooks.md) |
| Workflow hooks | `<app>/src/hooks/<domain>/workflows/**` | User-action callbacks and React-facing orchestration. | Large algorithms, raw clients, query key definitions. | [hooks.md](hooks.md) |
| Lifecycle hooks | `<app>/src/hooks/<domain>/lifecycle/**` | Mounted background behavior: streams, dispatchers, polling, reconciliation, persistence bootstrap. | Render logic or click-driven branching. | [hooks.md](hooks.md) |
| Product UI hooks | `<app>/src/hooks/<domain>/ui/**` | Product-specific UI mechanics. | Generic UI mechanics or product workflows. | [hooks.md](hooks.md) |
| Product cache hooks | `<app>/src/hooks/<domain>/cache/**` | Product-composed caches combining multiple external/local sources. | Simple one-resource external queries. | [hooks.md](hooks.md), [state.md](state.md) |
| Facade hooks | `<app>/src/hooks/<domain>/facade/**` | Thin composition wrappers that simplify a component API. | New product behavior or business branching. | [hooks.md](hooks.md) |
| Raw access | `<app>/src/lib/access/<system>/**` | App-local raw client setup, platform bridges, native wrappers, auth/storage integration. | Product UI state, product branching, shared package logic. | [access.md](access.md) |
| App product rules | `<app>/src/lib/domain/<domain>/<subdomain>/**` | Pure app-local product rules. | React, stores, query clients, access helpers, platform APIs. | [lib.md](lib.md) |
| App workflows | `<app>/src/lib/workflows/<domain>/**` | Non-React product sequences with dependencies passed in. | React hooks, hidden singletons, raw endpoint construction. | [lib.md](lib.md) |
| Infra | `<app>/src/lib/infra/<technical-concern>/**` | Generic technical machinery: persistence, scheduling, ids, batching, measurement. | Product-domain behavior. | [lib.md](lib.md) |
| Providers | `<app>/src/providers/**` | Scoped dependencies and app/subtree boundaries. | General mutable UI state. | [state.md](state.md) |
| Stores | `<app>/src/stores/<domain>/**` | Shared client-only state: selected ids, drafts, panels, local UI preferences. | Remote caches, APIs, navigation, telemetry, multi-store orchestration. | [state.md](state.md) |
| Config | `<app>/src/config/**` | Static constants, limits, option sets, default ids, ordering. | Copy, presentation mappings, runtime state. | [config.md](config.md) |
| Copy | `<app>/src/copy/**` | Authored user-facing copy and prompt/content strings. | Logic, access, status-to-style mappings. | [copy.md](copy.md) |
| Styling | `<app>/src/styles/**`, `<app>/src/index.css` | App-local style entrypoints, native token bridge, app-specific third-party CSS. | Shared tokens or reusable DOM primitives. | [styling.md](styling.md) |
| Telemetry | `<app>/src/hooks/**`, `<app>/src/lib/**`, `<app>/src/providers/**` | Product event wiring and replay/privacy boundaries at the owning app layer. | Hidden tracking inside shared product UI. | [telemetry.md](telemetry.md) |
| Design package | `apps/packages/design/**` | Shared tokens, DOM CSS entrypoint, React Native-safe token values. | Product concepts, app code, SDK clients. | [packages.md](packages.md) |
| ProductClient domain | `apps/packages/product-client/src/domain/**` | Pure shared product rules, vocabulary, validation, projections, view models, and planners; the Mobile-safe sharing boundary. | React, DOM, React Native components, SDK clients, query clients, stores, access, primitives, or higher ProductClient layers. | [packages.md](packages.md) |
| Product client package | `apps/packages/product-client/src/**` outside `domain/**` | Canonical Desktop/Web DOM primitives under `primitives/**`, shared product presentation, and the connected application: routes, components, layered access/workflow/domain hooks and logic, stores, providers, Cloud/gateway/AnyHarness orchestration, and the typed host boundary. | Either host (`apps/desktop/**`, `apps/web/**`), `@tauri-apps/**`, raw Tauri `invoke`, Desktop-relative `@/` aliases, React Native, or product/SDK/query dependencies from the nested primitives subtree. | [packages.md](packages.md), [web-desktop-unification/README.md](../codebase/systems/product/clients/web-desktop-unification/README.md) |

## Read Order

Always start with this file. Then read the focused guide or package doc for the
layer you are changing:

- [components.md](components.md)
- [hooks.md](hooks.md)
- [state.md](state.md)
- [lib.md](lib.md)
- [access.md](access.md)
- [config.md](config.md)
- [copy.md](copy.md)
- [styling.md](styling.md)
- [telemetry.md](telemetry.md)
- [packages.md](packages.md)

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
