# Support Reporting

Support reporting is the production support path for Desktop. The app opens a
dedicated Tauri support window, collects an explicit user message and optional
attachments, packages bounded diagnostics in the main window, and uploads the
result through Proliferate Cloud-issued presigned S3 URLs.

`Cmd/Ctrl+S` is currently the Support shortcut.

## Desktop UX

The support surface is a separate Tauri webview window labeled `support`, not a
modal in the main app. The first focus target is the issue textarea.

The production window shows:

- `What happened?` textarea.
- Attachment drop/paste/file picker with remove controls.
- Diagnostics scope radio group:
  - `Most recent workspace`
  - `Choose workspace`
  - `App only`
- Checked-by-default public issue consent:
  - `Include my message in the public issue`
- `Cancel` and `Send`.

`Most recent workspace` is automatic: Desktop uses the active workspace when
available, otherwise the most recently updated known workspace. The workspace
picker is shown only for `Choose workspace`.

`Send` is enabled when the user provides message text or at least one
attachment. Clicking `Send` emits a support report job to the main app and
closes the support window immediately. Progress and failure notifications are
shown from the main app toast system.

The public issue consent controls only the user's written message. Diagnostics,
S3 object keys, presigned URLs, uploaded file bodies, and attachment contents
remain private. If consent is unchecked, Cloud still creates the public GitHub
issue, but the issue body says the submitter did not opt in to publishing their
message, the issue title uses a generic support-report title, and the issue
applies the configured private label.

Upload failures distinguish retryable transfer errors from blocked setup
states. Missing Cloud sign-in, dev auth bypass, and missing server storage
configuration keep the report queued but show actionable copy instead of the
generic background-retry message. Local payload problems such as oversized or
missing attachment data are terminal and ask the user to submit again with a
smaller payload.

Development builds may keep the old manual debug exports available behind the
legacy support dialog. Production UI must not expose raw export names such as
active session JSON, workspace JSON, debug bundle, or investigation JSON.

## Diagnostics

Desktop diagnostics are collected outside the support webview so closing the
window does not lose the job.

Native code always returns a structured support diagnostics bundle with:

- Manifest: app version, runtime version/status/home, platform, timestamp.
- AnyHarness `/health` when the active runtime is healthy.
- Tail of `~/.proliferate/logs/desktop-native.log`.
- Tail of `<runtimeHome>/logs/anyharness.log`.
- At most the current log plus newest rotated file for each source.
- A 2 MB pre-compression cap per log file.

Native diagnostics scrub home paths, bearer tokens, env-style token/key/secret
values, signed URL query values, and long opaque strings.

Workspace diagnostics are collected through AnyHarness APIs for the selected
workspace IDs only. The package includes recent sessions, session summaries,
recent normalized events, live config snapshots, and raw notification metadata
with notification bodies redacted. Collection enforces global caps and does not
include full workspace history by default.
Desktop applies the same session-debug sanitizer used by manual exports before
uploading support diagnostics, so prompt bodies, message text, raw tool input,
raw tool output, and raw live-config prompt/config content are represented by
shape/length placeholders rather than copied verbatim.

Desktop uploads `diagnostics.json` with `schemaVersion: 2`. The package has a
top-level `correlation` object supplied by Cloud and does not duplicate the
user's free-form message body. It records `messagePresent` and `messageLength`
so investigators know whether the private `request.json` contains user-written
context.

Cloud workspace diagnostics are server-written. When a report references
authorized cloud workspaces, Cloud writes `cloud-diagnostics.json` after the
support report database row and `request.json` have been committed. Cloud
workspace references in the case file are server-derived from the database; if
the client sends an unknown or unauthorized cloud workspace ID, the persisted
reference is marked `cloud:[unverified]` and is excluded from server
correlation IDs. The cloud diagnostics file is an allowlisted metadata snapshot:
workspace, target, runtime access, sandbox, command, session, event-ingest,
setup-run, and transcript item metadata. It does not copy prompt bodies,
transcript bodies, raw command payloads, tool output, provider tokens,
ciphertexts, cookies, signed URLs, or attachment contents. It also does not
wake stopped sandboxes or create runtime sessions just to collect diagnostics.

## Upload Contract

Desktop authenticates only to Proliferate Cloud. It never receives AWS
credentials.

Cloud owns:

- `POST /v1/support/reports`
- `POST /v1/support/reports/{reportId}/upload-targets`
- `POST /v1/support/reports/{reportId}/complete`
- `POST /v1/support/reports/{reportId}/tracker`
- `POST /v1/support/report-uploads` as the legacy compatibility wrapper

`POST /v1/support/reports` creates or returns the durable case file for the
authenticated user and `clientJobId`. Cloud stores a `support_report` database
row with a stable `reportId`, S3 bucket/prefix, owner user, primary tenant,
tenant list, source context, normalized workspace refs, telemetry refs, upload
manifest, immutable expected upload intent, immutable public issue consent, and
cloud-diagnostics status. Idempotent retries by the same user and `clientJobId`
return the existing report without overwriting the original user message,
consent, or attachment intent.

