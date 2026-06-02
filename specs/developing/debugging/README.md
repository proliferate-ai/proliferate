# Debugging

Status: authoritative for developer-facing debugging process.

Use this folder for issue triage, support-report correlation, production/local
debugging, and performance profiling. Product behavior belongs under
`specs/codebase/**`; this folder owns operator workflow.

## General Issue Runbook

1. Start from the GitHub issue when one exists. Support-submitted issues should
   link to the internal support report and any Linear ticket.
2. Use the support report id, tenant id, user id, organization id, cloud
   workspace id, AnyHarness workspace id, session id, command id, and worker id
   to correlate Cloud records, Sentry events, logs, and S3 diagnostics.
3. Check Sentry for matching exceptions or native crashes before assuming the
   report is purely product confusion.
4. Check recent deploys and release artifacts when the issue follows a deploy,
   updater publish, runtime rollout, or cloud worker change.
5. Reproduce locally with an isolated dev profile when the issue needs code
   inspection or a stateful workflow.
6. Capture the narrowest useful evidence: failing command, request id, run id,
   screenshot, sanitized log tail, and exact surface/version.
7. Update the GitHub issue with the diagnosis, linked PR or deploy, and any
   user-facing follow-up needed.

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
| Cloud workspace id | Inspect server workspace state, exposures, command history, cloud target state, and workspace visibility. |
| AnyHarness workspace id | Follow local/runtime workspace state, sessions, transcript streams, and runtime diagnostics. |
| Session id | Match transcript rows, runtime events, pending prompts, and Sentry support tags. |
| Command id | Trace cloud command enqueue, lease, delivery, failure, and result state. |
| Worker id / target id | Inspect target registration, worker logs, status updates, and supervisor/worker health. |

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
  workspace/session/command ids when relevant
- shortest confirmed reproduction path or why reproduction was not possible
- Sentry, logs, dashboards, or workflow evidence checked
- diagnosis, linked fix/deploy, remaining owner, and user-facing follow-up
- secrets or sensitive content omitted from the report
