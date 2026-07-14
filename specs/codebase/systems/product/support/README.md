# Support reporting

Status: authoritative for the currently shipped support-capture path.

Support reporting captures private customer feedback and diagnostic evidence.
It does not own issue triage, automated repair, release tracking, or reporter
outreach. The authoritative downstream issue, attribution, release, and
changelog contract lives in [`../../engineering/issue-lifecycle/support-loop.md`](../../engineering/issue-lifecycle/support-loop.md).

## Product boundary

The current contract ends here:

```text
Desktop/Web -> authenticated support API -> support_report + private S3 bundle
                                            -> best-effort Slack receipt
```

There is no active server tracker reconciler, GitHub/Linear projection,
completed-report feed, issue queue, resolution state, or notification-on-fix
worker. Legacy tracker columns, integrations, configuration, and historical S3
objects may still exist; they are not part of the active product behavior.

## Availability and entry points

The server advertises one of three support capabilities:

```text
vendor    hosted Proliferate support; open the in-app feedback surface
operator  self-managed operator configured a URL or email; open that destination
none      no support destination; render no support action
```

Every support entry point must use that capability. Product UI must never route
a self-managed user to vendor support. The sidebar and command/menu action use
`deriveSupportMenuAction`; any direct modal opening outside that boundary is a
migration exception.

Hosted Desktop has two private in-app modals:

- **Send feedback** for bugs and operational feedback.
- **Submit a prompt** for feature ideas expressed as an agent prompt.

The modals are rendered inside the main app. There is no dedicated Tauri
support webview window in the current implementation.

## Feedback modal

The feedback modal contains:

- a `What happened?` textarea;
- attachment picker, paste, and drop support;
- `This is urgent`;
- `Let me know when you fix this`;
- `Credit me`, with a name field when selected;
- `Include app logs`, enabled by default;
- the current outreach address and an inline way to change it;
- `Cancel` and `Send`.

Send is enabled when the user supplies text or at least one attachment.

`urgent` and `notifyMe` are capture intent only. The current system does not
enforce an urgent response SLA and does not send a fix notification. Copy must
not imply an automated outcome that does not exist.

Turning off `Include app logs` sets the immutable upload intent to
`diagnostics=false`. If there are no attachments, the client completes the
report without requesting upload targets.

## Prompt modal

The prompt modal contains:

- a prompt textarea;
- `Credit me if this merges`, with a name field when selected;
- the current outreach address and an inline way to change it;
- `Cancel` and `Send`.

Prompt reports use `kind=feature`, never set `urgent`, and include diagnostics.
The current UI has no notify-on-merge control. A hidden/default `notifyMe=false`
value is not a user promise.

## Privacy

Support reports are private by default and in the current Desktop flow
`publicContentConsent` is always false.

Rules:

- user text lives in the private `request.json` object;
- diagnostics and attachments are private;
- presigned URLs, AWS credentials, S3 object contents, prompts, tool I/O,
  transcript bodies, tokens, and signed URLs never enter public issues,
  telemetry, or ordinary logs;
- an old `public_content_consent` column does not authorize publishing current
  report content;
- introducing a public issue projection requires a new explicit consent and
  privacy contract.

## Desktop job and queue

Both modals create the same `SupportReportJob` shape and dispatch it to the
single upload queue owner.

Important fields:

```text
jobId, createdAt
message
kind                         bug | feature
urgent, notifyMe
creditConsent, creditName
includeLogs
scope, workspace references
source context and telemetry references
attachments
active workspace/session and report-opened timestamp
```

The job is persisted locally before upload and retried across app restarts.
Report creation is idempotent on the server by authenticated user and
`clientJobId`.

Retry behavior distinguishes:

- blocked states such as auth or server storage configuration;
- transient transport/provider failures;
- terminal local payload failures;
- terminal server upload conflicts or rejected payloads;
- an already-completed response, which is treated as successful cleanup.

