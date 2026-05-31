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

## Upload Contract

Desktop authenticates only to Proliferate Cloud. It never receives AWS
credentials.

Cloud owns:

- `POST /v1/support/report-uploads`
- `POST /v1/support/reports/{reportId}/complete`

Upload initiation validates message, scope, diagnostics, and attachment
metadata, writes `request.json` to the private support S3 prefix, and returns
short-lived presigned `PUT` targets. Completion verifies uploaded objects,
writes `complete.json`, and posts the internal Slack notification. Slack
failure is logged server-side behavior and does not fail a completed report.

The S3 bucket must be private with public access blocked, server-side
encryption, lifecycle retention, and least-privilege server IAM.
