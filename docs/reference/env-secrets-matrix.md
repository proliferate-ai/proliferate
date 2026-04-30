# Env and Secrets Matrix

This document is the operator-facing source of truth for the Proliferate
control plane env surface.

## Principles

- `server/proliferate/config.py` contains env-derived runtime settings only.
- Hardcoded protocol values, template names, ports, workdirs, and auth lifetime
  defaults live in `server/proliferate/constants/**`.
- Secrets must be provided explicitly through:
  - `server/.env`
  - `server/.env.local`
  - container/task/service environment injection
  - a deployment secret manager
- There is intentionally no home-directory fallback such as
  `~/proliferate/.env.local`.
- Any variable not listed below should be treated as unsupported on this branch.
  `Settings` ignores unknown env vars, so removed overrides fail closed by being
  ignored rather than raising an error.

## Environment Boundaries

- `server/.env` and `server/.env.local` expose the full control-plane env
  surface for local development, direct server runs, and operator debugging.
- `server/deploy/.env.static` is the curated self-hosted production surface.
  It includes the common operator settings; advanced overrides from this matrix
  may still be added there manually when needed.
- `server/infra/self-hosted-aws/template.yaml` promotes an even smaller subset
  of those settings into CloudFormation parameters. Advanced defaults that are
  not parameterized there intentionally stay on their code defaults unless you
  customize the template or edit the generated `.env.static` on the host.

## Core Runtime Settings

| Variable | Secret | Required | Used for |
| --- | --- | --- | --- |
| `API_BASE_URL` | No | Recommended for public/proxied deployments | Canonical public API base URL used for absolute auth callback generation |
| `DEBUG` | No | No | Debug mode flag |
| `PROLIFERATE_TELEMETRY_MODE` | No | Yes for explicit telemetry routing | Telemetry runtime mode: `local_dev`, `self_managed`, or `hosted_product` |
| `DATABASE_URL` | Yes | Yes | PostgreSQL connection |
| `DATABASE_ECHO` | No | No | SQLAlchemy query echo/logging |
| `CORS_ALLOW_ORIGINS` | No | Yes for browser/desktop API access | Allowed browser/webview origins |
| `JWT_SECRET` | Yes | Yes | JWT signing and OAuth state signing |

## Desktop Auth

| Variable | Secret | Required | Used for |
| --- | --- | --- | --- |
| `GITHUB_OAUTH_CLIENT_ID` | Yes | Only when desktop GitHub sign-in is enabled | GitHub OAuth client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | Yes | Only when desktop GitHub sign-in is enabled | GitHub OAuth client secret |

The desktop redirect scheme, callback path, deep-link launch behavior, and auth
token lifetimes now live in `server/proliferate/constants/auth.py`. They are
code defaults on this branch, not env overrides.

Desktop runtime overrides live in `~/.proliferate/config.json` (or the
profile-specific `PROLIFERATE_DEV_HOME/config.json` in profile dev). The
supported fields are:

```json
{
  "apiBaseUrl": "https://api.company.com",
  "telemetryDisabled": false
}
```

## Auth and Token Lifetimes

No env overrides are currently supported for token lifetimes or desktop PKCE
timers on this branch. These values are defined in
`server/proliferate/constants/auth.py`.

## Observability and Messaging

| Variable | Secret | Required | Used for |
| --- | --- | --- | --- |
| `CUSTOMERIO_SITE_ID` | Yes | No | Customer.io workspace/account messaging |
| `CUSTOMERIO_API_KEY` | Yes | No | Customer.io API auth |
| `CUSTOMERIO_APP_API_KEY` | Yes | No | Customer.io app API auth |
| `CUSTOMERIO_FROM_EMAIL` | No | No | Customer.io sender email address |
| `FRONTEND_BASE_URL` | No | No | Frontend base URL for email links etc. |
| `PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT` | No | No | First-party anonymous telemetry collector endpoint |
| `PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED` | No | No | Disable server-side anonymous telemetry emission |
| `SENTRY_DSN` | Yes | No | Server Sentry |
| `SENTRY_ENVIRONMENT` | No | No | Server Sentry environment |
| `SENTRY_RELEASE` | No | No | Server Sentry release |
| `SENTRY_TRACES_SAMPLE_RATE` | No | No | Server Sentry tracing |
| `SUPPORT_SLACK_WEBHOOK_URL` | Yes | No | Slack destination for support messages |

## AI Magic

| Variable | Secret | Required | Used for |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | No | Session title generation |
| `AI_MAGIC_SESSION_TITLE_MODEL` | No | No | Anthropic model name for session titles |

