# Frontend Standards

Status: authoritative for frontend code in this repo.

Scope:

- `desktop/src/**`

Use this doc first to understand the frontend ownership model. Then read the
layer doc and any surface spec that applies to the code you are changing.

## Read Order

Always start here.

Guides define reusable engineering standards: where code goes, what each layer
may own, and which patterns are allowed.

Guides:

- [guides/components.md](guides/components.md) for component ownership, UI
  primitives, and component folder hierarchy.
- [guides/hooks.md](guides/hooks.md) for hook taxonomy, hook organization, and
  React behavior ownership.
- [guides/state.md](guides/state.md) for Zustand stores, React Query,
  providers, and local state.
- [guides/lib.md](guides/lib.md) for pure product logic, workflows, infra
  utilities, config, copy, and presentation mappings.
- [guides/access.md](guides/access.md) for cloud, AnyHarness, and Tauri access
  boundaries.
- [guides/styling.md](guides/styling.md) for styling, theme tokens,
  primitives, and theme usage.
- [guides/telemetry.md](guides/telemetry.md) for analytics, Sentry, replay
  masking, or telemetry payloads.

Specs define product/surface contracts: UX invariants, performance invariants,
edge cases, and focused verification for a specific product surface.

Specs:

- [specs/chat-composer.md](specs/chat-composer.md) for the chat composer area.
- [specs/chat-transcript.md](specs/chat-transcript.md) for transcript
  streaming, replay, row models, or long-history rendering.
- [specs/workspace-files.md](specs/workspace-files.md) for workspace file
  browsing, file viewing, diff viewing, Changes, or all-changes review.

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
      <surface>/
        <role>/
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
        <subdomain>/
    workflows/
      <domain>/
    infra/
      <technical-concern>/
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
- Hooks are not the default extraction unit. Use hooks for React behavior; use
  plain functions for pure logic, product workflows, access helpers, and infra
  utilities.
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

| Concern | Path | Put it here when | Do not put here | Details |
| --- | --- | --- | --- | --- |
| Product UI | `components/<domain>/<surface>/<role>/**` | It renders product-specific UI. | Raw access, query invalidation, multi-step workflows, reusable product rules. | [guides/components.md](guides/components.md) |
| UI primitives | `components/ui/**` | It is reusable without product knowledge. | Product-specific copy, stores, access, or workflow behavior. | [guides/components.md](guides/components.md), [guides/styling.md](guides/styling.md) |
| Generic UI hooks | `hooks/ui/<mechanic>/**` | It wraps browser/UI mechanics with no product concepts. | Sessions, workspaces, cloud, agents, billing, or other product concepts. | [guides/hooks.md](guides/hooks.md) |
| Access hooks | `hooks/access/<system>/**` | It is a React Query/mutation wrapper around cloud, AnyHarness, or Tauri. | Product workflow branching or JSX. | [guides/hooks.md](guides/hooks.md), [guides/access.md](guides/access.md), [guides/state.md](guides/state.md) |
| Product derived hooks | `hooks/<domain>/derived/**` | It computes UI-ready state from stores, providers, and queries. | Writes, effects, raw access, navigation, or telemetry. | [guides/hooks.md](guides/hooks.md) |
| Product workflow hooks | `hooks/<domain>/workflows/**` | It exposes user-action callbacks and coordinates React dependencies. | Large business algorithms or raw clients. | [guides/hooks.md](guides/hooks.md) |
| Product lifecycle hooks | `hooks/<domain>/lifecycle/**` | It owns mounted effects, streams, dispatchers, polling, or reconciliation. | Render logic or user-click workflow branching. | [guides/hooks.md](guides/hooks.md) |
| Shared client state | `stores/<domain>/<concern>-store.ts` | It is client-only state such as selected ids, drafts, panels, or active UI. | Server/runtime caches, API calls, navigation, telemetry, or multi-store orchestration. | [guides/state.md](guides/state.md) |
| Scoped dependencies | `providers/**` | It defines an app/subtree context boundary. | General mutable UI state. | [guides/state.md](guides/state.md) |
| Pure product rules | `lib/domain/<domain>/<subdomain>/**` | It is deterministic product logic with no React or external access. | Hooks, stores, clients, query invalidation, platform APIs. | [guides/lib.md](guides/lib.md) |
| Plain product workflows | `lib/workflows/<domain>/**` | It is a non-React sequence coordinating dependencies passed by a hook. | React hooks or hidden singleton client construction. | [guides/lib.md](guides/lib.md) |
| Raw external access | `lib/access/<system>/**` | It owns raw cloud, AnyHarness desktop wiring, or Tauri wrappers. | Product UI state, product branching, or components. | [guides/access.md](guides/access.md) |
| Technical utilities | `lib/infra/<technical-concern>/**` | It is generic machinery such as persistence, scheduling, ids, batching, or measurement. | Product-domain behavior. | [guides/lib.md](guides/lib.md) |
| Static constants | `config/**` | It is a real constant, limit, option set, default id, or ordering. | Copy, status labels, presentation metadata, or runtime state. | [guides/lib.md](guides/lib.md) |
| Product copy | `copy/<domain>/**` | It is user-facing text or authored prompt content. | Logic, access, or status-to-style mappings. | [guides/lib.md](guides/lib.md) |
| Presentation mappings | `lib/domain/<domain>/<subdomain>/presentation.ts` | It maps product state to labels, tone, icons, descriptions, or visibility. | Transport access or mutable UI state. | [guides/lib.md](guides/lib.md) |

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
