# Operate Sentry

Use this procedure to inspect Sentry delivery, releases, and alert routing for
the hosted product. Start read-only. Project slugs, alert rules, integrations,
and Slack channels are live provider state; discover them during the operation
instead of copying them into repository docs.

The code-owned behavior and privacy contract live in the
[Sentry system document](../../../codebase/systems/engineering/observability/sentry.md).
Issue ingestion and deduplication belong to
[Issue Lifecycle](../../../codebase/systems/engineering/issue-lifecycle/README.md).

## Applicability and safety

Hosted-product operators use this procedure with authorized Sentry access.
Self-hosters do not receive or use Proliferate's vendor DSNs. The current
self-managed path leaves vendor Sentry disabled; use deployment-owned logs and
monitoring. Connecting a private Sentry deployment requires a separately
reviewed source/configuration change, not reuse of Proliferate credentials.

The hosted source components are the server and its background processes,
Desktop renderer/native shell, Web, Mobile, AnyHarness, Worker, and Supervisor.
When their deployment-mode, telemetry-disable, and DSN gates permit, components
with explicit scrubbers send scrubbed exceptions, traces, breadcrumbs,
component release/environment, and safe correlation identifiers to the Sentry
project selected by that DSN; otherwise capture is a no-op and logs remain
available. Desktop-native and AnyHarness may send exceptions and traces but
lack the explicit before-send scrubbers used by the other emitters, so inspect
their event fields especially carefully and never add user content to tracing
data. Web and Mobile replay are off. Desktop normal replay is off, while masked
error replay uses its configured rate and can retain identifier-bearing route
metadata.

Never put a DSN containing credentials, auth token, cookie, session value, or
other secret in a CLI argument, shell history, command output, screenshot,
issue, PR, document, or chat. Use an authenticated browser session or an
approved environment/secret store. Do not print the environment. Redact user
content and credentials from any shared evidence.

## 1. Define the evidence sought

Record only:

- source component;
- expected environment and canonical release;
- bounded time window;
- one safe correlation value, such as request id, user id, support report id,
  workspace/session id, or sandbox id;
- whether the question concerns an event, release/debug file, or alert route.

Do not begin with a broad production export.

## 2. Discover current provider state read-only

Use the signed-in Sentry UI or an already authenticated CLI. With the CLI,
`sentry-cli info` is a safe authentication/connectivity check; do not add a
token on the command line. Then inspect, without changing:

1. the organizations and projects visible to the authorized account;
2. which project receives the selected component and environment;
3. current issue/metric alert rules and their actions;
4. installed integrations and notification destinations;
5. recent releases and uploaded source maps/debug files.

Treat what you observe as timestamped operational evidence. A checked-in env
name or upload workflow proves intended wiring, not current provider state.

## 3. Verify an event

1. Select a naturally occurring non-sensitive event in the bounded window.
   Prefer staging or a development release. Do not deliberately fault
   production as part of routine discovery.
2. Filter by component project, environment, and exact release.
3. Confirm the event has the expected `surface`, release, and safe correlation
   fields.
4. Inspect the payload for privacy regressions: no prompt/transcript text,
   request bodies, cookies, auth headers, tokens, file contents, raw local
   paths, email, or display name.
   When Desktop error replay is present, also inspect recorded page metadata
   for workflow, workspace, or chat route ids.
5. Follow the correlation value to structured logs when server/runtime context
   is needed. Keep full private evidence in its source system.
6. If the event should enter canonical issue tracking, verify that through the
   Issue Lifecycle procedure rather than changing Sentry grouping by hand.

For a synthetic canary, alert test, or production exception, obtain explicit
approval for that provider/product mutation and define rollback first. This
documentation-only migration performs none.

## 4. Verify a release

Compare the Sentry release with the artifact identity produced by Delivery.
For production it should use the emitting component's version and 12-character
source SHA. Do not substitute the Sentry project slug for the component name.

For a client/native stack trace, confirm the exact release has the required
source maps or debug files. A workflow run that skipped upload because optional
upload configuration was incomplete is not proof of symbolication.

## 5. Verify alert routing

Read the current rule in Sentry and record its project, environment filter,
condition, action destination, and last evaluation/delivery evidence. Do not
assume a historical channel or rule id is still active.

Alert creation, rule edits, integration installation, channel changes, issue
resolution, and test notifications are writes. Perform them only in a separate
approved operation with an explicit target and post-change verification.

## 6. Diagnose missing evidence

Check in this order:

1. deployment mode and telemetry-disable gates;
2. whether the component received a nonempty DSN through its owning deployment
   path, without displaying the value;
3. component environment and release identity;
4. local/structured logs for SDK initialization or network failures;
5. provider project/environment/time filters;
6. source-map or debug-file presence for unsymbolicated events;
7. alert rule evaluation and integration delivery for missing notifications.

A missing Sentry event must not be inferred to mean the product operation did
not fail. Use local or structured logs as the fallback evidence source.

## Record of proof

Record the timestamp, component, environment, release, safe event/issue link or
identifier, safe correlation value, observed result, and any follow-up. Do not
copy raw event bodies or secret-bearing URLs into the record.
