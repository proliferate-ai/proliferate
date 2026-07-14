# Support report debugging

Status: authoritative operator runbook for the currently shipped capture path.

Use this runbook when a report is missing, stuck, rejected, incomplete in S3,
or absent from Slack. The active system ends at durable capture plus a
best-effort Slack receipt. It does not currently create GitHub/Linear issues,
run triage/fix workflows, or notify reporters when a fix ships.

Product behavior is defined in
[`../../codebase/systems/product/support/README.md`](../../codebase/systems/product/support/README.md).
The accepted closed-loop contract is in
[`../../codebase/systems/engineering/issue-lifecycle/support-loop.md`](../../codebase/systems/engineering/issue-lifecycle/support-loop.md).

## Mental model

The `support_report` row is the durable pivot. The private S3 bundle is its case
evidence. Slack is a projection and must not be treated as the queue.

Normal lifecycle:

1. Desktop persists a local `SupportReportJob`.
2. Client calls `POST /v1/support/reports`.
3. Server creates or returns `support_report` and writes `request.json`.
4. When objects are expected, client calls `.../upload-targets`.
5. Client uploads diagnostics and attachments directly through presigned URLs.
6. Client calls `.../complete`.
7. Server verifies the object set, writes `complete.json`, and marks the row
   completed.
8. Server attempts a Slack receipt. It records `slack_notified_at` only after a
   successful webhook response.

There is no active step 9. If a report needs an owner, issue, fix, or reporter
follow-up, an operator must track that manually until the support workflow
ships.

## Privacy rules

- Treat every report and S3 object as private customer data.
- Do not paste messages, prompts, transcript bodies, tool input/output,
  terminal output, diagnostic bodies, attachments, S3 keys, presigned URLs, or
  secret values into public issues or ordinary Slack messages.
- Prefer report IDs, request IDs, lifecycle statuses, timestamps, object
  presence/size, and sanitized error codes.
- Download private objects only to an access-controlled temporary directory and
  remove the copy after the investigation.
- Never print an ECS task definition, secret parameter value, database URL, or
  authorization header into an issue, PR, spec, or chat.
- Historical `public_content_consent=true` is not blanket authorization to
  publish current private evidence.

## Required access

- read access to the environment's `support_report` table;
- S3 `ListBucket`, `HeadObject`, and authorized `GetObject` access for the
  private support bucket;
- CloudWatch Logs access for the API task;
- Sentry access for the relevant server/Desktop/runtime projects;
- ECS task-definition and SSM parameter **metadata** access when diagnosing
  deployment configuration;
- access to the destination Slack channel when verifying actual delivery.

Do not retrieve secret values merely to prove a secret exists. Inspect the
parameter reference and, when necessary, its metadata/version timestamp.

## Configuration checkpoints

Check configuration only when the symptom points at it.

Capture storage:

```text
SUPPORT_REPORT_S3_BUCKET
SUPPORT_REPORT_S3_PREFIX
SUPPORT_REPORT_S3_REGION
SUPPORT_REPORT_UPLOAD_URL_EXPIRES_SECONDS
SUPPORT_REPORT_DIAGNOSTICS_MAX_BYTES
SUPPORT_REPORT_ATTACHMENT_MAX_BYTES
SUPPORT_REPORT_TOTAL_ATTACHMENT_MAX_BYTES
```

Slack receipt:

```text
SUPPORT_SLACK_WEBHOOK_URL                         ECS secret
SUPPORT_SLACK_WEBHOOK_URL_PARAMETER_NAME          deploy-only SSM path
SUPPORT_REPORT_INTERNAL_BASE_URL                  optional non-secret link base
```

The deploy workflow copies the protected GitHub environment secret to SSM and
injects the parameter through the ECS task definition. A healthy old task does
not prove a fresh deploy can reproduce that reference; inspect the newly
rendered task definition after deployment.

Legacy `SUPPORT_TRACKER_*`, `SUPPORT_GITHUB_*`, and `SUPPORT_LINEAR_*` values may
still be present. They do not activate a tracker in the current server.

The complete inventory lives in
[`../reference/env-vars.yaml`](../reference/env-vars.yaml); deployment ownership
is in [`../deploying/hosted.md`](../deploying/hosted.md).

## Find the report

Start with the strongest identifier available:

1. report ID from the Desktop success toast or Slack;
2. request ID from API/Sentry logs;
3. user ID or account email plus a narrow time range;
4. `client_job_id` from a local queued job;
5. S3 day prefix as a last resort.

Desktop local state:

```text
localStorage key: proliferate.supportReportJobs.v1
native staging directory: support-report-attachments
```

Do not copy the full local queue into a ticket; it contains private message and
attachment metadata.

## Database first

Read the active capture columns:

```sql
select
  id,
  client_job_id,
  owner_user_id,
  status,
  source_surface,
  kind,
  urgent,
  notify_me,
  credit_consent,
  credit_name,
  request_id,
  complete_request_id,
  s3_bucket,
  s3_prefix,
  request_object_written_at,
  slack_notified_at,
  created_at,
  updated_at,
  completed_at
from support_report
where id = '<reportId>';
```

