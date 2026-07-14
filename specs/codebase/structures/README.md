# Codebase Structures

Status: authoritative index for system structure specs.

Structure specs own folder rules, dependency direction, code maps, and
ownership boundaries. They do not own complete systems, reusable platforms, or
operator procedures; those belong under `systems/`, `platforms/`, and
`developing/`.

## System Map

| System | Owns | Read |
| --- | --- | --- |
| Frontend apps and shared packages | Desktop/Web/Mobile app structure, React layers, shared frontend packages, styling, copy, telemetry, access boundaries, and product UI/package dependency direction. | [frontend/README.md](frontend/README.md), [frontend/packages/README.md](frontend/packages/README.md), focused guides under [frontend/guides/](frontend/guides/) |
| Desktop native | Tauri shell, native commands, bundled resources, AnyHarness sidecar launch, profile app identity, and desktop release resources. | [desktop-native/README.md](desktop-native/README.md), specs under [desktop-native/specs/](desktop-native/specs/) |
| AnyHarness runtime | HTTP/SSE APIs, session/workspace orchestration, live runtime, harness adapters, MCP runtime integration, persistence, observability, contract schemas, and runtime crate ownership. | [anyharness/README.md](anyharness/README.md), [anyharness/contract.md](anyharness/contract.md), guides under [anyharness/guides/](anyharness/guides/), specs under [anyharness/specs/](anyharness/specs/) |
| Proliferate Worker | Cloud target runtime worker process, command downlink, event uplink, target status, materialization, clients, store, identity, and root support. | [proliferate-worker/README.md](proliferate-worker/README.md), guides under [proliferate-worker/guides/](proliferate-worker/guides/) |
| Proliferate Supervisor | Target process supervisor, worker/runtime spawn loops, install layout, service generation, update staging, rollback, and target smoke behavior. | [proliferate-supervisor/README.md](proliferate-supervisor/README.md) |
| Server | FastAPI/cloud control plane domains, API/service/store layering, auth/resource access boundaries, database access, workers, integrations, config, and error shape. | [server/README.md](server/README.md), guides under [server/guides/](server/guides/) |
| SDKs | AnyHarness TypeScript SDK generation/build ownership, generated-code boundaries, React SDK ownership, and contract-consumer rules. | [sdk/README.md](sdk/README.md) |
| Auth Gateway (split-owned today) | Product account auth, server auth/resource access, and agent LLM gateway/BYOK/managed-credit materialization. | [../systems/product/auth/README.md](../systems/product/auth/README.md), [server/guides/auth.md](server/guides/auth.md), [../platforms/product/agent-auth.md](../platforms/product/agent-auth.md), [../platforms/product/agent-auth-bifrost-byok.md](../platforms/product/agent-auth-bifrost-byok.md); see note below |

## Auth Gateway Ownership

There is no standalone `auth-gateway` structure spec today. Current ownership is
split by boundary:

- Product account authentication and readiness gates live in
  [../systems/product/auth/README.md](../systems/product/auth/README.md).
- Server authentication, resource access, authorization helpers, and product
  policy layering live in [server/guides/auth.md](server/guides/auth.md).
- Agent LLM gateway, BYOK, managed credits, and sandbox auth materialization
  live in [../platforms/product/agent-auth.md](../platforms/product/agent-auth.md) and
  [../platforms/product/agent-auth-bifrost-byok.md](../platforms/product/agent-auth-bifrost-byok.md).

Create a dedicated `structures/auth-gateway/` spec only if the gateway becomes
a separately deployed or separately owned codebase boundary. Until then, keep
auth-gateway edits in the owning product, server, and platform docs above.

## Adding A Structure Spec

Add or split a structure spec when a system has its own:

- source tree or crate/package ownership boundary
- dependency direction rules
- generated-code or external access boundary
- build/test/release behavior
- reusable code map that multiple system or platform specs need to reference

Do not add a structure spec just to track a user-facing workflow. User-facing
workflow ownership belongs under [../systems/product/](../systems/product/), even when the
implementation crosses several structures.
