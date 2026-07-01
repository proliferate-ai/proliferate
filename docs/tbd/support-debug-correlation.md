# Support Debug Correlation Implementation Spec

This is the implementation spec for the next support/debugging iteration. It is
not current operating law yet. When implemented, the durable contract should be
promoted into `docs/features/support-reporting.md` and the analytics docs.

The goal is to make a support report the durable case file for debugging any
user-visible issue across Desktop, Web, Mobile, Cloud workspaces, server logs,
Sentry, PostHog, Cloud DB state, and reconnectable AnyHarness/sandbox runtime
logs.

## Summary

Every support report gets a server-generated `reportId`, a stable S3 prefix, a
durable DB row, and a correlation index. The report may include client-uploaded
Desktop diagnostics and attachments, plus server-written cloud diagnostics. The
same safe correlation IDs are attached to server logs and Sentry so an
investigator can pivot from the S3 case file into CloudWatch, Sentry, PostHog,
database records, and runtime targets.

The first implementation target is Desktop support reports. Web and Mobile
should migrate to the same report/case-file API as a follow-up instead of
continuing to be message-only forever.

## Goals

- Make every report idempotent across Desktop retries by `ownerUserId` and
  `clientJobId`.
- Store a stable `s3Prefix` in the database so completion cannot recompute the
  wrong prefix across UTC date boundaries.
- Put a top-level correlation block in `diagnostics.json`.
- Add server-written `cloud-diagnostics.json` for referenced cloud workspaces.
- Add structured or at least consistently fielded server logs with safe
  correlation IDs.
- Add Sentry tags for the same safe IDs.
- Add a client-side PostHog support-report event only through the existing typed
  telemetry path.
- Avoid broad ORM dumps. Cloud diagnostics must be allowlisted and bounded.
- Never persist presigned URLs in S3 or the database.

## Non-Goals

- Do not send AWS credentials to clients.
- Do not make CloudWatch Logs Insights auto-enrichment part of V1.
- Do not wake stopped sandboxes or create new runtime sessions just to collect
  diagnostics.
- Do not add server-side PostHog in V1. Current PostHog docs describe
  client-side telemetry only.
- Do not rely on local AnyHarness SQLite containing cloud workspace/session
  records. Pending and projected cloud state is valid.
- Do not copy prompt bodies, transcript bodies, raw command payloads, tool I/O,
  provider tokens, ciphertexts, cookies, signed URLs, or attachment contents
  into Sentry, PostHog, Slack, CloudWatch fields, or broad DB snapshots.

## Core Identifiers

The support report case file uses these identifiers:

- `reportId`: server-generated durable case ID.
- `clientJobId`: client-generated queue/retry ID.
- `requestId`: server request ID for each API call.
- `ownerUserId`: authenticated user who submitted the report.
- `primaryOrganizationId`: organization owning the primary reported cloud
  context, when applicable.
- `primaryTenantId`: `org:{organizationId}` for org-owned cloud context,
  otherwise `user:{ownerUserId}`.
- `tenantIds`: all tenant IDs represented by selected references.
- `cloudWorkspaceIds`: normalized cloud workspace UUIDs.
- `cloudTargetIds`: cloud target/runtime UUIDs.
- `cloudSandboxIds`: cloud sandbox DB IDs when known.
- `externalSandboxIds`: provider/E2B environment IDs when known.
- `sandboxProfileIds`: sandbox profile UUIDs when known.
- `anyharnessWorkspaceIds`: local or cloud AnyHarness workspace IDs.
- `sessionIds`: local, cloud, or projected session IDs.
- `interactionIds`: prompt/pending-interaction IDs when known.
- `posthogDistinctId` / `posthogSessionId`: optional client-supplied lookup IDs
  exposed through telemetry adapters.

Clients may send workspace/session/telemetry references, but server-derived
identity wins. The server must derive `ownerUserId`, organization, tenant, and
authorization from authenticated user context and DB reads.

## Server Data Model

Add a durable support report model and store.

Suggested table: `support_report`.

Required columns:

