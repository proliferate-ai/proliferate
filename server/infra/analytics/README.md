# Analytics Infrastructure Artifacts

This directory contains checked-in inputs for Proliferate's hosted provider
analytics ingestion. It is not the canonical system or operating contract,
and the presence of an artifact does not prove that matching infrastructure,
credentials, dashboards, or fresh data exist in a live environment.

Canonical owners:

- [Metabase and durable analytics views](../../../specs/codebase/systems/engineering/analytics/metabase.md)
- [Metabase operating procedure](../../../specs/developing/operating/analytics/metabase.md)

## Artifact Map

| File | Purpose |
| --- | --- |
| `bootstrap.sql` | Idempotent fallback DDL for the provider snapshot tables, derived analytics views, and best-effort `metabase_readonly` grants. Keep its overlapping objects aligned with Alembic revision `15649bf2cf24`. Normal deployments use Alembic. |
| `ecs-taskdef.json` | ECS Fargate task-definition input for `server/scripts/analytics_ingest.py`, including secret references and CloudWatch logging configuration. |
| `eventbridge-target.json` | Scheduler target input for the ECS task. |
| `iam-task-role-policy.json` | Cost Explorer and scoped Secrets Manager permissions for the ingestion task role. |
| `iam-scheduler-policy.json` | `ecs:RunTask` and `iam:PassRole` permissions for the scheduler role. |

Live task revisions, image identity, schedule, provider configuration,
database grants, Metabase cards, and freshness must be discovered read-only at
execution time. Do not paste secret values into commands, logs, screenshots,
issues, PRs, documentation, or chat.
