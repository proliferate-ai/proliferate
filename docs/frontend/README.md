# Frontend Standards

Status: authoritative for frontend code in this repo.

Scope:

- `desktop/src/**`

Use this doc first to understand the frontend ownership model. Then read the
layer doc and any surface spec that applies to the code you are changing.

## North Star

The frontend is organized for legibility by file path. When a developer sees a
file location, they should know what kind of logic is allowed there before
opening the file. When something breaks or needs to change, they should know
where to look first.

Structural rules are not aesthetic. They prevent mixed-ownership files from
becoming god modules that nobody can change confidently.

The single rule behind this guide:

> A file should be readable cold. A contributor should be able to open the top
> file in a feature and understand what it owns, what it exposes, and where the
> real work lives. If understanding the file requires following imports through
> unrelated layers, the structure is wrong.

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
  utilities, and side-effect planners.
- [guides/config.md](guides/config.md) for static constants, limits, option
  sets, route ids, defaults, and ordering.
- [guides/copy.md](guides/copy.md) for authored user-facing copy and reusable
  presentation mappings.
- [guides/access.md](guides/access.md) for cloud, AnyHarness, and Tauri access
  boundaries.
- [guides/styling.md](guides/styling.md) for styling, theme tokens,
  primitives, and theme usage.
- [guides/telemetry.md](guides/telemetry.md) for analytics, Sentry, replay
  masking, or telemetry payloads.

Specs define product/surface contracts: UX invariants, performance invariants,
edge cases, and focused verification for a specific product surface.

Specs:

- [specs/delegated-work.md](specs/delegated-work.md) for subagents, cowork
  agents, plan review agents, code review agents, tab indicators, delegated
  work popovers, and delegated-work delete semantics.
- [specs/chat-composer.md](specs/chat-composer.md) for the chat composer area.
- [specs/chat-transcript.md](specs/chat-transcript.md) for transcript
  streaming, replay, row models, or long-history rendering.
- [specs/pending-workspace-shell.md](specs/pending-workspace-shell.md) for
  pending workspace entry, projected session shell, optimistic prompts, and
  workspace/session materialization handoff.
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
      mcp/
      tauri/
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
focused doc that owns the layer. And only update this after getting permission from a human.

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
- Product hook domains are organized by responsibility folders. New
  non-migration hook files should not sit directly under `hooks/<domain>/`.
- Preserve current UI and behavior unless an explicit behavior change is
  requested.
- Delete dead code when replacing an implementation.
- Move toward the target architecture incrementally. Do not create empty
  folder trees or speculative abstractions.
- Cleanup PRs should state whether they are behavior-preserving extractions or
  behavior changes. Do not mix both unless the task explicitly requires it.
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
| Product UI-mechanic hooks | `hooks/<domain>/ui/**` | It wraps UI mechanics that are specific to one product domain. | Generic browser mechanics or product workflows. | [guides/hooks.md](guides/hooks.md) |
| Product cache hooks | `hooks/<domain>/cache/**` | It owns a product-composed cache that combines multiple external/local sources. | One-resource external query wrappers or raw access. | [guides/hooks.md](guides/hooks.md), [guides/access.md](guides/access.md), [guides/state.md](guides/state.md) |
| Shared client state | `stores/<domain>/<concern>-store.ts` | It is client-only state such as selected ids, drafts, panels, or active UI. | Server/runtime caches, API calls, navigation, telemetry, or multi-store orchestration. | [guides/state.md](guides/state.md) |
| Scoped dependencies | `providers/**` | It defines an app/subtree context boundary. | General mutable UI state. | [guides/state.md](guides/state.md) |
| Pure product rules | `lib/domain/<domain>/<subdomain>/**` | It is deterministic product logic with no React or external access. | Hooks, stores, clients, query invalidation, platform APIs. | [guides/lib.md](guides/lib.md) |
| Plain product workflows | `lib/workflows/<domain>/**` | It is a non-React sequence coordinating dependencies passed by a hook. | React hooks or hidden singleton client construction. | [guides/lib.md](guides/lib.md) |
| Raw external access | `lib/access/<system>/**` | `lib/access` owns raw cloud, AnyHarness desktop wiring, and Tauri native wrappers. | Product UI state, product branching, or components. | [guides/access.md](guides/access.md) |
| Technical utilities | `lib/infra/<technical-concern>/**` | It is generic machinery such as persistence, scheduling, ids, batching, or measurement. | Product-domain behavior. | [guides/lib.md](guides/lib.md) |
| Static constants | `config/**` | It is a real constant, limit, option set, default id, or ordering. | Copy, status labels, presentation metadata, or runtime state. | [guides/config.md](guides/config.md) |
| Product copy | `copy/<domain>/**` | It is user-facing text or authored prompt content. | Logic, access, or status-to-style mappings. | [guides/copy.md](guides/copy.md) |
| Presentation mappings | `lib/domain/<domain>/<subdomain>/presentation.ts` | It maps product state to labels, tone, icons, descriptions, or visibility. | Transport access or mutable UI state. | [guides/copy.md](guides/copy.md) |

## Dependency Direction

- Components may call hooks and render UI primitives.
- Product hooks may read stores/providers, call access hooks, and call
  `lib/domain` or `lib/workflows` functions.
- Product hooks do not own React Query key definitions or query cache shape.
  They call access hooks/cache callbacks when a workflow needs remote state
  invalidated or updated.
- Stores do not call hooks, clients, query invalidation, navigation, telemetry,
  or other stores.
- `lib/domain` does not import React, stores, query clients, access helpers, or
  platform APIs.
- `lib/workflows` may coordinate multiple dependencies, but those dependencies
  are passed in. It does not import React hooks.
- Raw cloud, AnyHarness, and Tauri access stays behind the access boundary.

Dependency direction is one-way:

```text
components -> hooks -> lib/workflows -> lib/domain/lib/infra -> lib/access
```

Stores are read by hooks. `lib/**` files do not read stores directly unless a
focused area doc explicitly marks the file as a transitional state adapter.

## CI-Enforced Repo Shape

Frontend ownership boundaries are enforced by
`scripts/check_frontend_boundaries.py` in CI. The check is a ratchet: existing
violations live in `scripts/frontend_boundaries_allowlist.txt`, and new
violations fail the repo-shape job.

The allowlist is temporary migration debt. Cleanup PRs should remove allowlist
entries whenever they move a path to the target architecture or reduce the
number of violations in that file.

React Query cache shape is owned by access hooks by default. The only
product-domain exception is a product-composed cache under
`hooks/<domain>/cache/**`; ordinary workflow, lifecycle, derived, and component
files should call access/cache callbacks instead of importing `useQueryClient`
or hand-editing query keys.

## Cleanup Discipline

- Move ownership violations before introducing new abstractions.
- Do not leave duplicate old and new paths behind after a migration.
- Do not create one-file folders or empty target trees to satisfy a diagram.
- Prefer one bounded product area per PR.
- Keep public hook/component APIs stable unless the cleanup explicitly changes
  callsites.
- When splitting a file, preserve behavior first; improve behavior in a
  separate PR.
- Use focused tests around moved domain/workflow logic when the logic is
  meaningful or risky.
