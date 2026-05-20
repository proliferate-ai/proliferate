# Sentry

## Purpose

Sentry is Proliferate's exception, native crash, and diagnostic breadcrumb
surface. It is intentionally separate from:

- PostHog: product analytics and optional replay
- Customer.io: lifecycle messaging and engagement
- anonymous telemetry: first-party aggregate install/usage records

## Projects

Use separate Sentry projects so alerts and releases can be owned by surface:

- `proliferate-server` for FastAPI and server automation workers
- `proliferate-desktop` for desktop renderer JavaScript
- `proliferate-desktop-native` for Tauri native crashes
- `anyharness` for bundled/cloud AnyHarness runtimes
- `proliferate-target` for cloud target worker/supervisor binaries
- `proliferate-web` for hosted web
- `proliferate-mobile` for Expo/React Native

## Environment

Server:

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `SENTRY_TRACES_SAMPLE_RATE`

Cloud runtime injection:

- `CLOUD_RUNTIME_SENTRY_*` becomes `ANYHARNESS_SENTRY_*`
- `CLOUD_TARGET_SENTRY_*` becomes `PROLIFERATE_TARGET_SENTRY_*`

Client builds:

- Desktop/web use `VITE_PROLIFERATE_SENTRY_*`
- Mobile uses `EXPO_PUBLIC_PROLIFERATE_SENTRY_*`

Upload targets:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_URL` when using a non-Sentry.io host
- optional overrides: `SENTRY_WEB_PROJECT`, `SENTRY_MOBILE_PROJECT`,
  `SENTRY_DESKTOP_NATIVE_PROJECT`, `SENTRY_ANYHARNESS_PROJECT`

## Privacy

All SDK adapters must set `sendDefaultPii=false` and send Sentry user identity
as `id` only. Do not send email, display name, prompt text, transcript content,
terminal output, repo names, raw file paths, request bodies, cookies, auth
headers, or environment values.

## Alerts

Slack notifications should be configured in Sentry alert rules, not custom app
code. Use separate alert routing for server/runtime/client projects when volume
requires it; the first default can be one product-errors channel with issue
regression and new high-priority issue alerts.
