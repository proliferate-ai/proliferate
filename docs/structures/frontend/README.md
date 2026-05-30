# Frontend Standards

Status: authoritative for Desktop, Web, Mobile, and shared frontend packages.

## Scope

These standards apply to all frontend app logic and shared frontend packages:

- `apps/desktop/src/**`
- `apps/web/src/**`
- `apps/mobile/src/**`
- `apps/packages/design/**`
- `apps/packages/ui/**`
- `apps/packages/product-domain/**`
- `apps/packages/product-ui/**`
- `apps/packages/product-surfaces/**`

Desktop, Web, and Mobile use the same folder logic. Platform-specific folders
exist only where the platform genuinely differs: Desktop has Tauri and local
AnyHarness runtime access, Web has browser/cloud access, and Mobile has native
navigation, native styling, and React Native UI.

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

The app tree is relative to each app source root:

- `apps/desktop/src/`
- `apps/web/src/`
- `apps/mobile/src/`

Each app starts from this shape and omits folders it does not need.

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
      dom.css
      react-native.ts

  ui/
    src/
      layout/
      primitives/

  product-domain/
    src/
      <domain>/

  product-ui/
    src/
      <domain>/
        <surface>/

  product-surfaces/
    src/
      <domain>/
        <surface>/
```

Platform notes:

- Desktop uses `hooks/access/{anyharness,cloud,mcp,tauri}/**` and
  `lib/access/{anyharness,cloud,tauri}/**` when it needs local runtime, native
  shell, and Cloud attachment behavior.
- Web uses Cloud/browser access and shared DOM packages. It should not rebuild
  Desktop/Web product presentation locally when `product-ui` or
  `product-surfaces` can own it.
- Mobile uses Cloud/native access, native navigation, React Native components,
  `design/react-native`, and `product-domain`. It does not import DOM packages:
  `ui`, `product-ui`, or `product-surfaces`.

## What Goes Where

Use the lowest layer that can own the logic cleanly.

| Area | Path | Owns | Must Not Own | Canon |
| --- | --- | --- | --- | --- |
| App entry | `<app>/src/App.tsx`, `<app>/src/main.tsx` | App bootstrap, provider composition, root shell mounting. | Product workflows, reusable rules, remote cache shape. | This doc |
| Pages | `<app>/src/pages/**` | Desktop/Web route entrypoints: params, navigation state, page-level screen render. | Product visuals, access details, heavy orchestration. | This doc |
| Navigation | `<app>/src/navigation/**` | Mobile navigation model and route typing. | Product business logic or remote access. | This doc |
| Components | `<app>/src/components/<domain>/<surface>/<role>/**` | App-local product UI. Components render, call hooks, and forward callbacks. | Raw access, query invalidation, multi-step workflows, reusable product rules. | [guides/components.md](guides/components.md) |
| Access hooks | `<app>/src/hooks/access/<system>/**` | React Query/mutation wrappers, query keys, invalidation, retry policy, UI-safe access state. | Product workflow branching or JSX. | [guides/hooks.md](guides/hooks.md), [guides/access.md](guides/access.md), [guides/state.md](guides/state.md) |
| Generic UI hooks | `<app>/src/hooks/ui/<mechanic>/**` | Generic UI mechanics: keyboard, pointer, layout, measurement. | Product concepts. | [guides/hooks.md](guides/hooks.md) |
| Derived hooks | `<app>/src/hooks/<domain>/derived/**` | UI-ready state computed from stores, providers, and queries. | Writes, effects, access construction, navigation, telemetry. | [guides/hooks.md](guides/hooks.md) |
| Workflow hooks | `<app>/src/hooks/<domain>/workflows/**` | User-action callbacks and React-facing orchestration. | Large algorithms, raw clients, query key definitions. | [guides/hooks.md](guides/hooks.md) |
| Lifecycle hooks | `<app>/src/hooks/<domain>/lifecycle/**` | Mounted background behavior: streams, dispatchers, polling, reconciliation, persistence bootstrap. | Render logic or click-driven branching. | [guides/hooks.md](guides/hooks.md) |
| Product UI hooks | `<app>/src/hooks/<domain>/ui/**` | Product-specific UI mechanics. | Generic UI mechanics or product workflows. | [guides/hooks.md](guides/hooks.md) |
| Product cache hooks | `<app>/src/hooks/<domain>/cache/**` | Product-composed caches combining multiple external/local sources. | Simple one-resource external queries. | [guides/hooks.md](guides/hooks.md), [guides/state.md](guides/state.md) |
| Facade hooks | `<app>/src/hooks/<domain>/facade/**` | Thin composition wrappers that simplify a component API. | New product behavior or business branching. | [guides/hooks.md](guides/hooks.md) |
| Raw access | `<app>/src/lib/access/<system>/**` | App-local raw client setup, platform bridges, native wrappers, auth/storage integration. | Product UI state, product branching, shared package logic. | [guides/access.md](guides/access.md) |
| App product rules | `<app>/src/lib/domain/<domain>/<subdomain>/**` | Pure app-local product rules. | React, stores, query clients, access helpers, platform APIs. | [guides/lib.md](guides/lib.md) |
| App workflows | `<app>/src/lib/workflows/<domain>/**` | Non-React product sequences with dependencies passed in. | React hooks, hidden singletons, raw endpoint construction. | [guides/lib.md](guides/lib.md) |
| Infra | `<app>/src/lib/infra/<technical-concern>/**` | Generic technical machinery: persistence, scheduling, ids, batching, measurement. | Product-domain behavior. | [guides/lib.md](guides/lib.md) |
| Providers | `<app>/src/providers/**` | Scoped dependencies and app/subtree boundaries. | General mutable UI state. | [guides/state.md](guides/state.md) |
| Stores | `<app>/src/stores/<domain>/**` | Shared client-only state: selected ids, drafts, panels, local UI preferences. | Remote caches, APIs, navigation, telemetry, multi-store orchestration. | [guides/state.md](guides/state.md) |
| Config | `<app>/src/config/**` | Static constants, limits, option sets, default ids, ordering. | Copy, presentation mappings, runtime state. | [guides/config.md](guides/config.md) |
| Copy | `<app>/src/copy/**` | Authored user-facing copy and prompt/content strings. | Logic, access, status-to-style mappings. | [guides/copy.md](guides/copy.md) |
| Styling | `<app>/src/styles/**`, `<app>/src/index.css` | App-local style entrypoints, native token bridge, app-specific third-party CSS. | Shared tokens or reusable DOM primitives. | [guides/styling.md](guides/styling.md) |
| Telemetry | `<app>/src/hooks/**`, `<app>/src/lib/**`, `<app>/src/providers/**` | Product event wiring and replay/privacy boundaries at the owning app layer. | Hidden tracking inside shared product UI. | [guides/telemetry.md](guides/telemetry.md) |
| Design package | `apps/packages/design/**` | Shared tokens, DOM CSS entrypoint, React Native-safe token values. | Product concepts, app code, SDK clients. | [packages/README.md](packages/README.md) |
| UI package | `apps/packages/ui/**` | Canonical Desktop/Web DOM primitives and layout components. | Product concepts, app code, SDK clients, stores, React Native. | [packages/README.md](packages/README.md) |
| Product domain package | `apps/packages/product-domain/**` | Pure shared product rules, vocabulary, validation, projections, view models. | React, DOM, React Native components, SDK clients, query clients, stores, access. | [packages/README.md](packages/README.md) |
| Product UI package | `apps/packages/product-ui/src/<domain>/<surface>/**` | Shared Desktop/Web product presentation. Props in, callbacks out. | SDK clients, access helpers, query hooks, app stores, routes, Tauri, React Native, custom primitive redefinitions. | [packages/README.md](packages/README.md) |
| Product surfaces package | `apps/packages/product-surfaces/src/<domain>/<surface>/**` | Shared connected Desktop/Web Cloud surfaces with SDK/query wiring and product UI composition. | Desktop/Web app internals, Tauri, AnyHarness runtime wiring, app stores, app routes, React Native, custom primitive redefinitions. | [packages/README.md](packages/README.md) |

## Read Order

Always start with this file. Then read the focused guide or package doc for the
layer you are changing:

- [guides/components.md](guides/components.md)
- [guides/hooks.md](guides/hooks.md)
- [guides/state.md](guides/state.md)
- [guides/lib.md](guides/lib.md)
- [guides/access.md](guides/access.md)
- [guides/config.md](guides/config.md)
- [guides/copy.md](guides/copy.md)
- [guides/styling.md](guides/styling.md)
- [guides/telemetry.md](guides/telemetry.md)
- [packages/README.md](packages/README.md)

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
  state. `lib/domain` and `product-domain` hold pure product rules.
- Desktop, Web, `product-ui`, and `product-surfaces` use
  `apps/packages/ui/**` for DOM primitives.
- Do not define DOM primitive components outside `apps/packages/ui/**`. This
  includes differently named local wrappers around buttons, inputs, dialogs,
  menus, tabs, tooltips, badges, layout shells, or similar reusable controls.
- Desktop and Web share product presentation through `product-ui` and connected
  Cloud surfaces through `product-surfaces` when sharing keeps the product more
  legible.
- Mobile shares product rules through `product-domain` and renders native UI in
  the app.
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
apps
  -> product-surfaces
  -> product-ui
  -> ui
  -> design

apps
  -> product-domain
product-surfaces -> product-domain
product-ui -> product-domain
```

`product-domain` is pure. It does not import React, DOM, React Native, SDK
clients, access helpers, stores, or query clients. `product-ui` is
presentational DOM UI. It does not import app code, raw access, stores, routes,
or SDK clients. `product-surfaces` may use shared Cloud SDK React hooks for
Desktop/Web surfaces, but it must not import app internals.

## CI-Enforced Repo Shape

Frontend ownership boundaries are enforced by
`scripts/check_frontend_boundaries.py` in CI. The repo-shape job should enforce
the ownership rules in this document.

React Query cache shape is owned by access hooks by default. The only
product-domain exception is a product-composed cache under
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
