# Metabase Analytics

## Purpose
Metabase is Proliferate's first-party operating dashboard over durable product
facts in Postgres. It is the place to review open-source/self-managed usage,
hosted user activity, cloud workspace/session consumption, MCP lifecycle events,
workspace mobility, sandbox provisioning, and automation activity.

Customer.io stays engagement-only. PostHog stays vendor product analytics and
replay. Sentry stays exception monitoring. None of those tools are the source of
truth for Metabase V1 metrics.

## Current Views
- `analytics.daily_client_activity`
  - daily active authenticated users and anonymous installs by `surface`
  - sourced from `client_daily_activity`
- `analytics.daily_desktop_installs`
  - new anonymous desktop installs by day, telemetry mode, and platform
  - sourced from `anonymous_telemetry_install`
- `analytics.daily_anonymous_usage`
  - anonymous usage aggregates for sessions, prompts, workspaces, credentials,
    and connectors
  - sourced from `anonymous_telemetry_event` `USAGE` records
- `analytics.daily_new_users`
  - hosted user signups by day
  - sourced from `"user".created_at`
- `analytics.daily_cloud_workspaces`
  - new and archived cloud workspaces by day and owner scope
  - sourced from `cloud_workspace`
- `analytics.daily_cloud_sessions`
  - cloud sessions by day, status, and normalized agent harness
  - sourced from `cloud_sessions`
- `analytics.daily_sandboxes`
  - sandbox records and externally provisioned sandboxes by day, provider, and
    status
  - sourced from `cloud_sandbox`
- `analytics.daily_automation_activity`
  - created automations and automation runs by day, execution target, status,
    and trigger kind
  - sourced from `automation` and `automation_run`
- `analytics.daily_mcp_activity`
  - MCP connection creation, auth-ready, disabled, deleted, and failed events
    by day and catalog entry
  - sourced from `cloud_mcp_connection_event`
- `analytics.daily_mobility_activity`
  - workspace handoff starts, completions, failures, and phase transitions by
    day and direction
  - sourced from `cloud_workspace_mobility_event`

## Dashboard Cards
Recommended first Metabase cards:
- new desktop installs
- daily active desktop, web, and mobile users/installations
- hosted new users
- anonymous sessions and prompts
- new cloud workspaces and archived cloud workspaces
- cloud sessions by agent harness
- externally provisioned sandboxes
- created automations and automation runs
- MCP connected/auth-ready/failed/deleted events
- workspace migration starts/completions/failures

## Metabase Access
Use a read-only database role scoped to the `analytics` schema:

```sql
CREATE ROLE metabase_readonly LOGIN PASSWORD '<secret>';
GRANT USAGE ON SCHEMA analytics TO metabase_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO metabase_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
    GRANT SELECT ON TABLES TO metabase_readonly;
```

The role should not receive access to raw application schemas unless a specific
question cannot be answered through an analytics view.

## Privacy Rules
Metabase views must not expose prompts, transcripts, file paths, repo names, raw
URLs, terminal text, raw errors, access tokens, refresh tokens, or secret
material. Add low-cardinality dimensions at ingestion time rather than exposing
raw payloads.
