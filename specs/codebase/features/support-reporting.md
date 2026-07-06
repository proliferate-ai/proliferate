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

### In-app feedback and prompt modals

Desktop also exposes two lightweight in-app modals that submit through the same
report lifecycle: a bug modal ("Send feedback") and a prompt modal ("Submit a
prompt"). Both share one modal-state hook, build the same `SupportReportJob`,
and reuse the upload queue.

The bug modal, below the message textarea and attachment zone, shows in order:

- `This is urgent` — sets the report's `urgent` capture flag. When checked it
  reveals the helper line "We'll send you an email by tomorrow."
- `Let me know when you fix this` — sets `notifyMe`. When checked it reveals
  "We'll send you an update within a day."
- `Credit me` — reveals a name input; when consented the name is sent as
  `creditName` (same interaction as the prompt modal's credit field).
- `Include app logs` — defaults ON. When turned OFF, the report's
  `expectedClientUploads.diagnostics` is `false` and the upload pipeline skips
  collecting and uploading `diagnostics.json` for that job. If logs are off and
  there are no attachments, the client completes the report directly with no
  upload-target manifest (the diagnostics=false / attachmentCount=0 path).

The prompt modal keeps its `Credit me if this merges` field and adds
`Let me know when you merge this`, which sets `notifyMe`. Prompt submissions
never set `urgent` and always include diagnostics (there is no logs toggle on
that surface).

Both modals render a muted footer above the action buttons reading
"Updates go to {email} · change", where `{email}` is the user's
`outreach_email` override when set, otherwise their account email (from
`GET /v1/users/me`). "change" swaps to an inline email editor whose save
PATCHes `/v1/users/me` `outreach_email` (account-wide, not per-report); an empty
value clears the override and an invalid address surfaces the server's 422 as an
inline error.

`urgent`, `notifyMe`, and the logs choice flow from the modal state through the
`SupportReportJob` into `buildCreateReportRequest`. They are optional on the
persisted job with defaults (`urgent`/`notifyMe` false, logs included) so jobs
queued before this change still upload unchanged.

Server-side, `credit_name` is persisted whenever `credit_consent` is true,
regardless of report `kind` — the bug modal's `Credit me` field needed the
same persistence the prompt modal already had (previously gated to
`kind == "feature"` only).

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

Reports also carry two capture-only intent flags, `urgent` and `notifyMe`,
persisted on the `support_report` row (`urgent`, `notify_me`) and mirrored into
`request.json` (`urgent`, `notifyMe`). `urgent` marks a report the submitter
flagged as time-sensitive; `notifyMe` records that the submitter asked to be
contacted about the outcome. Both default to false and are capture signals
only — they carry no resolution/triage state, which lives in a separate ops
service. Follow-up, when requested, goes to the submitter's `outreach_email`
override (see below) when set, otherwise their account email.

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

The completion receipt surfaces the capture flags: `urgent` reports get a clear
leading urgent marker in the Slack title, and every report renders `Urgent:
Yes/No` and `Notify requested: Yes/No` fields so a responder can triage without
opening the case file.

## User Outreach Email

Each user may set an optional `outreach_email` override on their profile
(`PATCH /v1/users/me`, exposed on `GET /v1/users/me`). It is the address the
user prefers for support/outreach follow-up; sending an empty string or `null`
clears it and falls back to the account email. A non-empty value must validate
as an email. This is account-level profile state, independent of any single
report.

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