- `id`: report UUID/string primary key.
- `client_job_id`: client queue ID.
- `owner_user_id`: authenticated user ID.
- `primary_organization_id`: nullable organization ID.
- `primary_tenant_id`: canonical primary query key.
- `tenant_ids_json`: array of tenant IDs represented in the report.
- `status`: `created`, `uploading`, `completed`, `failed`, or `abandoned`.
- `s3_bucket`: support report bucket.
- `s3_prefix`: stable prefix computed once at creation.
- `source_surface`: `desktop`, `web`, `mobile`, or `cloud_api`.
- `source_context_json`: route/source/scope metadata without message body.
- `workspace_refs_json`: normalized local/cloud workspace references.
- `telemetry_refs_json`: PostHog/Sentry-safe lookup IDs when supplied.
- `object_manifest_json`: expected/uploaded object keys, content types, sizes,
  and client-reported hashes.
- `request_id`: create request ID.
- `complete_request_id`: completion request ID.
- `request_object_written_at`: timestamp for successful `request.json` write.
- `cloud_diagnostics_status`: `not_applicable`, `pending`, `running`,
  `completed`, `failed`, or `skipped`.
- `cloud_diagnostics_error`: redacted error summary.
- `cloud_diagnostics_started_at` / `cloud_diagnostics_completed_at`.
- `slack_notified_at`.
- `created_at`, `updated_at`, `completed_at`.

Required constraints:

- Unique `(owner_user_id, client_job_id)`.
- Indexes on `owner_user_id`, `primary_tenant_id`, `primary_organization_id`,
  `status`, and `created_at`.

Do not store the full user message in the DB row. Store the message in
`request.json` under the private support S3 prefix, as the current upload flow
already does.

## API Contract

Replace the single "create upload" operation with a case lifecycle. The old
`POST /v1/support/report-uploads` may remain as a compatibility wrapper, but new
clients should use the split flow.

### `POST /v1/support/reports`

Creates or returns an existing report for `(ownerUserId, clientJobId)`.

Input:

- `clientJobId`
- `message`
- `sourceSurface`
- `context`: source, route/screen, intent, coarse active workspace metadata.
- `scope`: `most_recent_workspace`, `choose_workspace`, or `app_only`.
- `workspaceRefs`: normalized local/cloud references known to the client.
- `telemetryRefs`: optional PostHog/Sentry lookup IDs exposed by adapters.
- `expectedClientUploads`: whether diagnostics/attachments will follow.

Server behavior:

- Authenticates user.
- Creates or loads the idempotent DB row.
- Computes and stores `s3Prefix` once.
- Normalizes `cloud:{uuid}` IDs as a Desktop fallback.
- Authorizes cloud references before reading any cloud records.
- Derives primary tenant fields from authorized cloud context, falling back to
  `user:{ownerUserId}`.
- Writes `request.json` to S3 without any presigned URLs.
- Sets `support_report_id` in correlation context and Sentry tags for this
  request.
- Schedules cloud diagnostics when cloud references are present.

Create-case failure behavior:

- For a new report, the service flushes the DB row, writes `request.json`, marks
  `request_object_written_at`, and commits. If the S3 write fails before commit,
  roll back the DB transaction and return a storage error. If DB commit fails
  after the S3 write, an orphaned `request.json` may remain and is harmless
  under support-report S3 lifecycle retention.
- For an existing idempotent report with `request_object_written_at` set, return
  the existing report without mutating message or user-submitted metadata.
- For an existing idempotent report without `request_object_written_at`, treat
  the retry as a repair attempt: rewrite `request.json` from the retry payload,
  set `request_object_written_at`, and continue. Do not return a broken report
  as successful.
- `created` means the row is committed and `request.json` exists.
- `uploading` is set when upload targets are issued.
- `completed` is set after successful idempotent completion.
- `failed` is reserved for unrecoverable server-side report lifecycle failures
  after a row exists.
- `abandoned` is set only by a future maintenance/sweeper path for incomplete
  reports older than the configured abandonment window. Presigned URL expiry
  alone does not change report status because upload targets can be refreshed.

