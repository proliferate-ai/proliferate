# SDK Standards

Status: authoritative for the AnyHarness SDK layers in this repo.

Scope:

- `anyharness/sdk/**`
- `anyharness/sdk-react/**`

Use this doc to decide where new SDK logic goes and what rules it must follow.

## 1. File Tree

```text
anyharness/
  sdk/
    src/
      index.ts
      client/
        core.ts
        runtime.ts
        agents.ts
        providers.ts
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
        providers.ts
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
        providers.ts
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

Use this as the default shape. `@anyharness/sdk` is the core TypeScript
package. `@anyharness/sdk-react` is the generic React and TanStack Query layer
on top of it.

## 2. Non-Negotiable Rules

- `@anyharness/sdk` is pure TypeScript only.
- The core SDK must not depend on React, TanStack Query, Zustand, Tauri, or
  app code.
- `@anyharness/sdk-react` owns generic React-facing bindings for AnyHarness.
- `@anyharness/sdk-react` must not depend on product policy, app stores, Tauri
  APIs, or synthetic workspace logic.
- Keep the public core client API resource-grouped.
- Keep one clear public API per package. Do not preserve duplicate flat legacy
  methods or duplicate wrapper layers.
- `src/index.ts` is the curated public surface for each package.
- Generated OpenAPI files must not be hand-edited.
- Rust contract types are the source of truth for HTTP request, response, and
  resource shapes.
- `generated/openapi.json` and `src/generated/openapi.ts` are checked-in
  generated artifacts and must be regenerated when the Rust contract changes.
- SDK HTTP wrapper types in `src/types/*.ts` must alias generated OpenAPI
  schemas instead of hand-maintained mirrors.
- Hand-authored public types should exist only when they materially improve the
  API for non-contract client helpers, reducer state, or streaming helpers.
- Low-level streaming helpers and transcript reducers stay in
  `@anyharness/sdk`.
- Generic React providers, query hooks, mutation hooks, and query keys stay in
  `@anyharness/sdk-react`.

## 3. Ownership Model

Use the lowest package that can own the behavior cleanly.

| Concern | Owner | Rule of thumb |
| --- | --- | --- |
| Typed AnyHarness HTTP and resource operations | `@anyharness/sdk` | Add resource-grouped client methods under `src/client/**`. |
| Generated wire contract types | `@anyharness/sdk` | Treat `src/generated/openapi.ts` as generated input only. |
| SDK-facing public types | `@anyharness/sdk` | Prefer thin aliases first; only hand-author when the public API gets meaningfully better. |
| Low-level streams and reducers | `@anyharness/sdk` | Keep transport, event replay, and transcript reduction framework-agnostic. |
| Generic React providers | `@anyharness/sdk-react` | Runtime and workspace scope only. Providers take resolved inputs from the app, not app stores directly. |
| Generic React queries, mutations, query keys, and client cache helpers | `@anyharness/sdk-react` | Reads use `useQuery`, writes use `useMutation`, and invalidation stays with the owning mutation hook. |
| App-specific orchestration and product policy | app layer | Store coordination, preferences, telemetry, onboarding, Tauri flows, and workflow logic stay out of both SDK packages. |

Package split:

- `@anyharness/sdk` owns typed client methods, transport behavior, public SDK
  types, generated contract types, low-level streams, and generic reducers.
- `@anyharness/sdk-react` owns generic React providers plus generic query and
  mutation hooks layered on top of the core SDK.
- App code composes both packages and owns product-specific orchestration.

## 4. Folder Guide

Use these folder notes after the ownership model above has already told you
which package should own the behavior.

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
