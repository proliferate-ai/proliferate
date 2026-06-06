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
Pure product decisions and models for **one app**. App-local; **promote a rule to `product-domain` when ≥2 apps need the same decision or view model** (app-local first).

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
integrations/telemetry/   sentry · posthog · anonymous · scrub · client · native-diagnostics · config
```

**Must not own:** product workflow branching · core-backend access (→ `access`) · React behavior (the provider/hook that consumes it lives above).

**Shape:** `lib/integrations/<provider>/<file>.ts`.

**Best practices:** one provider family per folder; keep product decisions *out* (pass them in); **scrub/redact at this boundary** (telemetry); generic local logging without a vendor belongs in `infra`.

### `lib/infra/**`
Generic technical machinery with **no product vocabulary and no vendor**.

**Owns:** persistence helpers · scheduling/batching/timers · ids/stable keys · measurement plumbing · safe JSON parsing · generic logging utilities.

**Must not:** know about chats/sessions/workspaces/agents/billing/repos/prompts (→ `domain`) · be a vendor integration like Sentry/PostHog (→ `integrations/telemetry`).

**Shape:** `lib/infra/<technical-concern>/<helper>.ts`.

## Rules (hard)

- **No `lib/**` file imports React, hooks, stores, providers, or query clients.** Hooks call lib; lib never calls hooks.
- `domain` is pure (data in/out); the moment it needs I/O, a client, or a store, it isn't domain.
- `workflows` reach the world only through `deps`, and `deps` are **capabilities, not pure helpers**.
- Keep the three access-ish layers distinct: **`access` = your backends · `integrations` = third-party providers · `infra` = no external system.**
- **App-local first:** promote a pure rule to `product-domain` only when ≥2 apps need it.
- No `utils.ts`/`helpers.ts`/`misc.ts` — name the concept.

## Placement & testing

- Pure decision/model/reducer/**planner** → `domain` (or `product-domain` if shared).
- Multi-step sequence → `workflows`.
- Raw backend/platform access → `access`.
- Third-party provider wiring → `integrations`.
- Generic machinery → `infra`.
- **Everything in `lib` is non-React → unit-test functions directly** (`domain` purely, `workflows` via `(input, deps)`); no rendering. Tests live beside risky domain/workflow logic.