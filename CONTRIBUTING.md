# Contributing

## Development Setup

1. Install dependencies:
	```bash
	pnpm install
	```

2. Start local services (Postgres, Redis, LLM proxy):
	```bash
	pnpm services:up
	```

3. Configure environment:
	```bash
	cp .env.local.example .env.local
	```

4. Run database migrations:
	```bash
	pnpm -C packages/db db:migrate
	```

5. Start apps (in separate terminals):
	```bash
	pnpm dev:web
	pnpm dev:gateway
	pnpm dev:worker
	```

## Code Style

- Tabs for indentation
- Semicolons required
- Run `pnpm lint` before opening a PR

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Pull Requests

- Keep PRs small and focused.
- Add tests for pure logic where it makes sense (Vitest).
- Avoid adding dependencies without discussion.
- Do not commit secrets (`.env*`, tokens, cloud stack configs, etc.).