Report creation writes `request.json` to the private support S3 prefix. This
object contains the user message, source context, workspace refs, telemetry
refs, and server-derived correlation IDs. It must not contain presigned URLs.

`POST /v1/support/reports/{reportId}/upload-targets` validates diagnostics and
attachment metadata for the report owner, persists the expected object manifest,
and returns short-lived presigned `PUT` targets. Clients may call it again while
the report is still uploadable to refresh expired URLs and re-issue targets for
re-captured diagnostics. The expected **object set** is immutable — the object
keys plus the upload intent (diagnostics flag and attachment count) cannot
change, and a retry that alters them is rejected
(`support_report_upload_conflict`). Per-object content metadata (size/sha256) is
refreshed from the latest re-issue, because diagnostics are legitimately
re-captured on each client retry; completion then verifies against the refreshed
manifest. Re-issue must stay idempotent by object identity — comparing full
content (size/sha256) rejected every retry forever and was the cause of the
support-report "could not be sent" retry loop.

`POST /v1/support/reports/{reportId}/complete` verifies uploaded object keys are
inside the stored report prefix, requires every object in the stored manifest to
be present exactly once, verifies completion object size and checksum values
against the stored upload manifest (refreshed by the latest re-issue), verifies
object sizes with S3 metadata,
writes `complete.json`, marks the report completed, and posts the internal
Slack notification once. Slack failure is logged server-side and does not fail
an otherwise completed report.

If the persisted expected upload intent says `diagnostics=false` and
`attachmentCount=0`, completion is allowed without an upload-target manifest.
This is the Web/mobile/App-only compatibility path.

The legacy `POST /v1/support/report-uploads` wrapper remains for old clients. It
uses the same Cloud-owned S3 bucket and completion behavior, but new clients
should use the split report lifecycle.

The legacy `POST /v1/support/messages` route is a zero-upload compatibility shim
over the report lifecycle. It never opts user text into public GitHub content.

## Issue Trackers

Completed database-backed support reports are reconciled server-side into a
GitHub issue and, when Linear is configured, a Linear issue. Desktop/Web may
call `POST /v1/support/reports/{reportId}/tracker` as a status/nudge endpoint,
but issue creation does not depend on the client staying open.

GitHub is the primary public tracker. The support bot creates or updates one
issue per `reportId`, using a hidden support-report marker for idempotency and
the configured labels:

- `SUPPORT_GITHUB_LABEL_SUPPORT` on every issue.
- `SUPPORT_GITHUB_LABEL_PRIVATE` when public issue consent is unchecked.

Linear is optional and private/internal. Linear failure leaves the GitHub issue
intact and records a retryable partial tracker state. When both trackers exist,
the server crosslinks them by updating the GitHub body with the Linear URL and
the Linear description with the GitHub URL.

Tracker state is stored on `support_report` with per-vendor status, IDs, URLs,
attempt counts, retry timestamps, and Slack-notification timestamps. The server
also writes `tracker.json` under the same private S3 prefix so S3-only backfills
can detect reports that still need tracker reconciliation.

Slack receives two best-effort notifications: the report completion receipt and,
once available, a tracker-links update. Slack messages contain the `reportId`,
an internal report URL when configured, and tracker URLs. They never include S3
keys, S3 prefixes, presigned URLs, diagnostics bodies, or uploaded file content.

## Debug Correlation

Each support report is the durable pivot for debugging user-visible issues
across local diagnostics, Cloud DB state, server logs, Sentry, PostHog, and
reachable runtime targets.

Server-derived correlation includes:

- `reportId`
- `requestId`
- `ownerUserId`
- `primaryOrganizationId`
- `primaryTenantId`
- `tenantIds`
- `cloudWorkspaceIds`
- `cloudTargetIds`
- `anyharnessWorkspaceIds`
- `sessionIds`

The server writes these IDs into the support report response, `request.json`,
`diagnostics.json`, `cloud-diagnostics.json`, structured server logs, and Sentry
context/tags where safe. Desktop also emits the low-cardinality
`support_report_submitted` product event through the typed telemetry path so
PostHog can be used as a replay/session pivot when hosted-product telemetry is
enabled. When hosted-product telemetry is enabled, `request.json` may also
include the current PostHog distinct/session IDs and recent Desktop Sentry event
IDs so an investigator can jump from the support report to replay and exception
contexts without relying on user-entered text.

Cloud logging records request, user, tenant, support report, cloud workspace,
target, sandbox, session, interaction, command, and worker
fields when available. Log payloads must scrub auth headers, bearer tokens,
secret/key/token environment values, ciphertext-looking values, signed URLs,
and long opaque token strings.

The S3 bucket must be private with public access blocked, server-side
encryption, lifecycle retention, and least-privilege server IAM.
