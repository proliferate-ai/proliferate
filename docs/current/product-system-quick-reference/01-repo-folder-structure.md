# Repo / Folder Structure

Status: quick-reference study packet. This file covers broad ownership rules
and file paths only. It intentionally skips DB model detail.

Canonical sources:

- `docs/README.md`
- `docs/server/README.md`
- `docs/anyharness/README.md`
- `docs/frontend/README.md`
- `docs/sdk/README.md`
- `docs/reference/dev-profiles.md`

## Top-Level Map

```text
anyharness/crates/**        Rust runtime stack: runtime, contract, worker, supervisor.
anyharness/sdk/**           TypeScript AnyHarness SDK.
anyharness/sdk-react/**     Generic React Query bindings for AnyHarness.
server/**                   FastAPI cloud control plane and artifact runtime.
cloud/sdk/**                TypeScript Proliferate Cloud SDK.
cloud/sdk-react/**          React Query bindings for Cloud.
desktop/src/**              Desktop React product app.
desktop/src-tauri/**        Tauri shell, native commands, sidecars.
web/src/**                  Hosted web cloud client.
mobile/src/**               Expo / React Native cloud client.
packages/design/**          Shared tokens and DOM/RN-safe design values.
packages/ui/**              Generic Desktop/Web DOM primitives.
packages/product-model/**   Pure shared product logic and view models.
packages/product-ui/**      Shared Desktop/Web product UI.
docs/**                     Authoritative docs, specs, and quick refs.
scripts/**                  Generation, dev profile, and boundary scripts.
catalogs/**                 Catalog assets/configuration.
install/**                  Install/update support.
```

## Server

Primary app root:

```text
server/proliferate/**
```

Core paths:

```text
server/proliferate/main.py
server/proliferate/config.py
server/proliferate/constants/**
server/proliferate/auth/**
server/proliferate/integrations/**
server/proliferate/middleware/**
server/proliferate/db/models/**
server/proliferate/db/store/**
server/proliferate/server/<domain>/**
server/artifact-runtime/src/**
server/proliferate/server/artifact_runtime/static/**
```

Domain shape:

```text
api.py          HTTP transport only.
service.py      orchestration, transactions, domain flow.
models.py       Pydantic request/response schemas.
access.py       FastAPI deps and resource access checks.
domain/**       pure sync product rules.
worker.py       non-HTTP execution entrypoint when needed.
```

Rules:

- API files stay thin.
- SQL lives in `db/store/**`.
- ORM definitions live in `db/models/**`.
- Pydantic wire models live with the owning server domain.
- Product services catch integration errors and translate them to domain errors.
- Integrations are leaves; product logic should not live in vendor clients.

Current server product areas:

```text
server/proliferate/server/ai_magic/**
server/proliferate/server/analytics/**
server/proliferate/server/anonymous_telemetry/**
server/proliferate/server/artifact_runtime/**
server/proliferate/server/automations/**
server/proliferate/server/billing/**
server/proliferate/server/catalogs/**
server/proliferate/server/cloud/**
server/proliferate/server/organizations/**
server/proliferate/server/support/**
```

Important Cloud subdomains:

```text
agent_auth/
agent_run_config/
backfill/
capabilities/
claims/
commands/
compute/
events/
live/
mcp_catalog/
mcp_connections/
mcp_oauth/
mobility/
plugins/
repo_config/
repos/
runtime/
runtime_config/
sandbox_profiles/
skills/
slack/
target_config/
target_git_identity/
targets/
webhooks/
worker/
workspaces/
worktree_policy/
```

## AnyHarness

Crate ownership:

```text
anyharness/crates/anyharness/**
  Thin binary: CLI, logging, runtime home, serve, OpenAPI print.

anyharness/crates/anyharness-contract/**
  Public HTTP/SSE/WS schemas and OpenAPI-visible types.

anyharness/crates/anyharness-lib/**
  Runtime implementation.

anyharness/crates/anyharness-credential-discovery/**
  Provider credential discovery and portable auth normalization.

anyharness/crates/proliferate-worker/**
  Cloud target worker: command dispatch, materialization, event sync.

anyharness/crates/proliferate-supervisor/**
  Managed runtime/worker install, update, restart supervision.
```

`anyharness-lib` layer rules:

```text
api/**              transport only: handlers, routers, auth, SSE/WS, OpenAPI.
app/**              service composition and app state wiring.
domains/**          durable product meaning.
live/**             running actors, handles, registries.
adapters/**         local machine capabilities: file/git/process/hosting.
integrations/**     protocol/vendor mechanics: ACP, MCP, agent CLIs.
persistence/**      SQLite setup/migrations and infra.
observability/**    tracing, latency, diagnostics.
```

Transitional paths still exist:

```text
sessions/**
workspaces/**
repo_roots/**
terminals/**
acp/**
```

New ownership should move toward `domains/**`, `live/**`, `adapters/**`, and
`integrations/**` only when the extraction is earned.

Core session flow:

