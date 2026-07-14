# Analytics And Observability Operations

Status: authoritative operator index for analytics, engagement, and
observability providers.

Use these procedures to discover current provider state and verify that the
checked-in system behavior is reaching its intended destination. They do not
make dashboard ids, campaigns, alert rules, channels, or other mutable
provider configuration part of repository law.

## System Owners

- [Engineering Analytics](../../../codebase/systems/engineering/analytics/README.md)
  owns anonymous telemetry, PostHog capture and replay routing, and Metabase
  durable facts and views.
- [Engineering Observability](../../../codebase/systems/engineering/observability/README.md)
  owns event production, scrubbing, correlation, structured logs, and Sentry.
- [Product Engagement](../../../codebase/systems/product/engagement/README.md)
  owns Customer.io transport, profile attributes, lifecycle events, and send
  gates.
- [Issue Lifecycle](../../../codebase/systems/engineering/issue-lifecycle/README.md)
  owns provider-evidence ingestion, deduplication, investigation, and
  reporter follow-up.

## Provider Procedures

| Provider | Procedure | Typical applicability |
| --- | --- | --- |
| Customer.io | [customerio.md](customerio.md) | Hosted product engagement; self-hosters only when they configure their own destination. |
| Metabase | [metabase.md](metabase.md) | Hosted analytics and deployments that operate a compatible analytics database. |
| PostHog | [posthog.md](posthog.md) | Hosted capture/replay and deployments that explicitly configure their own project. |
| Sentry | [sentry.md](sentry.md) | Hosted observability and deployments that explicitly configure their own projects. |

## Shared Safety Contract

Start with read-only discovery and verify the environment and deployment mode
before inspecting data. Do not perform provider writes as part of routine
verification. Never expose DSNs, API keys, cookies, authorization headers,
private ids tied to users, or captured sensitive content in commands, output,
screenshots, issues, pull requests, docs, or chat.
