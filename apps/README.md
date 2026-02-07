# Apps

Runnable services (containers) that make up the Proliferate stack.

- `web`: Next.js app + API routes (session lifecycle, auth, repo management). Not in the streaming path.
- `gateway`: WebSocket gateway for real-time streaming Client ↔ Gateway ↔ Sandbox.
- `worker`: BullMQ workers (background jobs).
- `trigger-service`: Webhook receiver that turns external events into sessions.
- `llm-proxy`: Optional LiteLLM proxy for scoped, short-lived LLM keys.

## Docs

- https://docs.proliferate.com
- Local setup: https://docs.proliferate.com/self-hosting/local

## Specs

- `gateway/SPEC.md`
- `trigger-service/SPEC.md`
- `llm-proxy/README.md`

## Development

- From repo root: `pnpm dev` (all apps) or `pnpm dev:web`, `pnpm dev:gateway`, `pnpm dev:worker`.
