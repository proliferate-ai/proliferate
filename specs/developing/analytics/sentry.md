# Sentry

## Purpose

Sentry is Proliferate's exception, native crash, and diagnostic breadcrumb
surface. It is intentionally separate from:

- PostHog: product analytics and optional replay
- Customer.io: lifecycle messaging and engagement
- anonymous telemetry: first-party aggregate install/usage records

## Release Format

All Sentry releases follow the format:

- Local dev: `<component>@<VERSION>` (e.g., `proliferate-server@0.3.6`)
- CI builds: `<component>@<VERSION>+<short_sha>` (e.g., `proliferate-server@0.3.6+a1b2c3d4e5f6`)

The short SHA is always 12 characters, matching `${GIT_SHA:0:12}` in workflows.

Defaults in code derive from real version sources (package.json, CARGO_PKG_VERSION,
VERSION file) instead of hardcoded strings to prevent drift.

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
- optional overrides: `SENTRY_DESKTOP_RENDERER_PROJECT`,
  `SENTRY_WEB_PROJECT`, `SENTRY_MOBILE_PROJECT`,
  `SENTRY_DESKTOP_NATIVE_PROJECT`, `SENTRY_ANYHARNESS_PROJECT`

## Privacy

All SDK adapters must set `sendDefaultPii=false` and send Sentry user identity
as `id` only. Do not send email, display name, prompt text, transcript content,
terminal output, repo names, raw file paths, request bodies, cookies, auth
headers, or environment values.

## Structured server logs

`JsonLogFormatter` (`server/proliferate/utils/logging.py`) stamps two build
identity fields on every JSON log record, computed once at
`configure_server_logging()` time (never per-record):

- `version` — from `server_version()`
  (`server/proliferate/server/version.py`): stamped `SERVER_VERSION`, else the
  repo `VERSION` file, else a dev sentinel.
- `git_sha` — from the `SERVER_GIT_SHA` env when set; omitted otherwise.

These are stable contract fields referenced by the Grafana dashboard and Sentry
alert rules — do not rename. The debug/plain log format is unchanged.

## Support Correlation

Server requests install a scrubbed correlation context for Sentry. The context
may include request ID, authenticated user ID, tenant ID, organization ID,
support report ID, cloud workspace ID, cloud target ID, sandbox IDs,
AnyHarness workspace ID, session ID, interaction ID, command ID, worker ID, and
slot generation when those values are known.

Background work binds the same correlation context so its logs and Sentry
events carry identity like API requests do:

- Automation cloud executor binds organization / user / session / sandbox /
  workspace / target IDs from the run claim at the start of each run
  (`process` boundary in
  `server/proliferate/server/automations/worker/cloud_executor.py`); the
  scheduler loop binds `worker_id`.
- Celery tasks use the `CorrelatedTask` base
  (`server/proliferate/background/correlation.py`), which restores correlation
  fields from task headers. Producers propagate them via
  `headers=capture_correlation_context()`.

`tenant_id`, `support_report_id`, and normalized cloud/runtime IDs are allowed
as diagnostic tags for support flows even though they can be high-cardinality.
Do not add free-form messages, raw URLs, prompts, transcript bodies, command
payloads, provider responses, auth headers, cookies, tokens, or file contents
to tags or context.

## Critical-failure severity

`report_critical(error, *, tags=None, extras=None, **context)`
(`server/proliferate/integrations/sentry.py`) marks a clearly page-worthy
failure. It captures to Sentry at `level="fatal"` with tag
`critical_failure=true`, and emits `logger.exception` carrying
`extra={"critical_failure": True, ...}` plus a `CRITICAL_FAILURE` marker in the
message for log-based alerting. `critical_failure` is a stable contract field.

Adopt it only at page-worthy sites (not ambient errors, which stay a plain
`logger.exception`). Current call sites:

- automation scheduler loop failure escalation (`automations/worker/scheduler.py`)
- billing reconciler loop (`server/billing/reconciler.py`)
- agent-gateway worker loops: enrollment backfill, usage import, LLM top-up
  (`server/cloud/agent_gateway/worker.py`)
- cloud materialization after-commit / fresh-session task failures
  (`server/cloud/materialization/runner.py`)

## Alerts

Slack notifications should be configured in Sentry alert rules, not custom app
code. Use separate alert routing for server/runtime/client projects when volume
requires it; the first default can be one product-errors channel with issue
regression and new high-priority issue alerts.

Live rules (created 2026-07-06): issue alert `17267915` (new/regressed,
level=fatal OR `critical_failure=true`) and metric alert `442367`
(`p95(span.duration) > 5s / 10min`), both on `proliferate-server` → Slack
`#sentry-channel`. Grafana/CloudWatch latency + 5xx + CPU alerts route to
`#alerts` via AWS Managed Grafana (workspace `proliferate-ops`, `g-e532d030d8`).
