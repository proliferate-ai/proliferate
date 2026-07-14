# Operate Metabase And Analytics Ingestion

Status: current procedure

Use this procedure to discover whether the durable analytics objects,
provider-ingestion job, and read-only BI presentation are healthy. The system
contract is [Metabase And Durable Analytics Views](../../../codebase/systems/engineering/analytics/metabase.md).

## Applicability

- **Hosted Proliferate only:** the checked-in ECS, scheduler, IAM, Secrets
  Manager references, and CloudWatch inputs under `server/infra/analytics/`.
  Metabase Cloud is separately operated live provider state; its dashboards
  and cards are not checked in.
- **Self-hosters:** Server migrations create the `analytics` schema and product
  views. A self-hoster may connect its own BI tool through a schema-scoped
  read-only database role. The hosted provider-ingestion schedule is not part
  of the self-hosted product.

## Secret Safety

Begin with read-only discovery. Never put secret values in CLI arguments,
shell history, command output, screenshots, issues, PRs, documentation, or
chat. Use the configured credential chain, an authenticated console, or secure
interactive input. Do not print or copy a database URL, provider token, or E2B
session cookie while diagnosing this system.

## Read-Only Discovery

1. Confirm repository intent before inspecting a deployment:

   ```bash
   git show HEAD:server/infra/analytics/README.md
   git show HEAD:server/scripts/analytics_ingest.py | sed -n '1,80p'
   ```

2. Against the intended database, use a read-only session to enumerate the
   checked-in analytics objects and their grants:

   ```sql
   SELECT table_name, table_type
   FROM information_schema.tables
   WHERE table_schema = 'analytics'
   ORDER BY table_name;

   SELECT grantee, table_name, privilege_type
   FROM information_schema.role_table_grants
   WHERE table_schema = 'analytics'
   ORDER BY grantee, table_name, privilege_type;
   ```

3. For hosted operations, inspect the deployed schedule and task definition
   through the authenticated AWS identity:

   ```bash
   aws scheduler get-schedule --name proliferate-analytics-ingest-nightly
   aws ecs describe-task-definition --task-definition proliferate-analytics-ingest
   aws logs tail /ecs/proliferate-analytics-ingest --since 1d
   ```

   Treat the returned task revision, image, schedule, and log timestamps as
   live evidence. The checked-in JSON files are desired/replay inputs and do
   not prove they are deployed.

4. In Metabase, inspect the database sync status and the query behind each
   relevant card. Confirm that it reads `analytics.*`, has the intended date
   filter, and returns a recent source date. Dashboard names, card counts, and
   current freshness are provider state, not repository law.

5. Compare freshness without exposing row-level identity:

   ```sql
   SELECT 'stripe_revenue_daily' AS object, max(activity_date) AS latest
   FROM analytics.stripe_revenue_daily
   UNION ALL
   SELECT 'aws_cost_daily', max(activity_date) FROM analytics.aws_cost_daily
   UNION ALL
   SELECT 'e2b_cost_daily', max(activity_date) FROM analytics.e2b_cost_daily
   UNION ALL
   SELECT 'sentry_errors_daily', max(activity_date) FROM analytics.sentry_errors_daily;
   ```

## Diagnose A Gap

- If an object is absent, compare the database Alembic revision with
  migrations `a9b0c1d2e3f4` and `15649bf2cf24` before changing dashboards.
- If one provider is stale, read that provider's lines in the ingestion log.
  Providers commit independently; one provider can be stale while the job and
  other providers succeed.
- Missing Stripe, E2B, or Sentry configuration causes that provider to skip.
  AWS uses the ambient task role. Do not infer a configured provider merely
  from keys named in a task definition.
- The E2B path uses a short-lived browser session cookie. An authorization
  warning is evidence that an authorized operator must refresh the stored
  credential through the approved secret-management channel; do not recover
  or paste it into a command.
- If a card is wrong while its source view is correct, fix provider-side card
  configuration through the normal reviewed operator process. If the durable
  view is wrong, change its migration in a code review rather than embedding
  corrective SQL only in Metabase.

Do not manually run the ingestion script during discovery: it upserts
analytics tables. A rerun or any provider/database/configuration write requires
separate authorization and an audit trail.