Invalid or stale references:

- One invalid, stale, or unauthorized workspace/session/target reference does
  not fail the whole support report.
- Unauthorized references are omitted and recorded only as redacted section
  errors. The response must not reveal whether another tenant's resource exists.
- If no cloud references remain after authorization, use `user:{ownerUserId}` as
  the primary tenant and mark cloud diagnostics `not_applicable` or `skipped`.

Output:

- `reportId`
- `clientJobId`
- `status`
- `serverCorrelation`: server-derived owner, tenant, request, report, and
  normalized cloud reference IDs.
- `cloudDiagnosticsStatus`

If the idempotent report already exists, the server returns the existing
`reportId` and current status. It must not overwrite the original message body
or user-submitted attachments.

### `POST /v1/support/reports/{reportId}/upload-targets`

Creates or refreshes presigned upload targets.

Input:

- `diagnostics`: optional metadata with content type, size, and
  `clientSha256`.
- `attachments`: attachment metadata with client file ID, filename, content
  type, size, and `clientSha256`.

Server behavior:

- Verifies the report belongs to the authenticated user.
- Verifies report status allows upload refresh.
- Validates size caps.
- Computes deterministic object keys under stored `s3Prefix`.
- Persists object keys and metadata in the DB object manifest.
- Returns short-lived presigned PUT URLs.
- Does not persist the presigned URLs in DB or S3.

The `clientSha256` fields are client-reported manifest data unless the S3 helper
is extended to presign and verify checksum headers. Do not describe them as
server-verified integrity checks unless checksum verification is implemented.

### `POST /v1/support/reports/{reportId}/complete`

Completes a report after client uploads.

Input:

- uploaded diagnostics object key, size, and `clientSha256`
- uploaded attachment object keys, sizes, and `clientSha256`
- final package manifest

Server behavior:

- Verifies ownership.
- Looks up stored `s3Prefix`; never recomputes it from current time.
- Validates object keys are expected and under the report prefix.
- Uses S3 `HEAD` to validate uploaded object existence and size.
- Optionally verifies S3 checksum if checksum headers were implemented.
- Writes `complete.json`.
- Marks report complete idempotently.
- Posts Slack once.

If completion is retried after a successful completion, return success and do
not send a second Slack notification.

## S3 Object Contract

All objects live under the stored report prefix.

Server-written:

- `request.json`
- `complete.json`
- `cloud-diagnostics.json`, when cloud references exist

Client-written:

- `diagnostics.json`, for Desktop local/runtime/session diagnostics
- `attachments/{clientFileId}/{safeFileName}`

`request.json` includes:

- report ID
- client job ID
- create request ID
- created timestamp
- sender email/display name as current support behavior allows
- message body
- source context
- scope
- normalized workspace/telemetry refs
- server-derived correlation block
- expected object metadata without presigned URLs
- sanitized route/screen labels only; no raw query strings or unsanitized
  dynamic path segments

`complete.json` includes:

- report ID
- complete request ID
- completed timestamp
- object manifest
- final package manifest
- Slack notification status

`cloud-diagnostics.json` includes the server cloud diagnostics schema described
below.

## Server Correlation Context

Extend `proliferate.middleware.request_context` or add a sibling module with a
typed correlation context.

Fields:

- `request_id`
- `user_id`
- `organization_id`
- `tenant_id`
- `support_report_id`
- `cloud_workspace_id`
- `cloud_target_id`
- `sandbox_profile_id`
- `cloud_sandbox_id`
- `external_sandbox_id`
- `anyharness_workspace_id`
- `session_id`
- `interaction_id`
- `command_id`
- `worker_id`
- `slot_generation`

Helpers:

- `get_request_id()`
- `get_correlation_context()`
- `set_authenticated_user_context(user_id)`
- `set_resource_tenant_context(...)`
- `set_support_report_context(report_id)`
- `with_correlation_context(**fields)` as a restoring context manager
- `capture_correlation_context()` for background tasks

Rules:

