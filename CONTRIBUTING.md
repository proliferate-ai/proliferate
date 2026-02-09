# Contributing

Small, focused PRs are easiest to review. If you're planning a dependency addition
or an architectural change, open an issue first.

## Development Setup

Prerequisites:

- Node.js + pnpm
- Docker (for Postgres/Redis)

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
	cp .env.example .env.local
	```
	Update `.env.local` (placeholders are marked `replace-me`).

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

Notes:

- `pnpm dev` runs all workspaces via Turbo once your env is set.
- Stop local services with `pnpm services:down`.

## Code Style

- Tabs for indentation
- Semicolons required
- A **pre-commit hook** runs automatically after `pnpm install` — it checks staged files with [Biome](https://biomejs.dev/) and auto-fixes formatting/import ordering before each commit
- Run `pnpm lint` before opening a PR for a full repo-wide check
- For repo conventions and patterns, see `AGENTS.md`.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Pull Requests

- Use the PR template (auto-populated from `.github/PULL_REQUEST_TEMPLATE.md`). Fill every section.
- Keep PRs small and focused.
- Add tests for pure logic where it makes sense (Vitest).
- Avoid adding dependencies without discussion.
- Do not commit secrets (`.env*`, tokens, cloud stack configs, etc.).
