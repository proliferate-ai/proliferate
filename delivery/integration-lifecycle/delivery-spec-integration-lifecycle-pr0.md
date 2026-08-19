# Delivery specification: integration lifecycle PR0 — Slack qualification gate

Status: frozen delivery specification.
Approved design: integration connection lifecycle ADR proposal, decision 4 and
high-level sequencing PR0.
Base revision: `8532f52b226413458721b46839fc78b852b69373`.

## Outcome

Customer Slack OAuth cannot start merely because static credentials are
configured. A separate, default-off deployment qualification flag proves that
the exact Slack app has completed distribution review and canary qualification.
When that proof is absent, OAuth start fails closed before provider discovery,
OAuth-client persistence, or browser handoff.

## Scope

- Add `CLOUD_MCP_SLACK_DISTRIBUTION_READY`, default `false`, to server settings
  and the supported environment-variable catalog.
- Require both `CLOUD_MCP_SLACK_ENABLED` and the new qualification flag before
  resolving the static Slack OAuth client.
- Return the stable provider error code `integration_provider_unavailable` when
  distribution qualification is absent. Preserve
  `missing_static_oauth_client` for incomplete/invalid client configuration
  after qualification.
- Keep existing connected-account runtime use unchanged; this slice gates only
  new OAuth starts and reauthorization starts.

## Non-goals

- No lifecycle schema, management projection, UI, probe scheduler, or existing
  connection migration.
- No Slack Marketplace submission, environment mutation, or production deploy.
- No provider network call in tests.

## Acceptance

- Default settings leave Slack distribution unqualified.
- Static Slack client resolution fails with
  `integration_provider_unavailable` and performs no client-store read/write
  while unqualified.
- Qualified, fully configured Slack resolution preserves existing behavior.
- Qualified but incomplete configuration preserves
  `missing_static_oauth_client`.
- Focused unit/integration tests, server boundary checks, documentation checks,
  and migration-head validation pass.
