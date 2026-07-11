# Analytics And Observability

Status: authoritative for developer-facing analytics and observability process.

Use this folder when changing product analytics, lifecycle messaging,
dashboards, session replay, anonymous telemetry, Sentry, or alert routing.

## System Goals

Keep the observability surfaces separate:

- Customer.io owns engagement and lifecycle messaging.
- Metabase owns durable operating metrics over database facts.
- PostHog owns hosted-product analytics and optional replay.
- Sentry owns exceptions, native crashes, release health, and support
  correlation.
- Anonymous telemetry owns first-party aggregate usage for desktop,
  self-managed, and local-dev surfaces without vendor analytics.

No analytics surface should receive prompts, transcript bodies, terminal
output, repo names, raw file paths, auth material, cookies, request bodies, or
secret values.

## Process Map

Use this folder to answer three analytics questions:

1. Overall ownership and freshness:
   - this README owns which system should answer which class of question, what
     permissions/tools are needed, and when docs must be updated
2. Tool-specific operation:
   - [customerio.md](customerio.md): lifecycle messaging, transactional welcome
     email, sending-domain setup, and billing labels
   - [metabase.md](metabase.md): analytics schema views, durable dashboard
     cards, DB access, and privacy rules
   - [posthog.md](posthog.md): hosted-product event capture, replay gates,
     identity sync, and client env vars
   - [sentry.md](sentry.md): Sentry projects, env vars, privacy, support
     correlation, and alert routing
   - [sentry-setup-runbook.md](sentry-setup-runbook.md): first-time Sentry
     project/alert setup
   - [anonymous-telemetry.md](anonymous-telemetry.md): first-party anonymous
     telemetry workflows and current usage
   - [workflows-dashboards.md](workflows-dashboards.md): workflow-run
     success/failure and scheduling-latency dashboard query definitions
     (Metabase + Grafana), sourced from `workflow_run` columns
3. Keeping surfaces fresh:
   - update the owning doc in the same PR as event, dashboard, alert, replay,
     lifecycle-message, or privacy changes
   - verify the affected dashboard/tool after deploy when the change depends on
     production data or vendor ingestion

## Tools And Permissions

Operators may need:

- GitHub MCP, `gh`, or GitHub web access to inspect linked PRs, release notes,
  deploy workflows, and environment configuration.
- Browser or Chrome access with the right logged-in profile for Customer.io,
  Metabase, PostHog, Sentry, Cloudflare, AWS, and GitHub.
- Local shell access for tests, SDK/build checks, SQL migrations, Sentry CLI
  release/debug uploads, and env-var catalog updates.
- Read-only database access for Metabase analytics-view validation.
- AWS/GitHub environment access when analytics env vars, Sentry DSNs, PostHog
  keys, Customer.io keys, or release upload tokens need inspection or repair.
- Cloudflare DNS access when Customer.io sending-domain records change.

Required permissions by surface:

| Surface | Permissions |
| --- | --- |
| Anonymous telemetry | repo write access, server migration/test access, and production DB read access when validating aggregate rows |
| Customer.io | Customer.io workspace access, transactional-message access, GitHub/AWS env access for keys, and Cloudflare DNS access for sending-domain setup |
| Metabase | Metabase admin/editor access for dashboards, read-only analytics DB credentials, and migration rights when analytics views change |
| PostHog | PostHog project access, replay/privacy configuration access, and deploy env access for client keys/gates |
| Sentry | Sentry org/project access, alert-rule access, release/debug-upload token access, and deploy env access for DSNs/releases |

## Ownership Table

| Surface | Owns | Read |
| --- | --- | --- |
| Anonymous telemetry | First-party install, activation, and usage aggregates for desktop/self-managed/local-dev surfaces. | [anonymous-telemetry.md](anonymous-telemetry.md) |
| Customer.io | Lifecycle messaging and transactional welcome flows. | [customerio.md](customerio.md) |
| Metabase | Durable operating dashboards over product/database facts. | [metabase.md](metabase.md) |
| PostHog | Hosted-product analytics and optional replay. | [posthog.md](posthog.md) |
| Sentry | Exceptions, native crashes, release health, and support correlation. | [sentry.md](sentry.md), [sentry-setup-runbook.md](sentry-setup-runbook.md) |

## Freshness Triggers

Update analytics docs when any of these change:

- product event names, allowlists, property names, route/screen names, or
  payload shape
- identity behavior, user traits, org/tenant traits, or reset/sign-out behavior
- replay enablement, masking/blocking selectors, recording gates, or privacy
  posture
- lifecycle emails, transactional message IDs, sending domains, or Customer.io
  journeys/segments
- analytics SQL views, dashboard cards, metric definitions, source tables, or
  freshness expectations
- Sentry projects, DSNs, releases, sourcemap/native debug upload behavior,
  alert rules, or support-correlation tags
- anonymous telemetry ingestion, aggregation tables, event categories, or
  self-managed telemetry mode behavior

Verification expectations:

- For local/client changes, run the relevant typecheck/tests and inspect the
  adapter no-op behavior when env vars are absent.
- For server analytics changes, run targeted server tests and migration checks.
- For dashboard/view changes, verify the SQL/view output and the dashboard card
  in Metabase.
- For Customer.io changes, verify the transactional message, domain status, or
  test send path in Customer.io.
- For PostHog changes, verify only allowlisted/scrubbed events arrive and replay
  remains gated/masked as documented.
- For Sentry changes, verify the project/release/alert path and confirm support
  correlation uses IDs, not free-form content.

## Process Rules

- Add or update the owning analytics doc in the same PR that changes event
  names, payload shape, dashboards, alerts, replay behavior, or privacy posture.
- Keep engagement, operating metrics, replay, and error monitoring separate:
  Customer.io is messaging, Metabase is durable product facts, PostHog is
  hosted-product analytics/replay, and Sentry is failures/diagnostics.
- Document the data owner, source table/event, destination, privacy posture, and
  freshness expectation for every durable analytics surface.
- Do not send prompts, transcript text, terminal output, repo names, raw file
  paths, auth material, cookies, or request bodies to analytics or replay tools.
- When debugging a support issue, prefer stable ids and support report ids over
  free-form user content.

## Final Report Shape

When finishing analytics work, report:

- changed surface: Customer.io, Metabase, PostHog, Sentry, anonymous telemetry,
  or multiple
- source files, migrations, dashboards, env vars, or vendor settings touched
- privacy posture and any replay/masking implications
- verification performed, including dashboard/tool checks when applicable
- docs/dashboard freshness owner recorded when docs are unchanged