- Auth dependencies set only authenticated user context.
- Tenant/org context is set after the relevant resource is authorized.
- Support service sets `support_report_id`.
- Cloud command/runtime/event services set their known resource IDs around
  operations.
- Background tasks must receive an explicit captured context.

## Logging And CloudWatch

V1 should make IDs consistently queryable. Prefer JSON logs in production. If
that cannot land in the same PR, `log_cloud_event` must at least include stable
field names in message text while the structured formatter is rolled out.

Structured production log fields:

- `timestamp`
- `level`
- `logger`
- `message`
- `request_id`
- `user_id`
- `organization_id`
- `tenant_id`
- `support_report_id`
- `cloud_workspace_id`
- `cloud_target_id`
- `sandbox_profile_id`
- `cloud_sandbox_id`
- `external_sandbox_id`
- `anyharness_workspace_id`
- `session_id`
- `interaction_id`
- `command_id`
- `worker_id`
- `slot_generation`
- `duration_ms`
- `error_type`

Do not emit raw route paths with user/repo/workspace identifiers as generic
Sentry/log tags. Prefer route templates or sanitized route names. The same rule
applies to `source_context_json`, `request.json`, and `diagnostics.json`: store
normalized route names, route templates, or route values with dynamic segments
hashed/redacted and query strings removed.

Cloud log helper updates:

- Accept structured field kwargs.
- Merge safe current correlation context.
- Redact disallowed field values.
- Keep message suffixes only as a transitional readability aid.

CloudWatch Logs Insights auto-querying is V2. V1 produces query hints in the
support report and queryable IDs in application logs.

## Sentry

Sentry receives only safe correlation tags/context fields:

- `request_id`
- `user_id`
- `organization_id`
- `tenant_id`
- `support_report_id`
- `cloud_workspace_id`
- `cloud_target_id`
- `sandbox_profile_id`
- `cloud_sandbox_id`
- `external_sandbox_id`
- `anyharness_workspace_id`
- `session_id`
- `interaction_id`
- `command_id`
- `surface`

These support correlation identifiers are an intentional high-cardinality
diagnostic exception to the general low-cardinality tag preference. Keep the set
opaque and minimal. Use tags only for IDs that need Sentry search/filtering;
otherwise put IDs in Sentry context/extras after scrubbing. Update
`docs/dev/analytics/sentry.md` when this lands.

Do not send message text, prompt text, transcript text, tool output, repo paths,
workspace display names, attachment names, emails, cookies, signed URLs, or raw
request bodies.

Update request telemetry so it does not tag raw `http_path` when the path may
contain sensitive user-controlled identifiers. Prefer the FastAPI route pattern
or a sanitized route name.

## PostHog

PostHog stays client-side in V1.

Add a typed `support_report_submitted` product event through the existing
telemetry event catalog and PostHog allowlist.

Allowed event properties:

- `support_report_id`
- `scope_kind`
- `workspace_location`
- `cloud_workspace_count`
- `local_workspace_count`
- `has_attachments`
- `has_local_diagnostics`
- `surface`

Forbidden event properties:

- support message
- email
- attachment names
- repo names or paths
- workspace names
- prompt/transcript content
- raw errors
- replay URLs
- auth state or tokens

Emit after report completion if the event means "report sent." Emit after case
creation only if the event means "user asked for help." Either way, the event is
telemetry-mode gated and must include `support_report_id`.

PostHog lookup IDs may be included in the support S3 diagnostics only when
exposed by the telemetry adapter. Do not reach behind adapter boundaries.

## Desktop Flow

Production UX remains simple:

```text
Report issue

What happened?
[ textarea ]

Attachments
[ Drop screenshots or files here ]

Include diagnostics from
(*) Most recent workspace
( ) Choose workspace
( ) App only

Cancel    Send
```

No app/runtime logs checkbox. No raw debug export names in production.

Queue flow:

1. Support window emits a `SupportReportJob` and closes immediately.
2. Main app persists the job locally with `clientJobId`.
3. Queue creates the server case with `POST /v1/support/reports`.
4. Queue persists returned `reportId`, `serverCorrelation`, and status.
5. Queue builds `diagnostics.json` schema v2 using `reportId` and
   `serverCorrelation`.
