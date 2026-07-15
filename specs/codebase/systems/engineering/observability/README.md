# Observability System

Observability owns how Proliferate produces diagnostic evidence: structured
logs, Sentry events, privacy controls, correlation fields, and the connection
between application failures and CloudWatch/Grafana signals.

- [Sentry](sentry.md) — component initialization, release and environment
  identity, transmitted data, scrubbing, correlation, and failure behavior.
- [Issue Lifecycle](../issue-lifecycle/README.md) — ingestion,
  deduplication, canonical issue routing, investigation, and reporter follow-up
  after Sentry or Grafana evidence exists.
- [Delivery](../delivery/README.md) — the artifact and deploy identity used as
  the `release`/`release_id` correlation key.

## Boundary

Observability owns:

- the code that emits exceptions, traces, breadcrumbs, structured logs, and
  critical-failure markers;
- source-owned release, environment, surface, and correlation fields;
- redaction before vendor transmission;
- the relationship between server logs, Sentry, CloudWatch, and Grafana.

Observability does not own:

- product/adoption analytics, which belongs to
  [Engineering Analytics](../analytics/README.md);
- provider-evidence polling, deduplication, or issue state, which belongs to
  Issue Lifecycle;
- release construction and promotion, which belongs to Delivery;
- mutable Sentry projects, alert rules, integrations, or Slack destinations.
  Operators discover that state at execution time using the
  [Sentry operating procedure](../../../../developing/operating/analytics/sentry.md).

## Deployment and data contract

Proliferate vendor observability is enabled for hosted-product components only.
Local development and self-managed deployments keep Proliferate vendor DSNs
unset and use local or deployment-owned logs. A component with no applicable
DSN must continue without Sentry.

The source components are the hosted server and background workers, Desktop
renderer and native shell, hosted Web and Mobile clients, AnyHarness, and the
managed target Worker and Supervisor. Components with explicit scrubbers may
transmit scrubbed exceptions, stack traces, traces, breadcrumbs, component
release/environment, surface tags, and allowlisted correlation identifiers to
the Sentry destination selected by their configured DSN. Desktop-native and
AnyHarness can transmit exceptions and stack traces but lack an explicit
before-send scrubber. Server structured logs go to the deployment log sink and
can be queried through CloudWatch/Grafana in the hosted stack.

Sentry is diagnostic telemetry, not session replay by default. Web and Mobile
set both replay rates to zero. Desktop renderer sets normal session replay to
zero and permits error replay only at its configured rate; its replay masks all
text and inputs and honors telemetry mask/block selectors. Those controls do
not establish that identifier-bearing route metadata is removed. The Desktop
runtime telemetry disable setting disables vendor telemetry as well.

Known current gaps:

- the Desktop-native and AnyHarness Rust adapters do not install the explicit
  before-send scrubbers used by the server, clients, Worker, and Supervisor;
- Desktop renderer error replay can retain identifier-bearing route metadata.

Do not add free-form user content or secrets to tracing events. Closing either
source-code gap requires a separate implementation PR.