The client must validate the server's message, attachment count, filename,
credit-name, and byte limits before enqueue. HTTP validation responses are
terminal for the unchanged payload, not background-retry candidates.

The queue must never silently evict a report. Any capacity limit must reject a
new enqueue explicitly or durably archive an old terminal job, and staged
attachment files must be deleted only after success or an explicit terminal
outcome.

## Workspace scope

The current modals automatically use the active/default workspace when one is
available and otherwise use `app_only`. The current UI does not present the old
`Most recent workspace / Choose workspace / App only` radio group.

Client workspace references are treated as claims. The server derives trusted
cloud correlation only from authorized resources. Unknown or unauthorized
cloud IDs must not become trusted correlation identifiers.

## Diagnostics

Native diagnostics may include:

- app/runtime version and health metadata;
- bounded Desktop native and AnyHarness log tails;
- platform and runtime-home metadata;
- recent sessions and summaries for selected workspaces;
- bounded normalized events;
- live config metadata;
- raw notification metadata with bodies removed.

Native log collection scrubs home paths, bearer tokens, env-style
key/token/secret values, signed URL query parameters, and long opaque strings.

The Desktop diagnostic package uses `schemaVersion: 2`. It does not duplicate
the report message. It includes only:

```text
messagePresent
messageLength
```

The package runs session data through the session-debug sanitizer. Prompt and
message bodies, raw tool input/output, event content, notification bodies, and
sensitive live-config values are represented by redacted shape/length
placeholders.

Server-side `cloud-diagnostics.json` collection is disabled. The current server
returns `cloudDiagnosticsStatus=not_applicable`; `diagnostics.py` is a no-op
guard left after the cloud target/sandbox model cutover.

## HTTP contract

Clients authenticate only to Proliferate. They never receive AWS credentials.

Active endpoints:

```text
POST /v1/support/reports
POST /v1/support/reports/{reportId}/upload-targets
POST /v1/support/reports/{reportId}/complete
POST /v1/support/report-uploads                 legacy compatibility wrapper
POST /v1/support/messages                       zero-upload compatibility shim
GET  /internal/support/reports                   private completed-report feed
```

There is no active `/tracker` endpoint.

`GET /internal/support/reports` is a private machine route (externally
`/api/internal/support/reports`), separate from user/web auth. It requires a
dedicated `SUPPORT_FEED_BEARER_TOKEN` compared in constant time; an unset token
rejects every request so the feed is dark-deployable. It returns only completed
reports ordered by `(completed_at, id)` behind a versioned authenticated opaque
cursor, and never exposes the message, diagnostics, attachments, object keys,
signed URLs, account email, or log bodies. The downstream contract lives in
[`../../engineering/issue-lifecycle/support-loop.md`](../../engineering/issue-lifecycle/support-loop.md).

### Create

`POST /v1/support/reports` creates or returns the durable case file for the
authenticated user and `clientJobId`.

The immutable create intent includes:

```text
message and source context
scope and workspace references
telemetry references
expected diagnostics boolean and attachment count
kind, urgent, notifyMe
creditConsent, creditName
private content-consent state
```

An idempotent retry returns the existing report without replacing the original
message, intent, or object set.

After inserting the row, the server writes private `request.json`. It contains
the message, capture intent, references, and server-derived correlation. It
must not contain a presigned URL.

### Upload targets

`POST /v1/support/reports/{reportId}/upload-targets`:

- requires report ownership;
- validates diagnostics and attachment metadata;
- locks the expected object set and upload intent;
- returns short-lived presigned `PUT` targets;
- may be called again to refresh expired URLs and refreshed content metadata;
- rejects a changed object set, diagnostics intent, or attachment count.

Re-captured diagnostics may legitimately have new size and SHA-256 metadata on
a re-issue. The latest target manifest is the completion contract.

### Complete

`POST /v1/support/reports/{reportId}/complete`:

- verifies every object key is inside the stored report prefix;
- requires exactly the stored object set;
- checks completion size/checksum claims against the latest manifest;
- independently verifies object size through S3 metadata;
- writes `complete.json`;
- marks the row completed;
- attempts one Slack completion receipt during the first successful completion
  transition.