Inspect JSON metadata without selecting the private message object:

```sql
select
  source_context_json,
  workspace_refs_json,
  telemetry_refs_json,
  expected_uploads_json,
  object_manifest_json,
  cloud_diagnostics_status
from support_report
where id = '<reportId>';
```

Lifecycle interpretation:

| State | Meaning | Next check |
| --- | --- | --- |
| no row | Client failed before/during create | Desktop queue, auth, request logs, Sentry. |
| `created` + request timestamp | Private request exists; target/complete phase did not finish | Expected intent, Desktop queue, S3 object list. |
| `uploading` | Targets were issued and manifest is locked | Compare manifest to S3 metadata. |
| `completed` | Capture is durable and `complete.json` should exist | Slack state and manual ownership. |
| request timestamp null | Row creation did not finish writing private request evidence | S3/IAM/region/server error. |
| Slack timestamp null | No confirmed Slack acceptance | Config, logs, destination verification. |

Do not use `tracker_status`, GitHub, Linear, crosslink, or tracker retry columns
to infer the current report outcome. They are legacy state. Likewise,
`cloud_diagnostics_status=not_applicable` is normal in the current server.

### Useful queue audits

Incomplete captures:

```sql
select id, owner_user_id, status, created_at, updated_at, s3_prefix
from support_report
where status <> 'completed'
order by created_at asc;
```

Completed reports lacking a confirmed Slack receipt:

```sql
select id, urgent, notify_me, completed_at
from support_report
where status = 'completed'
  and slack_notified_at is null
order by completed_at asc;
```

Historical Slack timestamps written before the truthfulness fix are only an
attempt signal. Verify channel presence when the distinction matters.

## S3 bundle

Use bucket/prefix from the DB row.

```bash
export SUPPORT_REPORT_S3_BUCKET='<bucket-from-db>'
export SUPPORT_REPORT_S3_PREFIX='<prefix-from-db>'

aws s3api list-objects-v2 \
  --bucket "$SUPPORT_REPORT_S3_BUCKET" \
  --prefix "$SUPPORT_REPORT_S3_PREFIX/" \
  --query 'Contents[].{Key:Key,Size:Size,LastModified:LastModified}' \
  --output table
```

Expected current objects:

```text
request.json                                      always after successful create
diagnostics.json                                  when diagnostics intent is true
attachments/<clientFileId>/<safeFileName>         zero or more
complete.json                                     after completion
```

`cloud-diagnostics.json` and `tracker.json` are historical objects, not current
expectations.

Check metadata without reading a body:

```bash
aws s3api head-object \
  --bucket "$SUPPORT_REPORT_S3_BUCKET" \
  --key "$SUPPORT_REPORT_S3_PREFIX/diagnostics.json"
```

When body inspection is required, use a private temporary directory and print
only a safe summary:

```bash
install -d -m 700 /tmp/proliferate-support-report

aws s3 cp \
  "s3://$SUPPORT_REPORT_S3_BUCKET/$SUPPORT_REPORT_S3_PREFIX/request.json" \
  /tmp/proliferate-support-report/request.json

jq '{
  schemaVersion,
  reportId,
  clientJobId,
  requestId,
  createdAt,
  kind,
  urgent,
  notifyMe,
  creditConsent,
  creditNamePresent: ((.creditName // "") | length > 0),
  source: .context.source,
  scope,
  correlation,
  telemetryRefs,
  messagePresent: ((.message // "") | length > 0),
  messageLength: ((.message // "") | length)
}' /tmp/proliferate-support-report/request.json
```

For diagnostics, verify the privacy contract before investigating content:

```bash
aws s3 cp \
  "s3://$SUPPORT_REPORT_S3_BUCKET/$SUPPORT_REPORT_S3_PREFIX/diagnostics.json" \
  /tmp/proliferate-support-report/diagnostics.json

jq '{
  schemaVersion,
  generatedAt,
  correlation,
  messagePresent: .report.messagePresent,
  messageLength: .report.messageLength,
  reportContainsMessageField: (.report | has("message")),
  workspaceCount: (.workspaces | length)
}' /tmp/proliferate-support-report/diagnostics.json
```

Current diagnostics must report schema v2 and
`reportContainsMessageField=false`. If raw seeded/private strings are present,
stop sharing the artifact and file a privacy incident.

Remove the private temporary copy after use:

```bash
rm -rf /tmp/proliferate-support-report
```

## CloudWatch logs

Find the API log group from the ECS task definition if it is not known:

```bash
aws logs describe-log-groups \
  --log-group-name-prefix /aws/ecs/proliferate \
  --query 'logGroups[].logGroupName' \
  --output text
```

Logs Insights query by report ID:

```sql
fields @timestamp, @message, support_report_id, request_id, user_id, tenant_id
| filter support_report_id = '<reportId>' or @message like /<reportId>/
| sort @timestamp asc
| limit 200
```

Endpoint query:

```sql
fields @timestamp, @message, status_code, method, path,
       support_report_id, request_id, user_id, tenant_id
| filter path like /\/v1\/support\/reports/
    or @message like /\/v1\/support\/reports/
| sort @timestamp desc
| limit 200
```