6. Queue computes diagnostics and attachment sizes/hashes.
7. Queue requests or refreshes upload targets.
8. Queue uploads diagnostics and attachments.
9. Queue completes the report.
10. Queue deletes staged attachment files after completion.

Persisted retry state must include:

- `clientJobId`
- `reportId`, once known
- current stage
- object keys
- upload target expiry time, if targets are persisted locally
- attachment staged paths
- last error
- next retry time

Retry rules:

- If no `reportId`, create or recover by `clientJobId`.
- If presigned URLs expired, refresh upload targets.
- If uploads succeeded but completion failed, retry completion.
- Server idempotency prevents duplicate case files and duplicate Slack messages.
- Initiated-but-incomplete reports are acceptable and visible through DB status.

## Desktop Diagnostics Schema V2

`diagnostics.json` top-level shape:

```json
{
  "schemaVersion": 2,
  "generatedAt": "2026-05-31T00:00:00.000Z",
  "correlation": {
    "reportId": "server-report-id",
    "clientJobId": "client-job-id",
    "serverRequestIds": [],
    "ownerUserId": "server-derived-user-id",
    "primaryOrganizationId": null,
    "primaryTenantId": "user:user-id",
    "tenantIds": ["user:user-id"],
    "sourceSurface": "desktop",
    "source": "sidebar",
    "route": "sanitized-route-template",
    "scopeKind": "most_recent_workspace",
    "selectedWorkspaceIds": [],
    "localWorkspaces": [],
    "cloudWorkspaces": [],
    "telemetryRefs": {}
  },
  "report": {
    "createdAt": "...",
    "messagePresent": true,
    "messageLength": 123,
    "scope": {},
    "context": {},
    "openedAt": "..."
  },
  "runtimeDiagnostics": {},
  "workspaces": [],
  "attachments": [],
  "collectionErrors": []
}
```

Local workspace references:

- support workspace ID
- AnyHarness workspace ID
- logical workspace ID when known
- repo/root metadata only after local paths are scrubbed or hashed before
  writing `diagnostics.json`
- lifecycle state
- selected or recent session IDs

Cloud workspace references:

- support workspace ID, such as `cloud:{cloudWorkspaceId}`
- normalized cloud workspace ID
- target ID
- execution target kind and status
- primary materialization target ID
- primary materialization AnyHarness workspace ID
- cloud access exposure ID and revision
- direct target context IDs
- origin and creator context IDs, excluding display labels
- visibility, sandbox type, status, and lifecycle timestamps
- selected/projected session IDs when known

Desktop should not claim a sandbox ID unless the cloud summary explicitly
contains one. Most active sandbox/provider IDs are server-derived.

## Server Cloud Diagnostics

Server writes `cloud-diagnostics.json` for authorized cloud references.

Top-level shape:

```json
{
  "schemaVersion": 1,
  "reportId": "server-report-id",
  "requestId": "request-id",
  "generatedAt": "2026-05-31T00:00:00.000Z",
  "normalizedIds": {},
  "caps": {},
  "truncation": {},
  "queryHints": {},
  "workspaces": [],
  "targets": [],
  "sessions": [],
  "runtimeTails": [],
  "sectionErrors": []
}
```

Use support-specific store helpers/read models. Do not dump ORM rows.

Pull allowlisted snapshots from:

- `cloud_workspace`: owner/tenant, repo/branch, origin, status/detail/error,
  target/profile IDs, AnyHarness workspace ID, runtime/config revision metadata,
  timestamps. Exclude runtime token and data-key ciphertexts.
- `cloud_workspace_exposure` and `cloud_synced_workspaces`: exposure status,
  projection level, commandable state, target/workspace mapping.
- `cloud_targets`, `cloud_target_status`, `cloud_workers`,
  `cloud_target_inventory`: target kind/status, worker status/version/heartbeat,
  inventory summaries. Exclude token hashes and sensitive raw inventory.
