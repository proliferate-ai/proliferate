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
- `Cancel` and `Send`.

`Most recent workspace` is automatic: Desktop uses the active workspace when
available, otherwise the most recently updated known workspace. The workspace
picker is shown only for `Choose workspace`.

`Send` is enabled when the user provides message text or at least one
attachment. Clicking `Send` emits a support report job to the main app and
closes the support window immediately. Progress and failure notifications are
shown from the main app toast system.

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

Desktop uploads `diagnostics.json` with `schemaVersion: 2`. The package has a
top-level `correlation` object supplied by Cloud and does not duplicate the
user's free-form message body. It records `messagePresent` and `messageLength`
so investigators know whether the private `request.json` contains user-written
context.

Cloud workspace diagnostics are server-written. When a report references
authorized cloud workspaces, Cloud writes `cloud-diagnostics.json` under the
same support S3 prefix. The cloud diagnostics file is an allowlisted metadata
snapshot: workspace, target, runtime access, sandbox, command, session,
event-ingest, setup-run, and transcript item metadata. It does not copy prompt
bodies, transcript bodies, raw command payloads, tool output, provider tokens,
ciphertexts, cookies, signed URLs, or attachment contents. It also does not
wake stopped sandboxes or create runtime sessions just to collect diagnostics.

## Upload Contract

Desktop authenticates only to Proliferate Cloud. It never receives AWS
credentials.

Cloud owns:

- `POST /v1/support/reports`
- `POST /v1/support/reports/{reportId}/upload-targets`
- `POST /v1/support/reports/{reportId}/complete`
- `POST /v1/support/report-uploads` as the legacy compatibility wrapper

`POST /v1/support/reports` creates or returns the durable case file for the
authenticated user and `clientJobId`. Cloud stores a `support_report` database
row with a stable `reportId`, S3 bucket/prefix, owner user, primary tenant,
tenant list, source context, normalized workspace refs, telemetry refs, upload
manifest, and cloud-diagnostics status. Idempotent retries by the same user and
`clientJobId` return the existing report without overwriting the original user
message or attachment intent.

Report creation writes `request.json` to the private support S3 prefix. This
object contains the user message, source context, workspace refs, telemetry
refs, and server-derived correlation IDs. It must not contain presigned URLs.

`POST /v1/support/reports/{reportId}/upload-targets` validates diagnostics and
attachment metadata for the report owner, persists the expected object manifest,
and returns short-lived presigned `PUT` targets. Clients may call it again to
refresh expired URLs while the report is still uploadable.

`POST /v1/support/reports/{reportId}/complete` verifies uploaded object keys are
inside the stored report prefix, verifies object sizes with S3 metadata, writes
`complete.json`, marks the report completed, and posts the internal Slack
notification once. Slack failure is logged server-side and does not fail an
otherwise completed report.

The legacy `POST /v1/support/report-uploads` wrapper remains for old clients. It
uses the same Cloud-owned S3 bucket and completion behavior, but new clients
should use the split report lifecycle.

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
enabled.

Cloud logging records request, user, tenant, support report, cloud workspace,
target, sandbox, session, interaction, command, worker, and slot-generation
fields when available. Log payloads must scrub auth headers, bearer tokens,
secret/key/token environment values, ciphertext-looking values, signed URLs,
and long opaque token strings.

The S3 bucket must be private with public access blocked, server-side
encryption, lifecycle retention, and least-privilege server IAM.
