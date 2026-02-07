# Packages

Shared libraries used by the runnable services in `../apps`.

## Notable packages

- `shared`: cross-cutting types/helpers (contracts, providers, prompts, crypto).
- `services`: backend business logic and DB access (Drizzle) used by apps.
- `environment`: typed env var schemas for server/public runtimes.
- `gateway-clients`: typed clients for talking to the Gateway (WebSocket/HTTP/BullMQ).
- `db`: Drizzle schema + migrations.

## Docs

- https://docs.proliferate.com
- Agent guidelines: `../AGENTS.md`
