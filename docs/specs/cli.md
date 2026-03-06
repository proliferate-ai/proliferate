# CLI — System Spec

## 1. Scope & Purpose

### In Scope
- In-sandbox `proliferate` CLI behavior provided by `packages/sandbox-mcp`
- Service management commands (`services list|start|stop|restart|logs|expose`)
- Env spec application and scrub commands (`env apply|scrub`)
- Actions commands against gateway (`actions list|guide|run`)
- Sandbox-side auth/token wiring for CLI requests

### Out of Scope
- Removed local-machine CLI package (no longer shipped from this repo)
- Gateway internals beyond action endpoints (`actions.md`)
- Provider sandbox boot internals (`sandbox-providers.md`)

### Mental Models
- `proliferate` in this repo is a sandbox-side operator CLI, not a user-installed desktop CLI.
- Services/env commands call sandbox-mcp HTTP endpoints (`127.0.0.1:4000`).
- Actions commands call gateway endpoints using session-scoped auth.
- The CLI is a thin transport layer over sandbox and gateway APIs.

---

## 2. Core Concepts

### 2.1 Service Commands
- `services` commands are wrappers over `/api/services`, `/api/logs/:name`, and `/api/expose`.
- Restart semantics are stop + start using the current saved command/cwd.
- Logs are streamed using SSE and can follow continuously.

### 2.2 Env Commands
- `env apply` accepts a JSON spec and writes env files into workspace-scoped paths.
- Required keys must be present in env overrides or process env before any writes occur.
- Written env files are added to `.git/info/exclude`.
- `env scrub` deletes secret env files and the temporary override file.

### 2.3 Actions Commands
- `actions list` reads catalog from gateway `/actions/available`.
- `actions guide` retrieves provider-specific guides from `/actions/guide/:integration`.
- `actions run` invokes `/actions/invoke`; it prints immediate results or polls invocation status while pending.

### 2.4 Auth and Endpoints
- Sandbox API commands require `SANDBOX_MCP_AUTH_TOKEN` (or service token fallback).
- Actions commands require `PROLIFERATE_GATEWAY_URL` and `PROLIFERATE_SESSION_ID`.
- Token resolution happens server-side for provider integrations.

---

## 3. File Tree

```
packages/sandbox-mcp/src/
  cli/entrypoint.ts                  # CLI entrypoint
  cli/main.ts                        # command dispatcher
  cli/commands/services.ts           # services command handlers
  cli/commands/env.ts                # env apply/scrub handlers
  cli/commands/actions.ts            # gateway actions handlers
  cli/errors.ts                      # CLI error helpers
  cli/output.ts                      # stdout/stderr helpers
  cli/flags.ts                       # argv flag parsing
  api/create-api-app.ts              # express app composition
  api/server.ts                      # API server startup
  api/routes/*.ts                    # transport route modules
  api/middleware/*.ts                # auth + CORS middleware
  app/**                             # orchestration use-cases
  domain/**                          # pure policy/parser utilities
  infra/**                           # process/fs/http adapters
```

---

## 5. Conventions & Patterns

### Do
- Keep CLI command modules thin and delegate to app/infra helpers.
- Validate inputs at transport boundaries before domain execution.
- Keep path policy centralized and shared for env/git path checks.
- Keep API handlers transport-only (parse/validate/respond).

### Don’t
- Don’t reintroduce references to the removed local CLI package.
- Don’t mix git/service parsing logic directly in route handlers.
- Don’t duplicate HTTP client retry/auth logic per command.

---

## 6. Subsystem Invariants

### 6.1 CLI Transport Invariants
- Flag parsing is deterministic and shared.
- Missing required flags are validation failures.
- CLI writes machine-readable JSON for successful command payloads.

Evidence:
- `packages/sandbox-mcp/src/cli/entrypoint.ts`
- `packages/sandbox-mcp/src/cli/main.ts`

### 6.2 API Transport Invariants
- `/api/health` is unauthenticated.
- Other sandbox-mcp routes require bearer auth.
- Routes validate input and return explicit JSON error payloads.

Evidence:
- `packages/sandbox-mcp/src/api/create-api-app.ts`
- `packages/sandbox-mcp/src/api/middleware/auth.ts`
- `packages/sandbox-mcp/src/api/routes/services-routes.ts`

### 6.3 Service Runtime Invariants
- Service runtime state persists in `/tmp/proliferate/state.json`.
- Logs are persisted under `/tmp/proliferate/logs`.
- Exposed port updates write caddy user snippet and signal reload.

Evidence:
- `packages/sandbox-mcp/src/infra/services/state-store.ts`
- `packages/sandbox-mcp/src/infra/services/process-registry.ts`
- `packages/sandbox-mcp/src/app/services/manage-services.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sandbox-providers.md` | provider -> sandbox-mcp | sidecar startup and env wiring | Defines runtime boot contracts |
| `actions.md` | CLI -> Gateway | `/proliferate/:sessionId/actions/*` | Approval and invoke lifecycle |
| `repos-prebuilds.md` | env/app -> workspace | env spec path resolution | Workspace safety constraints |

### Security
- All non-health sandbox-mcp endpoints are bearer protected.
- Workspace-relative path constraints block traversal and escape.
- Integration credentials are never requested by the CLI; gateway resolves tokens.

---

## 8. Acceptance Gates

- [x] This spec references only existing code paths.
- [x] Local CLI package references are removed.
- [x] CLI and API transport boundaries are explicitly documented.

---

## 9. Known Limitations & Tech Debt

- [ ] Service state/log storage is `/tmp`-backed and not durable across fresh sandbox recreation.
- [ ] Action polling uses fixed interval polling instead of event-driven completion.
