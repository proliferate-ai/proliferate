# Debugging

Status: authoritative for developer-facing debugging process.

Use this folder for issue triage, support-report correlation, production/local
debugging, and performance profiling. Product behavior belongs under
`specs/codebase/**`; this folder owns operator workflow.

## General Issue Triage

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

## Tools And Permissions

- GitHub issue and PR access for triage, labels, and linked fixes.
- S3/support-report access through the internal support tooling, never public
  object access.
- Sentry access for production exceptions, native crashes, and support
  correlation tags.
- AWS/GitHub Actions access when the issue may be deploy, ECS, S3, CloudFront,
  updater, ECR, or SSM related.
- Local shell access with `make dev PROFILE=<name>` for reproduction.
- Browser access with the right logged-in profile for GitHub, Stripe, Vercel,
  Sentry, PostHog, Customer.io, Metabase, or Apple/Expo dashboards when needed.

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
