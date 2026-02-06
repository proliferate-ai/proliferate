# Environment & Secrets Reference

This document is the **canonical reference** for environment variables in Proliferate.
It explains **what is required**, **what is optional**, and **when a value is required**.

---

## 1) Deployment Profile

We use `DEPLOYMENT_PROFILE` to distinguish cloud vs self-hosted behavior.

```
DEPLOYMENT_PROFILE=self_host   # default
DEPLOYMENT_PROFILE=cloud       # our hosted product
```

- **self_host**: minimal requirements, optional features can be disabled.
- **cloud**: billing + storage + email are required.

---

## 2) Core Required (All Deployments)

These are required to run the product at all.

| Key | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `SERVICE_TO_SERVICE_AUTH_TOKEN` | Internal service auth |
| `USER_SECRETS_ENCRYPTION_KEY` | Encrypts user secrets at rest |
| `BETTER_AUTH_SECRET` | Session signing secret |
| `DEFAULT_SANDBOX_PROVIDER` | `e2b` or `modal` |
| `ANTHROPIC_API_KEY` | LLM access (direct or for proxy) |
| `NEXT_PUBLIC_APP_URL` | Public app URL |
| `NEXT_PUBLIC_API_URL` | Public API URL |
| `NEXT_PUBLIC_GATEWAY_URL` | Public gateway URL |

**Self-host note:** docker-compose provides defaults for `DATABASE_URL` and `REDIS_URL`.  
**Cloud note:** these must be set explicitly.

---

## 3) Public Build-Time Config (Web Only)

`NEXT_PUBLIC_*` values are **baked into the web build**.  
When running self-hosted, make sure these are set **before building**.

| Key | Required When |
|---|---|
| `NEXT_PUBLIC_BILLING_ENABLED` | Cloud only (billing enabled) |
| `NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION` | When email verification is enabled |
| `NEXT_PUBLIC_INTEGRATIONS_ENABLED` | When integrations are enabled |
| `NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID` | Integrations enabled |
| `NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID` | Integrations enabled |
| `NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID` | Integrations enabled |
| `NEXT_PUBLIC_USE_NANGO_GITHUB` | Use Nango for GitHub OAuth |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional (Sentry) |
| `NEXT_PUBLIC_POSTHOG_HOST` | Optional (PostHog) |
| `NEXT_PUBLIC_POSTHOG_KEY` | Optional (PostHog) |
| `NEXT_PUBLIC_INTERCOM_APP_ID` | Optional (Intercom) |
| `NEXT_PUBLIC_GITHUB_APP_SLUG` | Required for GitHub App install URL |

---

## 4) Feature-Gated Requirements

These are required **only when the feature is enabled**.

### A) Sandbox Provider

If `DEFAULT_SANDBOX_PROVIDER=e2b`:
- `E2B_API_KEY`
- `E2B_DOMAIN`
- `E2B_TEMPLATE`
- `E2B_TEMPLATE_ALIAS`

If `DEFAULT_SANDBOX_PROVIDER=modal`:
- `MODAL_APP_NAME`
- `MODAL_TOKEN_ID`
- `MODAL_TOKEN_SECRET`
- Optional: `MODAL_APP_SUFFIX`, `MODAL_ENDPOINT_URL`

### B) LLM Proxy (optional)

If `LLM_PROXY_REQUIRED=true` or `LLM_PROXY_URL` set:
- `LLM_PROXY_URL`
- `LLM_PROXY_MASTER_KEY`
- Optional: `LLM_PROXY_KEY_DURATION`, `LLM_PROXY_ADMIN_URL`, `LLM_PROXY_PUBLIC_URL`

If `LLM_PROXY_URL` is unset, sandboxes call Anthropic directly using `ANTHROPIC_API_KEY`. If you enable the proxy, it must be publicly reachable by your sandbox provider.

### C) Integrations (Nango)

If `NEXT_PUBLIC_INTEGRATIONS_ENABLED=true` or `DEPLOYMENT_PROFILE=cloud`:
- `NANGO_SECRET_KEY`
- `NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID`
- `NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID`
- `NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID`

### D) GitHub App (required for repo access)

GitHub App is the default path for org‑wide repo access. It is required unless you explicitly enable Nango GitHub OAuth.

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_WEBHOOK_SECRET`
- `NEXT_PUBLIC_GITHUB_APP_SLUG`

### E) OAuth Login (optional)

If enabling OAuth:
- GitHub: `GITHUB_OAUTH_APP_ID`, `GITHUB_OAUTH_APP_SECRET`
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### F) Email (optional)

If `EMAIL_ENABLED=true` or `NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION=true` or `DEPLOYMENT_PROFILE=cloud`:
- `RESEND_API_KEY`
- `EMAIL_FROM`

### G) Slack (optional)

If enabling Slack:
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- `PROLIFERATE_SLACK_BOT_TOKEN`
- `PROLIFERATE_SLACK_CONNECT_EMAILS` (optional)

---

## 5) Cloud-Only Requirements

These are required for `DEPLOYMENT_PROFILE=cloud`.

### Billing (Autumn)
- `AUTUMN_API_KEY`
- `AUTUMN_API_URL`
- `BILLING_JWT_SECRET`

### Verification Storage
- `S3_BUCKET`
- `S3_REGION`
- Optional: `S3_ENDPOINT_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (S3‑compatible services like MinIO/R2)

---

## 6) Where Secrets Live

**Self-host:**
- `.env` / `.env.local` (never commit)

**Cloud:**
- AWS Secrets Manager → synced into Kubernetes

---

## 7) Self-Host Minimal Template (Summary)

Minimal `.env` for local self-host (Docker Compose):

```
DEPLOYMENT_PROFILE=self_host
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/proliferate
REDIS_URL=redis://redis:6379
BETTER_AUTH_SECRET=...
SERVICE_TO_SERVICE_AUTH_TOKEN=...
USER_SECRETS_ENCRYPTION_KEY=...
DEFAULT_SANDBOX_PROVIDER=modal
ANTHROPIC_API_KEY=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_GATEWAY_URL=ws://localhost:8787
NEXT_PUBLIC_BILLING_ENABLED=false
NEXT_PUBLIC_INTEGRATIONS_ENABLED=false
NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION=false
```

Add provider-specific keys and any optional integrations as needed.
