# Support Debug Correlation Follow-Ups

This doc is not current operating law. The implemented support-reporting
contract lives in `docs/features/support-reporting.md`, and telemetry behavior
lives in `docs/dev/analytics/sentry.md` and `docs/dev/analytics/posthog.md`.

## Implemented Baseline

Desktop support reports now use a durable Cloud case file:

- server-generated `reportId`
- idempotency by authenticated user and `clientJobId`
- stable private S3 prefix stored in the database
- split create, upload-target, and complete APIs
- server-written `request.json`, `complete.json`, and cloud diagnostics when
  authorized cloud workspace references are present
- top-level server correlation IDs in client diagnostics
- server-trusted cloud workspace references, with unauthorized client-supplied
  cloud IDs persisted only as `cloud:[unverified]`
- immutable upload manifests and completion checks that require every expected
  object to be uploaded
- redacted Desktop session diagnostics that preserve event/config shape without
  copying prompt, transcript, notification, or tool-output bodies
- structured server log and Sentry correlation context
- low-cardinality Desktop `support_report_submitted` PostHog event
- optional PostHog and Desktop Sentry pivot IDs in the private support request
  object when hosted-product telemetry is enabled

## Deferred Work

- Move Web and Mobile support surfaces onto the same split report lifecycle.
- Add an investigator-facing lookup tool that takes `reportId` and returns S3,
  Sentry, PostHog, CloudWatch, Cloud DB, and runtime target pivots.
- Add CloudWatch Logs Insights saved queries or dashboards for tenant/report
  correlation.
- Add relational indexes or a normalized companion table for common support
  correlation fields once investigator query patterns settle.
- Collect runtime tail logs for cloud targets only when an already-running
  managed target can be proven reachable without waking it.
- Add a server-side sweeper for old `created` or `uploading` reports that never
  complete.
