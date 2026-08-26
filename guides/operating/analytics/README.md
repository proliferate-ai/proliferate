# Analytics And Observability Operations

Status: authoritative operator index for analytics and
observability providers.

Use these procedures to discover current provider state and verify that the
checked-in system behavior is reaching its intended destination. They do not
make dashboard ids, campaigns, alert rules, channels, or other mutable
provider configuration part of repository law.

## System Owners

- [Engineering Analytics](../../../specs/engineering/observability/analytics.md)
  owns anonymous telemetry, PostHog capture and replay routing, and Metabase
  durable facts and views.
- [Engineering Observability](../../../specs/engineering/observability/README.md)
  owns event production, scrubbing, correlation, structured logs, and Sentry.

## Provider Procedures

| Provider | Procedure | Typical applicability |
| --- | --- | --- |
| Metabase | [metabase.md](metabase.md) | Hosted analytics and deployments that operate a compatible analytics database. |
| PostHog | [posthog.md](posthog.md) | Hosted capture/replay and deployments that explicitly configure their own project. |
| Sentry | [sentry.md](sentry.md) | Hosted observability and deployments that explicitly configure their own projects. |
| Honeycomb | [honeycomb.md](honeycomb.md) | Hosted product SLIs computed from AnyHarness lifecycle records; dogfood and internal builds only until the customer export pipe ships. |

## Shared Safety Contract

Start with read-only discovery and verify the environment and deployment mode
before inspecting data. Do not perform provider writes as part of routine
verification. Never expose DSNs, API keys, cookies, authorization headers,
private ids tied to users, or captured sensitive content in commands, output,
screenshots, issues, pull requests, docs, or chat.