- `cloud_target_runtime_access`: active sandbox, slot generation, last worker and
  heartbeat, redacted AnyHarness base URL. Exclude ciphertexts.
- `cloud_sandbox`: provider, external sandbox ID, slot generation, status,
  template version, lifecycle/heartbeat/blocking fields.
- `sandbox_profile` and `sandbox_profile_target_state`: desired/applied agent
  auth and runtime-config revisions, status, last command/worker/error.
- `sandbox_profile_runtime_config_current` and current revision:
  sequence/revision/content hash/source/warnings/redacted manifest summary.
  Exclude artifact payloads.
- `cloud_target_configs`: materialization status, summary JSON, env/files/MCP
  versions, last error/command. Exclude `payload_ciphertext`.
- `cloud_workspace_setup_run`: latest runs, status, command run, setup script
  version, timing, last error. Exclude `apply_token`.
- `cloud_commands`: recent command IDs, kind/source/actor kind, status, leases,
  slot/sandbox, timings, attempts, error code/message, payload/result shape
  only.
- `cloud_sessions` and `cloud_event_ingest_state`: projection/session metadata,
  live-config metadata, gap state, seq cursors, timestamps. Exclude session
  titles unless represented as redacted hash/length metadata.
- `cloud_session_events`: recent event metadata only: seq, type, source,
  turn/item IDs, payload hash/size/truncation, timestamps.
- `cloud_transcript_items` and `cloud_pending_interactions`: IDs, kind, status,
  order/seq, timestamps. No title, description, body text, prompt text, or tool
  content by default. If a future explicit diagnostic mode needs titles, include
  only redacted text or hash/length metadata.
- Runtime tails: reuse sandbox runtime debug collection only when the managed
  target is already reachable. Record `notCollectedReason` otherwise.

Default caps:

- 5 cloud workspaces
- 5 targets
- 10 sessions
- 50 recent commands
- 100 event metadata rows per session
- 100 transcript item metadata rows per session
- 50 pending interactions
- 10 setup runs
- 72-hour default lookback for recent commands/events
- 25 seconds total remote runtime collection budget per target
- 4 MB target max for `cloud-diagnostics.json`

Remote runtime collection is fail-soft. A reconnect/tail failure records a
section error and does not fail report submission.

Execution semantics:

- Cloud diagnostics run asynchronously after the support report row is durable
  and `request.json` has been written.
- Completion does not wait for cloud diagnostics. Slack includes the current
  `cloudDiagnosticsStatus`.
- If the background task is lost and the report remains `pending`, completion or
  a later maintenance path may reschedule collection.
- `pending` -> `running` is a claim transition owned by the support diagnostics
  service.
- `running` -> `completed`, `failed`, or `skipped` is owned by the support
  diagnostics service.
- Cloud diagnostics failure never changes the report lifecycle status from
  `completed` to `failed`.

## Runtime Log Tails

Do not wake stopped sandboxes for diagnostics in V1.

Before any provider/runtime call, the support diagnostics service must check DB
state and only proceed when the target is already managed and reachable. Avoid
provider calls that may resume, wake, reconnect, or otherwise mutate lifecycle
state. If reachability is uncertain, skip runtime tails with
`notCollectedReason`.

For already-running managed targets, support diagnostics may collect:

- redacted launcher/config metadata
- AnyHarness log tail
- supervisor log tail
- process list
- binary/runtime path metadata
- workdir listing after path scrubbing

The existing runtime debug helper redacts launcher/config secrets but not every
arbitrary log line. Add support-specific log-tail redaction before writing to
S3.

Runtime identity injection follow-up:

- Runtime env already carries target identity in some paths.
- Add sandbox/profile/slot identifiers where appropriate.
- Do not set static cloud workspace/session IDs on a runtime that can host
  multiple workspaces. Pass those IDs in command/request spans instead.

## Web And Mobile

Current Web/Mobile support surfaces are not yet on the report case-file flow.
Migration options:

1. Move connected support surfaces to `POST /v1/support/reports`, optionally with
   no client uploads.
2. Or make `/v1/support/messages` internally create and complete a support
   report case file before sending Slack.