Expected success messages:

```text
Support report created.
Support report upload targets issued.
Support report completed.
```

Important failure messages:

```text
Support report ... completed but SUPPORT_SLACK_WEBHOOK_URL is unset
Support report ... Slack notification failed to deliver
support_report_storage_unavailable
support_report_upload_invalid
support_report_upload_conflict
```

Tracker-reconciler or cloud-diagnostics collection messages are legacy and do
not describe the active path.

## Sentry and telemetry

Search by IDs, not private text:

```text
support_report_id:<reportId>
request_id:<requestId>
tenant_id:<primaryTenantId>
user.id:<ownerUserId>
```

Use surface-specific projects:

- `proliferate-server` for API, DB, S3, and Slack failures;
- `proliferate-desktop` for queue, payload, presigned upload, and toast errors;
- `proliferate-desktop-native` for attachment staging and native log capture;
- `anyharness` for runtime/session diagnostic collection;
- web/mobile projects for their zero-upload capture paths.

`request.json.telemetryRefs` may contain Sentry event IDs and PostHog IDs.
`support_report_submitted` is a correlation event, not proof that downstream
triage or notification happened.

## Slack delivery

For a completed report with a null timestamp:

1. inspect server error logs;
2. confirm the ECS task references `SUPPORT_SLACK_WEBHOOK_URL` through the
   intended SSM path;
3. confirm the parameter metadata exists and the task execution role may read
   it;
4. confirm the destination webhook is still valid;
5. visually search the destination channel for the report ID;
6. keep the report completed even when Slack failed.

For a non-null timestamp created after the truthfulness fix, the webhook call
returned success. Still use the Slack channel as the final check when auditing
human visibility.

There is no current recovery worker that retries all null timestamps. Track the
missed receipt manually and add durable delivery retry as part of the support
workflow.

## Failure matrix

### No row

- Inspect Cloud auth and the Desktop queue.
- A 401 means the queued job waits for real sign-in.
- Dev auth bypass cannot submit a real hosted support report.
- Inspect API request logs and Desktop Sentry around the send time.

### Row exists; `request_object_written_at` is null

- Check bucket/region, task IAM, encryption headers, and S3 errors.
- Do not manually advance the row without a correct private `request.json`.

### `created`; no object manifest

- Zero-upload reports may legitimately go directly to complete.
- Otherwise the client did not reach upload-target creation.
- Inspect attachment staging, diagnostic builder failures, validation, and
  queued retry state.

### `uploading`; objects missing

- Compare `object_manifest_json` with S3 metadata.
- Presigned URLs may have expired; a retry can reissue URLs for the same object
  identities.
- A changed diagnostics boolean, attachment count, or object identity is a
  terminal `support_report_upload_conflict`.

### Complete returns upload-invalid

- Compare keys, sizes, and checksum claims with the latest target manifest.
- Look for missing, duplicate, unknown, or out-of-prefix keys.
- Remember that reissuing targets refreshes metadata; an older completion body
  can no longer match.

### Desktop keeps retrying a validation error

- HTTP 422 currently falls through the generic transient classifier in older
  clients.
- Preserve the report evidence, stop assuming retries will repair the payload,
  and fix client validation/classification.

### Completed; no Slack

- Capture succeeded.
- Follow the Slack delivery section and assign the report manually.
- Do not write `slack_notified_at` by hand merely to clear an audit query.

### No GitHub/Linear issue

- This is expected for current reports.
- Do not call the deleted `/tracker` endpoint or expect a reconciler to catch
  up.
- Create/link manual operational work only with privacy-safe metadata until the
  issue workflow is active.

### No reporter email

- This is expected in the current product.
- `notify_me` and `outreach_email` are capture facts, not an active mail job.
- If manual follow-up is approved, resolve `outreach_email ?? account_email`,
  record the action in the temporary issue ledger, and do not claim the product
  sent it automatically.

## Idempotency and recovery

Current guarantees:

- create is idempotent by `(owner_user_id, client_job_id)`;
- target reissue preserves object identity and immutable upload intent while
  refreshing content metadata;
- completion requires exactly the latest stored manifest;
- an already-completed response is successful client cleanup;
- Slack success is not allowed to change capture completion.

Current missing guarantees:

- no transactional completion outbox;
- no issue-ingestion dedupe;
- no claim/retry state for triage;
- no durable Slack retry worker;
- no release-gated reporter delivery ledger.

Do not invent an S3-listing backfill or revive the old tracker reconciler as an
ad hoc recovery path. Follow the accepted architecture in the authoritative
support-system feature spec.

## Closeout

Record, in a private operational system:

- report ID and user-visible symptom;
- capture lifecycle and object-presence result;
- affected version/surface;
- sanitized root cause;
- linked owner, issue, PR, or deploy when available;
- whether Slack was visibly delivered;
- whether the reporter asked for follow-up;
- who owns the next user-facing action.

Never include private bundle content, S3 locations, attachments, raw user text,
or credentials in a public closeout.
