# Frontend Mental Model

Status: orientation primer for the frontend structure. The per-layer guides in
this folder and `packages/README.md` are authoritative; this doc is the lens
that makes them cohere. Read [../README.md](../README.md) first, then this, then
the focused guide for the layer you are changing.

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
| **Work** | logic | `lib/domain/**`, `lib/workflows/**`, `lib/infra/**` |
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
| **Domain** | `lib/domain/**` | `(data) -> decision` | validation, projections, view models, presentation maps, reducers, side-effect *planners* |
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
  `lib/domain/**/presentation.ts` (or `product-domain` if shared).
- **Telemetry** is spread by layer with one tree and one provider: providers own
  bootstrap, hooks emit typed events and capture exceptions, the event catalog
  is `lib/domain/telemetry`, transport is `lib/integrations/telemetry`.
  Components do not import telemetry. Payloads stay low-cardinality and carry no
  prompts, paths, repo names, or secrets.

## Shared Packages

Two foundations plus a three-layer DOM stack. See
[../packages/README.md](../packages/README.md) for the authoritative table.

```text
DOM stack (Desktop/Web):        Foundations (consumed by everyone):
  product-surfaces   connected    product-domain   pure shared rules
  product-ui         presentation                   (the Mobile sharing point)
  ui                 primitives    design           tokens + css (the look)
  design             css/tokens
```

- **design** - shared design *values*, not just css: tokens, DOM css, and
  React-Native-safe token values. Mobile consumes the tokens, not the css.
- **ui** - the single DOM primitive system (Button, Dialog, Input, layout).
  Hard invariant: no DOM primitive is defined anywhere else, even a renamed
  wrapper. Need a variant? Add it to `ui`.
- **product-ui** - presentational product components: data in, callbacks out.
  Composes `ui` + `product-domain`. No SDK, access, stores, or routes.
- **product-surfaces** - the *connected* sibling of `product-ui`: product
  presentation wired to **Cloud** (SDK React hooks + mutations). No app stores,
  routes, Tauri, or local AnyHarness runtime - those are passed in as callbacks.
  It is small by design; most surfaces need local runtime and stay app-local.
- **product-domain** - pure shared decisions, the twin of app `lib/domain`, and
  the primary sharing point for Mobile. No React, DOM, SDK clients, or stores.

Platform matrix: Desktop/Web use all five; Mobile uses only `design`
(react-native tokens), `product-domain`, and SDK packages - never the DOM
packages.

## The Placement Algorithm

Three questions, in order, give every file exactly one home.

1. **What substance is this?** state / access / pure work / render / content.
2. **What is the source of truth, and who else needs it?** Places state and
   decides whether a decision is shared (`product-domain`) or app-local
   (`lib/domain`).
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
