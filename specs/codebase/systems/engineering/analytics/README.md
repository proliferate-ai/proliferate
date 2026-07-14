# Engineering Analytics

Status: current system contract

Engineering Analytics owns product and adoption measurement. It owns the
first-party daily-activity and anonymous-telemetry records, the PostHog client
adapters, and the durable Postgres analytics objects that Metabase may read.
It does not own operational error handling, issue triage, or lifecycle
messaging.

## Boundaries

- [Anonymous telemetry](anonymous-telemetry.md) owns install-level version,
  activation, and usage records from Desktop and Server.
- [PostHog](posthog.md) owns hosted-client event capture, identity, and replay
  routing.
- [Metabase](metabase.md) owns the checked-in analytics tables and views that a
  read-only BI client may query.
- [Observability](../observability/README.md) owns logs, exceptions, Sentry,
  and production correlation.
- [Issue Lifecycle](../issue-lifecycle/README.md) owns ingestion and
  deduplication of provider evidence.
- [Delivery](../delivery/README.md) owns release and artifact identity.

## First-Party Daily Activity

`POST /v1/analytics/client-daily-activity` records one deduplicated row per
actor or anonymous install, UTC day, and surface. Web and Mobile send an
authenticated user request with a low-cardinality route or screen and
platform. Desktop sends an anonymous install UUID, telemetry mode, app
version, and platform. The API derives authenticated identity from the bearer
token; clients do not put a user id in the request body.

Source ownership:

- Web: `apps/web/src/lib/integrations/telemetry/client-daily-activity.ts`
- Mobile: `apps/mobile/src/lib/integrations/telemetry/client-daily-activity.ts`
- Desktop: `apps/desktop/src/lib/integrations/telemetry/anonymous.ts`
- Server API: `server/proliferate/server/analytics/**`
- Storage: `server/proliferate/db/models/analytics.py` and
  `server/proliferate/db/store/analytics.py`

The route/screen validator accepts only a 128-character low-cardinality token
containing letters, digits, `_`, or `-`; other values become `unknown`.
Client-local daily throttling is best effort and the database upsert is the
deduplication boundary.

## Applicability And Data Contract

| Concern | Current behavior |
| --- | --- |
| Deployment modes | First-party ingestion is available to local, self-managed, and hosted servers. PostHog is a hosted-product client path. Checked-in analytics migrations apply wherever the Server database is migrated; Proliferate's provider-ingestion infrastructure is hosted-only. |
| Source components | Desktop, Web, and Mobile telemetry adapters; Server analytics and anonymous-telemetry domains; analytics migrations and provider-ingestion script. |
| Identity and data | Anonymous install UUIDs; authenticated user UUIDs for daily activity; low-cardinality route/screen, version, platform, telemetry mode, activation, usage, and aggregate provider facts. |
| Destinations | The configured Proliferate Server/Postgres database, PostHog for enabled hosted clients, and an operator-selected read-only BI client such as Metabase. |
| Enable, disable, or no-op | Vendor adapters require their client key and telemetry gates. Anonymous telemetry has build/runtime and Server disable gates. Provider ingestion skips a provider whose required configuration is absent. |
| Privacy and replay | First-party payloads exclude prompts, transcripts, repo names, file paths, terminal text, raw URLs, errors, and secrets. Replay is off by default and its masking rules are owned by the PostHog contract. |
| Known gaps | Desktop and Web replay can still expose route ids through recorded page URLs when explicitly enabled. Anonymous credential fields are accepted by the schema but currently have no Desktop emission directive. Live provider dashboards and data freshness are not enforced by repository code. |

## Operating Routes

- Operate PostHog through
  [`developing/operating/analytics/posthog.md`](../../../../developing/operating/analytics/posthog.md).
- Operate Metabase and provider ingestion through
  [`developing/operating/analytics/metabase.md`](../../../../developing/operating/analytics/metabase.md).
