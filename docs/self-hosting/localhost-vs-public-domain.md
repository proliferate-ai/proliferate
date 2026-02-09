# Self-Hosting: What Works Locally vs What Needs a Public Domain

This doc is for self-hosters running Proliferate via `docker compose up -d`.

## What Works on Localhost

These features only rely on:

- Browser redirects (GitHub/Google redirect the user back to your browser on the same machine)
- Outbound API calls (your server calling GitHub/Modal/E2B/etc.)

No inbound server-to-server traffic is required, so `http://localhost:3000` is fine.

| Feature | How it works | Why localhost is fine |
| --- | --- | --- |
| Email/password sign-up & login | Local auth via better-auth + Postgres | Fully local |
| Google OAuth login (optional) | Browser redirect to Google, back to your app | Redirect is browser-based |
| GitHub OAuth login (optional) | Browser redirect to GitHub, back to your app | Redirect is browser-based |
| GitHub App installation | User installs the GitHub App, then GitHub redirects the browser to your Setup URL (e.g. `http://localhost:3000/api/integrations/github/callback?installation_id=...`) | Redirect is browser-based |
| Repo access (clone/push/PRs) | Proliferate mints installation tokens using your GitHub App private key and calls `api.github.com` | Outbound HTTPS calls |
| Running agents in sandboxes | Proliferate calls Modal/E2B APIs | Outbound HTTPS calls |
| WebSocket streaming | Browser connects to the gateway (e.g. `ws://localhost:8787`) | Local network |
| LLM proxy (optional) | Proxies requests to Anthropic/OpenAI | Outbound HTTPS calls |

## What Requires a Public Domain (or Tunnel)

These features require an external service to deliver inbound HTTP requests to your server.
They will not work on `localhost` unless you use a tunnel (ngrok/smee/localtunnel) or deploy behind a real domain.

| Feature | Why it needs a public URL | Workaround |
| --- | --- | --- |
| GitHub webhooks | GitHub POSTs events to your webhook URL (e.g. `/api/webhooks/github-app`) | Tunnel or real domain + HTTPS |
| GitHub-triggered automations | Depends on GitHub webhooks | Same |
| Slack events/commands/interactive messages | Slack POSTs events to your server | Real domain + HTTPS |
| External webhook triggers (PostHog/Sentry/custom) | External services POST to your server | Tunnel or real domain + HTTPS |

## GitHub App: Every Self-Hoster Must Create Their Own

You cannot share a single Proliferate GitHub App across self-hosted instances:

- Each instance needs the app's **private key** to mint installation tokens
- Sharing the private key would let any self-hoster access repos from any org that installed the shared app

## Setup: Localhost Quickstart (No Webhooks)

If you're using the onboarding UI, go to Onboarding → Connect GitHub and click **Create GitHub App**.
It opens a prefilled GitHub App registration page with the correct Setup URL and recommended permissions.

1. Create a GitHub App on GitHub (personal account or org)
1. Set the GitHub App **Setup URL** to: `http://localhost:3000/api/integrations/github/callback`
1. Disable webhooks in the GitHub App settings (optional, recommended for localhost)
1. Recommended permissions:
   - Repository permissions: `Metadata (read)`, `Contents (read/write)`, `Pull requests (read/write)`, `Issues (read)`
1. Configure `.env` and rebuild/restart:
   - `GITHUB_APP_ID`
   - `GITHUB_APP_PRIVATE_KEY`
   - `GITHUB_APP_WEBHOOK_SECRET` (any random string if webhooks are disabled, but required for strict env validation)
   - `NEXT_PUBLIC_GITHUB_APP_SLUG`
   - Rebuild the web app (required for `NEXT_PUBLIC_*` changes): `docker compose up -d --build web`

Result: repo access, sessions, and PRs work. Webhook-driven features do not.

## Setup: Full Self-Host (Domain + Webhooks)

1. Run behind a real domain with HTTPS (see `Caddyfile.example` + `docker-compose.override.yml.example`)
1. Create a GitHub App with:
   - Setup URL: `https://<domain>/api/integrations/github/callback`
   - Webhook URL: `https://<domain>/api/webhooks/github-app` (webhooks enabled)
1. Use the same permissions as above
1. Set `.env` and restart:
   - `GITHUB_APP_WEBHOOK_SECRET` must match the webhook secret configured in the GitHub App UI

Result: webhook-driven automations work.

## Notes on `NEXT_PUBLIC_*` Variables

`NEXT_PUBLIC_*` values are baked into the web app at build time.

- With Docker Compose, changing `NEXT_PUBLIC_*` values usually requires rebuilding the web image.
- Server-only changes (non-`NEXT_PUBLIC_*`) typically only require a restart.