Preferred path: surface-agnostic support reports.

Web/Mobile inputs:

- user message
- source surface and route/screen
- selected cloud workspace/session references when available
- telemetry lookup refs exposed through adapters
- optional attachments if the surface supports them

Web/Mobile do not provide Desktop native logs, local AnyHarness logs, or local
SQLite-derived diagnostics.

For app-only Web/Mobile issues, the support case file mainly provides report
ID, user/tenant identity, Sentry tags, PostHog lookup IDs, and CloudWatch query
hints.

## Slack Notification

Slack remains a notification, not a diagnostic store.

Include:

- report ID
- S3 prefix
- sender display/email as current support behavior allows
- source surface
- scope kind
- primary tenant ID
- owner user ID
- primary organization ID when present
- cloud workspace IDs
- target IDs
- sandbox IDs when known
- attachment count
- diagnostics object presence
- cloud diagnostics status

Send Slack once. Completion retries must not duplicate Slack notifications.

## Redaction And Field Policy

Use allowlists for support diagnostics. Redact:

- bearer tokens
- auth headers
- cookies
- signed URL query values
- home paths
- long opaque token-like strings
- env-style `TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `AUTH`, `CREDENTIAL`
- `payload_ciphertext`
- `runtime_token_ciphertext`
- `anyharness_data_key_ciphertext`
- `token_hash`
- `apply_token`
- raw command payloads
- transcript text
- prompt bodies
- tool input/output
- attachment contents outside explicit attachment objects

The support S3 bucket can contain more diagnostic detail than Sentry, PostHog,
Slack, or log fields, but it still must scrub secrets and cap payloads.

## Implementation Phases

### Phase 1: Spec, DB, And Case Lifecycle

- Add this spec and update `docs/features/support-reporting.md` only for
  behavior that lands in the same PR.
- Add `support_report` DB model/store/migration.
- Refactor support API to receive `AsyncSession`.
- Add `POST /v1/support/reports`.
- Add `POST /v1/support/reports/{reportId}/upload-targets`.
- Keep or adapt existing upload endpoints only as compatibility.
- Store stable S3 prefix and idempotency state.
- Stop persisting presigned URLs in `request.json`.

### Phase 2: Desktop Correlation Package

- Extend Desktop support snapshot with normalized local/cloud references.
- Change queue flow to create case before building final diagnostics.
- Persist `reportId`, upload stage, object keys, and expiry state.
- Bump diagnostics schema to v2.
- Include server-derived correlation returned by case creation.
- Regenerate Cloud SDK.

### Phase 3: Server Correlation, Logs, And Sentry

- Extend request/correlation context helpers.
- Set user context in auth, tenant/resource context after authorization.
- Add structured production logging or consistent queryable cloud log fields.
- Sync safe correlation tags into Sentry.
- Replace raw path Sentry tags with sanitized route labels/templates.

### Phase 4: Cloud Diagnostics

- Add support cloud diagnostics service and redaction helper.
- Add bounded cloud store read models.
- Enforce authorization for every client-supplied cloud reference.
- Write `cloud-diagnostics.json`.
- Reuse runtime debug collection only for already-running managed targets.
- Update report enrichment status in DB.

### Phase 5: Product Telemetry

- Add typed client-side `support_report_submitted` event.
- Add PostHog allowlist entry.
- Emit after completion unless product explicitly wants initiation tracking.
- Assert forbidden fields are absent.

### Phase 6: Web/Mobile Migration

- Move connected support surfaces to the support report case lifecycle, or make
  `/v1/support/messages` create S3 case files internally.
- Include source surface, route/screen, cloud refs, and telemetry refs.

### Phase 7: Optional CloudWatch Enrichment

- Add AWS CloudWatch Logs integration after structured logs are deployed.
- Query by report, tenant, user, workspace, target, sandbox, command, and
  session IDs within the report time window.
- Write bounded `cloudwatch-log-hits.json` to the report prefix.

## Primary Files

Server:

- `server/proliferate/server/support/api.py`
- `server/proliferate/server/support/service.py`
- `server/proliferate/server/support/models.py`
- `server/proliferate/server/support/domain/message.py`
- new `server/proliferate/server/support/diagnostics.py`
- new `server/proliferate/server/support/redaction.py`
- new `server/proliferate/db/models/support.py`
- new `server/proliferate/db/store/support_reports.py`
- new Alembic migration
- `server/proliferate/middleware/request_context.py`
- `server/proliferate/middleware/request_telemetry.py`
- `server/proliferate/auth/dependencies.py`
- `server/proliferate/utils/logging.py`
- `server/proliferate/integrations/sentry.py`
- `server/proliferate/integrations/aws/s3.py`

Cloud DB/runtime:

- `server/proliferate/db/store/cloud_workspaces.py`
- `server/proliferate/db/store/cloud_sync/events.py`
- `server/proliferate/db/store/cloud_sync/commands.py`
- `server/proliferate/db/store/cloud_sync/exposures.py`
- `server/proliferate/db/store/cloud_sync/targets.py`
- `server/proliferate/db/store/cloud_sandboxes.py`
- `server/proliferate/db/store/cloud_workspace_setup_runs.py`
- `server/proliferate/server/cloud/_logging.py`
- `server/proliferate/server/cloud/runtime/sandbox_exec.py`
- `server/proliferate/server/cloud/runtime/provision.py`
- `server/proliferate/server/cloud/runtime/ensure_running.py`
- `server/proliferate/server/cloud/runtime/bootstrap.py`
- `server/proliferate/server/cloud/commands/service.py`
- `server/proliferate/server/cloud/events/service.py`
- `server/proliferate/server/cloud/worker/service.py`

Desktop:

- `apps/desktop/src/lib/domain/support/report-types.ts`
- `apps/desktop/src/hooks/support/derived/use-support-report-snapshot.ts`
- `apps/desktop/src/lib/workflows/support/support-report-upload-workflows.ts`
- `apps/desktop/src/hooks/support/lifecycle/use-support-report-upload-queue.ts`
- `apps/desktop/src/lib/domain/support/report-upload-sanitizer.ts`
- `apps/desktop/src/lib/domain/telemetry/events.ts`
- `apps/desktop/src/lib/integrations/telemetry/client.ts`
- `apps/desktop/src/lib/integrations/telemetry/posthog.ts`

Web/Mobile follow-up:

- `apps/packages/product-surfaces/src/support/CloudSupportSurface.tsx`
- Web support integration files.
- Mobile support integration files.

Docs/tests:

- `docs/features/support-reporting.md`
- `docs/dev/analytics/sentry.md`
- `docs/dev/analytics/posthog.md`
- `server/tests/integration/test_support_api.py`
- new server tests for support report store/cloud diagnostics/redaction/logging
- Desktop support snapshot/package/queue/telemetry tests

## Verification

- DB migration creates unique `(owner_user_id, client_job_id)` and stable
  `s3_prefix`.
- S3 write failure during case creation rolls back the new DB row, and
  idempotent retries repair any row missing `request_object_written_at`.
- Create report is idempotent.
- Completion across UTC midnight uses stored prefix.
- Presigned URLs are never written to DB or S3 JSON.
- Completion validates object key prefix and size.
- Completion is idempotent and Slack sends once.
- Desktop retry resumes from persisted report stage.
- Diagnostics schema v2 includes `reportId` and server-derived correlation.
- App-only scope excludes workspace/session diagnostics but may include app
  runtime logs.
- Cloud diagnostics reject unauthorized refs and never leak data for another
  tenant.
- Cloud diagnostics obey caps, record truncation, and redact sensitive fields.
- Runtime tails are skipped without waking stopped sandboxes.
- Sentry tags include safe IDs and no raw path/message/token data.
- PostHog event is emitted only through the typed client telemetry path and
  contains only allowlisted properties.
- Cloud logs are queryable by at least `support_report_id`, `tenant_id`,
  `cloud_workspace_id`, `cloud_target_id`, `cloud_sandbox_id`, `command_id`, and
  `session_id` after the logging rollout.