The S3 `HEAD` response does not prove object SHA-256; the checksum comparison is
client-claim consistency, while object size is independently verified.

Slack failure does not roll back a completed report. `slack_notified_at` is
written only after the webhook call succeeds. A missing webhook or provider
error is logged and leaves the timestamp null for later recovery.

## Persistence and private objects

The `support_report` row is the durable capture pivot. Current capture columns
include owner/client identity, lifecycle, S3 location, source/scope/reference
JSON, expected and actual object manifests, kind/credit/urgent/notify intent,
request IDs, timestamps, and Slack receipt state.

Two immutable capture columns feed the downstream tracker projection:

- `client_release_id` — the canonical `<component>@<semver>+<12-char-sha>`
  release the client was running. A missing or malformed value stores NULL; the
  row stays feedable with a visible warning. `telemetry_refs_json` normalizes
  Sentry references to `{"sentryEvents": [{"project", "eventId"}]}`; project-less
  event IDs are insufficient to form a pair and are never guessed.
- `tracker_summary` — a server-produced, redacted, whitespace-collapsed summary
  capped at 240 characters. It is a safe internal projection and never a
  substitute for the private report body.

Default object layout:

```text
<SUPPORT_REPORT_S3_PREFIX>/<YYYY>/<MM>/<DD>/<reportId>/
  request.json
  diagnostics.json                                  optional
  attachments/<clientFileId>/<safeFileName>         optional
  complete.json
```

The bucket is private, blocks public access, uses server-side encryption,
applies retention/lifecycle policy, and grants least-privilege server access.

Historical `tracker.json` and `cloud-diagnostics.json` objects may exist. The
current server does not create them.

## Slack receipt

The Slack completion receipt contains operational metadata:

- report ID and optional internal report URL;
- sender identity needed for support operations;
- kind, urgent, notify, credit, diagnostics, and attachment summaries;
- safe context and correlation IDs.

It must not include S3 keys/prefixes, presigned URLs, diagnostic or attachment
bodies, raw prompts/tool output, or secret values.

Slack is an alerting projection, not the queue or the source of delivery truth.

## Outreach address

Users may set `outreach_email` through `PATCH /v1/users/me`. An empty value
clears it. The support contact rule is:

```text
outreach_email ?? account_email
```

Capture stores reporter identity and notify intent; it does not send an email.
Only an authorized future outreach step may resolve and snapshot the address.

## Code map

```text
apps/desktop/src/components/support/**
apps/desktop/src/hooks/support/**
apps/desktop/src/lib/domain/support/**
apps/desktop/src/lib/workflows/support/**
apps/desktop/src/stores/support/**

cloud/sdk/src/client/support.ts
cloud/sdk-react/src/hooks/support.ts

server/proliferate/server/support/**
server/proliferate/server/support/feed/**
server/proliferate/db/models/support.py
server/proliferate/db/store/support_reports.py

.github/workflows/_deploy-server.yml
server/infra/main.tf
specs/developing/reference/env-vars.yaml
```

## Verification

Changes to this feature require focused coverage for the guarantee they alter:

- diagnostic fixtures seeded with report, prompt, tool, notification, and
  live-config secrets must prove none survive serialization;
- report creation retries must prove immutable idempotency;
- upload-target re-issue must prove stable object identity with refreshed
  content metadata;
- completion tests must cover missing, duplicate, unknown, out-of-prefix,
  size-mismatched, and checksum-mismatched objects;
- Slack success, missing configuration, and provider failure must prove the
  correct `slack_notified_at` state;
- capability tests must cover `vendor`, `operator`, and `none` for every entry
  point;
- a staging smoke must create a real report, inspect safe DB/S3 summaries, and
  visibly confirm the Slack message.

Operator investigation is documented in
[`../../../../developing/debugging/support-reports.md`](../../../../developing/debugging/support-reports.md).
