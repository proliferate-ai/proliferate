# Codebase Structures

Source-area organization now lives with each owner under `specs/<owner>/`, not
in this directory. This file is a pointer index only: it maps a source area to
the owner document that holds its folder rules, dependency direction, code map,
and ownership boundaries. Nothing under `structures/` owns content anymore.

## System Map

| System | Owns | Read |
| --- | --- | --- |
| Frontend apps and shared packages | Desktop/Web/Mobile app structure, React layers, shared frontend packages, styling, copy, telemetry, access boundaries, and product UI/package dependency direction. | [specs/frontend/README.md](../../frontend/README.md), plus the focused files beside it (`packages.md`, `styling.md`, `state.md`, `hooks.md`, ...) |
| Desktop native | Tauri shell, native commands, bundled resources, AnyHarness sidecar launch, profile app identity, and desktop release resources. | [specs/desktop-native.md](../../desktop-native.md) |
| AnyHarness runtime | HTTP/SSE APIs, session/workspace orchestration, live runtime, harness adapters, MCP runtime integration, persistence, observability, contract schemas, and runtime crate ownership. | [specs/anyharness/README.md](../../anyharness/README.md), plus the focused files beside it (`contract.md`, `api.md`, `domains.md`, `live-runtime.md`, ...) |
| Proliferate Worker | Optional cloud/desktop runtime sidecar for enrollment, heartbeat, version-divergence observation (mailbox update requests for Proliferate Supervisor), integration-gateway credentials, and local identity. | [specs/worker.md](../../worker.md) |
| Proliferate Supervisor | Target process supervisor, worker/runtime spawn loops, install layout, service generation, update staging, rollback, and target smoke behavior. | [specs/supervisor.md](../../supervisor.md) |
| Server | FastAPI/cloud control plane domains, API/service/store layering, auth/resource access boundaries, database access, workers, integrations, config, and error shape. | [specs/server/standards.md](../../server/standards.md), plus the focused files beside it (`auth.md`, `domains.md`, `database.md`, ...) |
| SDKs | AnyHarness TypeScript SDK generation/build ownership, generated-code boundaries, React SDK ownership, and contract-consumer rules. | [specs/sdk.md](../../sdk.md) |
| Auth Gateway (split-owned today) | Product account auth, server auth/resource access, and agent LLM gateway/managed-credit materialization. | [../systems/product/accounts/README.md](../systems/product/accounts/README.md) (owner; surface rules in [auth/README.md](../systems/product/auth/README.md)), [specs/server/auth.md](../../server/auth.md); see note below |

## Auth Gateway Ownership

There is no standalone `auth-gateway` structure spec today. Current ownership is
split by boundary:

- Product account authentication and readiness gates live in the `accounts`
  system spec, [../systems/product/accounts/README.md](../systems/product/accounts/README.md),
  with the surface rules in its section
  [../systems/product/auth/README.md](../systems/product/auth/README.md).
- Server authentication, resource access, authorization helpers, and product
  policy layering live in [specs/server/auth.md](../../server/auth.md).
- Agent LLM auth (key vault, selections, `state.json` delivery, per-harness
  application) is owned by the
  [agent_auth system spec](../systems/product/agent_auth/README.md)
  ([specs/FEATURE_DOCS/AGENT_AUTH.md](../../FEATURE_DOCS/AGENT_AUTH.md) is
  depth); the LiteLLM-backed managed model gateway is owned by the
  [model_gateway system spec](../systems/product/model_gateway/README.md)
  ([specs/FEATURE_DOCS/MODELS.md](../../FEATURE_DOCS/MODELS.md) is depth).

Create a dedicated auth-gateway owner document only if the gateway becomes a
separately deployed or separately owned codebase boundary. Until then, keep
auth-gateway edits in the owning product, server, and platform docs above.

## Adding A Source-Area Owner

A new owner document belongs under `specs/<owner>/` (or a single
`specs/<owner>.md` for a thin owner) when a system has its own:

- source tree or crate/package ownership boundary
- dependency direction rules
- generated-code or external access boundary
- build/test/release behavior
- reusable code map that multiple system or platform specs need to reference

Do not add an owner document just to track a user-facing workflow. User-facing
workflow ownership belongs under [../systems/product/](../systems/product/), even when the
implementation crosses several source areas. Do not add new files under
`structures/`; this index is the only thing left here.