Rate-limit thresholds (`SESSION_TITLE_RATE_LIMIT_REQUESTS`,
`SESSION_TITLE_RATE_LIMIT_WINDOW_SECONDS`) and title length caps now live in
`server/proliferate/constants/ai_magic.py`. They are not env-overridable.

## Cloud Workspaces and Billing

| Variable | Secret | Required | Used for |
| --- | --- | --- | --- |
| `CLOUD_SECRET_KEY` | Yes | Yes for cloud-enabled deployments | Control-plane signing for cloud flows |
| `CLOUD_FREE_SANDBOX_HOURS` | No | No | Free-tier usage limit |
| `CLOUD_CONCURRENT_SANDBOX_LIMIT` | No | No | Concurrent sandbox limit |
| `CLOUD_BILLING_MODE` | No | No | Billing mode (`off`, `observe`, `enforce`) |
| `STRIPE_SECRET_KEY` | Yes | Future hosted billing only | Stripe API key for checkout, portal, and usage export |
| `STRIPE_WEBHOOK_SECRET` | Yes | When receiving Stripe billing webhooks | Stripe webhook signature verification |
| `STRIPE_CLOUD_MONTHLY_PRICE_ID` | No | Future hosted billing only | Stripe $200 Cloud monthly price ID |
| `STRIPE_SANDBOX_METER_ID` | No | Future hosted billing only | Stripe billing meter ID for sandbox usage |
| `STRIPE_SANDBOX_METER_EVENT_NAME` | No | Future hosted billing only | Stripe billing meter event name for sandbox usage |
| `STRIPE_SANDBOX_OVERAGE_PRICE_ID` | No | Future hosted billing only | Stripe metered 10-hour overage block price ID |
| `STRIPE_REFILL_10H_PRICE_ID` | No | Future hosted billing only | Stripe one-time 10-hour refill price ID |
| `STRIPE_CHECKOUT_SUCCESS_URL` | No | Future hosted billing only | Checkout success redirect URL |
| `STRIPE_CHECKOUT_CANCEL_URL` | No | Future hosted billing only | Checkout cancellation redirect URL |
| `STRIPE_CUSTOMER_PORTAL_RETURN_URL` | No | Future hosted billing only | Customer portal return URL |

The billing reconciler interval (`BILLING_RECONCILE_INTERVAL_SECONDS`) now
lives in `server/proliferate/constants/billing.py`. It is not env-overridable.

## Sandbox Provider Settings

| Variable | Secret | Required | Used for |
| --- | --- | --- | --- |
| `SANDBOX_PROVIDER` | No | Yes for cloud-enabled deployments | Selects `e2b` or `daytona` |
| `E2B_API_KEY` | Yes | When `SANDBOX_PROVIDER=e2b` | E2B provisioning auth |
| `E2B_TEMPLATE_NAME` | No | Required for non-debug E2B deployments | Explicit E2B template ref, typically `TEAM_SLUG/proliferate-runtime-cloud:production` |
| `E2B_WEBHOOK_SIGNATURE_SECRET` | Yes | No | E2B webhook verification |
| `DAYTONA_API_KEY` | Yes | When `SANDBOX_PROVIDER=daytona` | Daytona provisioning auth |
| `DAYTONA_SERVER_URL` | No | No | Daytona API base URL |
| `DAYTONA_TARGET` | No | No | Daytona target/region |

Sandbox timeout defaults, runtime ports, workdirs, and target paths now live in
`server/proliferate/constants/sandbox/e2b.py` and
`server/proliferate/constants/sandbox/daytona.py`. They are code defaults, not
env overrides.

## Remote AnyHarness Injection

| Variable | Secret | Required | Used for |
| --- | --- | --- | --- |
| `CLOUD_RUNTIME_SOURCE_BINARY_PATH` | No | No | Override path for the Linux AnyHarness binary uploaded into cloud sandboxes |
| `CLOUD_RUNTIME_SENTRY_DSN` | Yes | No | Remote AnyHarness Sentry DSN |
| `CLOUD_RUNTIME_SENTRY_ENVIRONMENT` | No | No | Remote AnyHarness Sentry environment |
| `CLOUD_RUNTIME_SENTRY_RELEASE` | No | No | Remote AnyHarness Sentry release |
| `CLOUD_RUNTIME_SENTRY_TRACES_SAMPLE_RATE` | No | No | Remote AnyHarness tracing |

## Legacy Compatibility

There is no `E2B_RUNTIME_SENTRY_*` compatibility fallback on this branch.
Operators should migrate any legacy runtime Sentry configuration to the
`CLOUD_RUNTIME_*` variables above. The old `E2B_RUNTIME_SENTRY_*` names are not
part of the supported env surface here.
