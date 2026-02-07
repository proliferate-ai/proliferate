# Web (`@proliferate/web`)

Next.js app for the dashboard UI and non-streaming APIs (sessions, repos, auth). Real-time streaming is handled via the Gateway and `@proliferate/gateway-clients`.

## Docs

- https://docs.proliferate.com/anywhere/web
- Self-hosting: https://docs.proliferate.com/self-hosting/overview

## Development

- From repo root: `pnpm dev:web`
- Unit tests: `pnpm --filter @proliferate/web test`
- E2E: `pnpm --filter @proliferate/web e2e`
