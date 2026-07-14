# Debugging

Status: authoritative for developer-facing debugging process.

Use this folder for issue triage, support-report correlation, production/local
debugging, and performance profiling. Product behavior belongs under
`specs/codebase/**`; this folder owns operator workflow.

## General Issue Runbook

1. Start from the GitHub issue when one exists. Support-submitted issues should
   link to the internal support report and any Linear ticket.
2. Use the support report id, tenant id, user id, organization id, Cloud
   sandbox id, provider sandbox id, repo-environment materialization id, Cloud
   workspace id, AnyHarness workspace id, session id, Worker id, and request id
   to correlate Cloud records, Sentry events, logs, and S3 diagnostics.
3. Check Sentry for matching exceptions or native crashes before assuming the
   report is purely product confusion.
4. Check recent deploys and release artifacts when the issue follows a deploy,
   updater publish, runtime rollout, or cloud worker change.
5. Reproduce locally with an isolated dev profile when the issue needs code
   inspection or a stateful workflow.
6. Capture the narrowest useful evidence: failing request, request id, run id,
   screenshot, sanitized log tail, and exact surface/version.
7. Update the GitHub issue with the diagnosis, linked PR or deploy, and any
   user-facing owner needed.

If there is no GitHub issue yet, search for an existing issue before creating a
new one. If the failure came from a support report, create or update the issue
with the stable support ids instead of free-form user content.

## Correlation Keys

Use stable ids to move between product surfaces, Cloud state, observability,
and support artifacts:

| Key | Use |
| --- | --- |
| Support report id | Find uploaded diagnostics, sanitized logs, screenshots, and support-submitted GitHub/Linear links. |
| Tenant id / organization id | Scope Cloud DB state, billing/account state, team settings, Metabase rows, and support dashboards. |
| User id | Correlate account state, auth readiness, provider links, and user-scoped Sentry/PostHog events. |
| Cloud sandbox id / provider sandbox id | Correlate the user's persisted sandbox, E2B provider state, runtime-access presence, and server logs. |
| Repo environment / materialization id | Inspect repository setup state, materialization status, and the persisted materialization error. |
| Cloud workspace id | Inspect the product workspace row, repository environment, archive state, and AnyHarness workspace handoff. |
| AnyHarness workspace id | Follow local/runtime workspace state, sessions, transcript streams, and runtime diagnostics. |
| Session id | Match transcript rows, runtime events, pending prompts, and Sentry support tags. |
| Worker id | Inspect enrollment, heartbeat-derived liveness, reported versions, integration-gateway state, and Worker logs. |
| Request id | Follow one mounted API, gateway, webhook, or materialization request through structured logs and Sentry. |

## Tools And Permissions

Required tools and surfaces:

- GitHub MCP, `gh`, or GitHub web access for issues, PRs, labels, linked fixes,
  workflow runs, and release artifacts.
- Local shell access with `make dev PROFILE=<name>` for reproduction.
- Browser or Chrome access with the right logged-in profile for GitHub, Stripe,
  Vercel, Sentry, PostHog, Customer.io, Metabase, AWS, Apple, or Expo
  dashboards when needed.
- S3/support-report access through the internal support tooling, never public
  object access.
- Sentry access for production exceptions, native crashes, release health, and
  support correlation tags.
- AWS/GitHub Actions access when the issue may be deploy, ECS, S3, CloudFront,
  updater, ECR, or SSM related.

Required permissions depend on the issue surface:

| Surface | Permissions |
| --- | --- |
| GitHub issue/PR triage | repo read access; repo write access when labels, comments, or fixes are needed |
| Support reports | internal support-report access and S3 diagnostic access through approved tooling |
| Production errors/crashes | Sentry project access for the affected app/runtime |
| Hosted deploy or infra | GitHub Actions access and AWS/Vercel/E2B access for the affected lane |
| Billing | Stripe access plus GitHub/AWS env access only when config repair is required |
| Analytics/replay | PostHog, Metabase, Customer.io, or Sentry access for the affected tool |
| Mobile/App Store | Expo/EAS and App Store Connect access when build or submit state is involved |

## Specific Runbooks

- [support-reports.md](support-reports.md): end-to-end support report triage
  across Cloud DB state, S3, CloudWatch, Sentry, GitHub, Linear, Slack, and
  Desktop retry behavior.
- [performance-profiling.md](performance-profiling.md): privacy-safe renderer
  and AnyHarness timing baselines.
- [../runbooks/stripe-webhook-failure.md](../runbooks/stripe-webhook-failure.md):
  Stripe webhook delivery, replay, and billing mirror recovery.
- [../runbooks/e2b-template-rollback.md](../runbooks/e2b-template-rollback.md):
  E2B template rollback for managed cloud runtime release failures.
- [../analytics/sentry.md](../analytics/sentry.md): Sentry projects, privacy,
  support correlation, alerts, and release/debug uploads.
- [../local/README.md](../local/README.md): local reproduction with dev
  profiles.
- [../deploying/ci-cd.md](../deploying/ci-cd.md): deploy and release failure
  response.

## Final Report Shape

When finishing debugging work, report:

- GitHub issue, support report, PR, deploy run, or release artifact inspected
- affected surface, environment, version, commit SHA, tenant/org/user ids, and
  sandbox/materialization/workspace/session/Worker/request ids when relevant
- shortest confirmed reproduction path or why reproduction was not possible
- Sentry, logs, dashboards, or workflow evidence checked
- diagnosis, linked fix/deploy, remaining owner, and user-facing owner
- secrets or sensitive content omitted from the report