```text
api/http/sessions
  -> SessionRuntime
  -> SessionService / SessionStore
  -> LiveSessionManager
  -> LiveSessionHandle
  -> SessionActor
  -> AcpClient
  -> SessionEventSink
  -> InteractionBroker
```

## Desktop

```text
desktop/src/components/**         Product UI; `.tsx` only.
desktop/src/components/ui/**      Desktop-only primitives.
desktop/src/hooks/access/**       React Query/mutation access wrappers.
desktop/src/hooks/<domain>/**     React behavior by responsibility.
desktop/src/lib/access/**         Raw cloud/AnyHarness/Tauri wrappers.
desktop/src/lib/domain/**         Pure product rules.
desktop/src/lib/workflows/**      Non-React injected-dependency sequences.
desktop/src/stores/**             Client-only Zustand state.
desktop/src-tauri/src/commands/** Native commands behind Tauri wrappers.
```

Rules:

- Components render.
- Hooks own React behavior, effects, query/mutation wiring, and UI orchestration.
- Stores hold client-only state, not remote caches or service layers.
- Raw external access belongs in `lib/access/**`.
- Reusable product rules belong in `lib/domain/**` or shared packages.
- Frontend should call Tauri through `desktop/src/lib/access/tauri/**`.

## Web

```text
web/src/pages/**
web/src/components/**
web/src/lib/access/cloud/**
web/src/lib/domain/**
web/src/providers/**
web/src/lib/integrations/telemetry/**
```

Rules:

- Web is a Cloud-mediated client.
- Web should reuse `packages/product-ui/**` for shared Desktop/Web presentation.
- Web should not create parallel product visuals when shared UI can own them.
- Web-specific auth/client/pending prompt behavior lives under `web/src/lib/access/cloud/**`.

## Mobile

```text
mobile/src/components/**
mobile/src/navigation/**
mobile/src/lib/access/cloud/**
mobile/src/lib/domain/**
mobile/src/providers/**
mobile/src/stores/**
mobile/src/styles/**
mobile/src/lib/integrations/telemetry/**
```

Rules:

- Mobile is a Cloud-mediated React Native client.
- Mobile does not import DOM `packages/product-ui`.
- Mobile-safe pure rules live in `mobile/src/lib/domain/**` or `packages/product-model`.
- Mobile cloud access/pending prompt behavior lives under `mobile/src/lib/access/cloud/**`.

Mobile reuses:

```text
@proliferate/product-model
@proliferate/cloud-sdk
@proliferate/cloud-sdk-react
@proliferate/design/react-native
```

## Shared Packages

```text
packages/design/src/tokens.ts
packages/design/src/dom.css
packages/design/src/react-native.ts
```

`packages/design` owns shared design values. DOM CSS is for Desktop/Web;
`react-native.ts` is the mobile-safe entrypoint.

```text
packages/ui/src/**
```

`packages/ui` owns generic DOM primitives. It should not know product concepts.

```text
packages/product-model/src/**
```

`packages/product-model` owns pure shared product logic. No React, DOM, stores,
query clients, SDK clients, or raw access.

```text
packages/product-ui/src/**
```

`packages/product-ui` owns shared Desktop/Web product presentation. It receives
data and callbacks. It should not construct clients, own stores, or do query
wiring.

## SDKs

```text
anyharness/sdk/**
anyharness/sdk-react/**
cloud/sdk/**
cloud/sdk-react/**
```

Rules:

- SDKs own transport clients, generated types, stream helpers, and generic resource helpers.
- React SDK packages own generic query/mutation hooks and providers.
- Product-specific UI composition belongs in apps or product packages, not SDKs.

## Generated Boundaries

Do not hand-edit:

```text
anyharness/sdk/generated/openapi.json
anyharness/sdk/src/generated/openapi.ts
cloud/sdk/src/generated/openapi.ts
server/openapi.json
packages/design/dist/theme.css
server/proliferate/server/artifact_runtime/static/**
*/dist/**
```

Regenerate with the owning tool:

```text
make sdk-generate
pnpm --filter @anyharness/sdk generate
make cloud-client-generate
pnpm --filter @proliferate/design build
pnpm --filter @proliferate/artifact-runtime build
```

## Dev Profiles

Use local full-stack profiles for multi-worktree development:

```bash
make dev-init PROFILE=<name>
make dev-list
make dev PROFILE=<name>
make dev PROFILE=<name> STRIPE=1
```

Profile state:

```text
~/.proliferate-local/dev/profiles/<name>/
~/.proliferate-local/runtimes/<name>/
```

Read `docs/reference/dev-profiles.md` before changing profile launch behavior,
ports, generated Tauri config, or dev app identity.

## Review Questions

- What belongs in `server/proliferate/server/<domain>/**` versus `db/store/**`?
- What is the boundary between AnyHarness `domains/**`, `live/**`, and `integrations/**`?
- When should shared code go in `packages/product-model` versus `packages/product-ui`?
- Why must mobile avoid DOM product UI imports?
- Which files are generated and must never be hand-edited?
- What docs must you read before touching server, frontend, SDK, or AnyHarness code?

