# Frontend Standards

Status: authoritative for frontend code in this repo.

Scope:

- `desktop/src/**`

Use this doc first to understand the frontend ownership model. Then read the
focused doc for the layer or surface you are changing.

## Read Order

Always start here, then read the relevant focused docs:

- [components.md](components.md) for component ownership, UI primitives, and
  component folder hierarchy.
- [hooks.md](hooks.md) for hook taxonomy, hook organization, and React behavior
  ownership.
- [state.md](state.md) for Zustand stores, React Query, providers, and local
  state.
- [lib.md](lib.md) for pure product logic, workflows, infra utilities, config,
  copy, and presentation mappings.
- [access.md](access.md) for cloud, AnyHarness, and Tauri access boundaries.
- [styling.md](styling.md) for styling, theme tokens, primitives, and theme
  usage.
- [telemetry.md](telemetry.md) for analytics, Sentry, replay masking, or
  telemetry payloads.
- [chat-composer.md](chat-composer.md) for the chat composer area.
- [chat-transcript.md](chat-transcript.md) for transcript streaming, replay,
  row models, or long-history rendering.
- [workspace-files.md](workspace-files.md) for workspace file browsing, file
  viewing, diff viewing, Changes, or all-changes review.

## Target Shape

This is the target architecture. Some existing code is still transitional; new
code and cleanup work should move toward this shape.

```text
desktop/src/
  App.tsx
  main.tsx
  assets/
  components/
    ui/
    <domain>/
  config/
  copy/
  hooks/
    access/
      anyharness/
      cloud/
      tauri/
    ui/
    <domain>/
      derived/
      workflows/
      lifecycle/
      facade/
  lib/
    access/
      anyharness/
      cloud/
      tauri/
    domain/
      <domain>/
    workflows/
      <domain>/
    infra/
  pages/
  providers/
  stores/
    <domain>/
  index.css
```

Do not add new top-level frontend folders without updating this doc and the
focused doc that owns the layer.

## Hard Rules

- Use `@/` imports for app-root paths under `desktop/src/**`.
- Keep imports direct and concrete. No barrel files or convenience re-export
  modules.
- `components/**` is `.tsx` only.
- `hooks/**`, `lib/**`, `stores/**`, `config/**`, `copy/**`, and
  `providers/**` are `.ts` only unless a file must render JSX.
- Pages are route entrypoints only: read params/navigation state, call
  page-level hooks, and render a screen component.
- Preserve current UI and behavior unless an explicit behavior change is
  requested.
- Delete dead code when replacing an implementation.
- Avoid god modules and god stores. Prefer splitting before roughly 400 lines.
  Files at 600+ lines need a strong reason to stay whole. Mixed ownership
  should be split even below those thresholds.
- Colocate types with the code that owns them. Generated API types live with
  the generated client. App-defined domain models live with their owning
  domain logic. Store types live with their store. Do not create shared type
  buckets.

## Ownership Model

Use the lowest layer that can own the logic cleanly.

| Concern | Owner | Rule of thumb |
| --- | --- | --- |
| Local presentational state | Component state | Keep it local when only one subtree needs it. |
| Shared client state | `stores/**` | Selection, panels, drafts, resize state, active ids, and other client-only state. |
| Remote state | TanStack Query | Authoritative server/runtime data that can be refetched. |
| React behavior | `hooks/**` | Effects, query/mutation wiring, route gates, workflow controllers, and derived UI state. |
| Scoped dependencies | `providers/**` | App/subtree boundaries such as query client, auth, telemetry, and runtime context. |
| Pure product rules | `lib/domain/**` | No React, JSX, stores, query clients, or external access. |
| Plain product workflows | `lib/workflows/**` | Non-React sequences that coordinate dependencies passed in by hooks. |
| External access | `lib/access/**` and access hooks | Cloud, AnyHarness, and Tauri boundaries. |
| Technical utilities | `lib/infra/**` | Generic machinery such as persistence, scheduling, measurement, ids, and batching. |
| Static constants | `config/**` | Real constants/options/limits/default ids/orderings. |
| Product copy | `copy/**` | User-facing words, copy variants, and authored prompt text. |

## Dependency Direction

- Components may call hooks and render UI primitives.
- Product hooks may read stores/providers, call access hooks, and call
  `lib/domain` or `lib/workflows` functions.
- Stores do not call hooks, clients, query invalidation, navigation, telemetry,
  or other stores.
- `lib/domain` does not import React, stores, query clients, access helpers, or
  platform APIs.
- `lib/workflows` may coordinate multiple dependencies, but those dependencies
  are passed in. It does not import React hooks.
- Raw cloud, AnyHarness, and Tauri access stays behind the access boundary.

## Migration Order

Keep migrations reviewable. Do not mix mechanical movement, access rewiring,
and deep behavioral hook cleanup in the same PR.

1. Architecture docs.
2. Config/copy/presentation split.
3. Component hierarchy cleanup.
4. Access boundary skeleton.
5. Move raw access behind access/query hooks.
6. `lib/domain`, `lib/workflows`, and `lib/infra` cleanup.
7. Hook cleanup by domain.
8. Tests, playground, and latency pass.
