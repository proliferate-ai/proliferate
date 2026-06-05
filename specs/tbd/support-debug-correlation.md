# Support Debug Correlation Notes

The implemented support-reporting contract lives in
`specs/codebase/features/support-reporting.md`, and telemetry behavior lives in
`specs/developing/analytics/sentry.md` and
`specs/developing/analytics/posthog.md`.

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
