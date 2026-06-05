# Support Report Debugging

Status: authoritative for investigating submitted support reports.

Use this runbook when a user submits a support report, a support GitHub issue
looks incomplete, a Linear ticket is missing, Slack did not notify, S3 objects
look wrong, or Desktop shows support-upload retry copy.

Product behavior belongs in
[`../../codebase/features/support-reporting.md`](../../codebase/features/support-reporting.md).
This document owns the operator workflow.

## Mental Model

The durable pivot is the `support_report` row. Every other system should be
understood as a projection of that row plus the private S3 case bundle.

The normal lifecycle is:

1. Client opens the support window and queues a local support job.
2. Client calls `POST /v1/support/reports`.
3. Server creates or returns a `support_report` row and writes `request.json`
   to S3.
4. Client calls `POST /v1/support/reports/{reportId}/upload-targets`.
5. Server stores the immutable upload manifest and returns presigned S3 `PUT`
   URLs.
6. Client uploads `diagnostics.json` and attachments directly to S3.
7. Client calls `POST /v1/support/reports/{reportId}/complete`.
8. Server verifies object keys, sizes, and checksums, writes `complete.json`,
   marks the row completed, and sends the first Slack notification.
9. Server tracker reconciliation creates or updates GitHub and Linear, writes
   `tracker.json`, crosslinks the issues, and sends the tracker Slack update.

Desktop/Web/Mobile should authenticate only to Proliferate Cloud. Clients never
receive AWS credentials.

## Privacy Rules

- Treat the S3 bundle as private customer diagnostic evidence.
- Do not paste S3 keys, S3 prefixes, presigned URLs, diagnostics bodies,
  attachments, raw prompts, transcript bodies, terminal output, or request
  message text into public GitHub comments.
- A public GitHub issue may contain the user's written message only when
  `public_content_consent=true`.
- If consent is false, the public issue still exists, but it should use the
  private label and say the submitter did not opt in to publishing issue text.
- Linear is internal, but still do not copy raw diagnostics or attachment
  bodies there. Link the internal report instead.
- When sharing evidence in Slack, prefer IDs, statuses, object presence, and
  short sanitized excerpts.

## Required Access

- GitHub issue access for `SUPPORT_GITHUB_OWNER/SUPPORT_GITHUB_REPO`.
- Linear workspace access for the configured support team/project.
- Sentry access for relevant projects:
  `proliferate-server`, `proliferate-desktop`,
  `proliferate-desktop-native`, `anyharness`, `proliferate-target`,
  `proliferate-web`, and `proliferate-mobile`.
- AWS CloudWatch Logs access for the production or staging API log group.
- AWS S3 `ListBucket`, `GetObject`, and `HeadObject` access for the support
  report bucket.
- Read access to the production or staging database table `support_report`.
- AWS ECS/SSM or deployment-environment access when checking runtime env vars,
  task definitions, or deployed server revisions.

## Config Checkpoints

Do not start an investigation by auditing every support env var. Start from the
`support_report` row, S3 objects, CloudWatch, Sentry, and tracker links. Check
configuration only when the symptom points there.

Storage/upload failures:

- `SUPPORT_REPORT_S3_BUCKET`
- `SUPPORT_REPORT_S3_PREFIX`
- `SUPPORT_REPORT_S3_REGION`
- upload size caps when the client or server says diagnostics or attachments
  are too large

Tracker failures:

- `SUPPORT_TRACKER_ENABLED`
- GitHub app id, installation id, private key, owner, repo, and labels
- Linear API key, team id, project id, and private-details label id
- tracker retry interval, batch size, max attempts, and retry base seconds

Internal links:

- `SUPPORT_REPORT_INTERNAL_BASE_URL`

Use
[`../reference/env-vars.yaml`](../reference/env-vars.yaml) and
[`../deploying/ci-cd.md`](../deploying/ci-cd.md) for the full environment
variable inventory and where values live.

Current default S3 object prefix shape:

```text
<SUPPORT_REPORT_S3_PREFIX>/<YYYY>/<MM>/<DD>/<reportId>
```

The default prefix is `support/reports`.

## Find The Report

Start with whichever identifier you have.

GitHub issue:

- Look for `Support report: <reportId>` in the body.
- Search for the hidden marker text
  `proliferate-support-report:<reportId>` when checking idempotency.
- Expected labels are the configured support label and, when public consent is
  false, the configured private label.

Linear issue:

- Look for `Support report: <reportId>` in the description.
- Search description text for the same hidden marker:
  `proliferate-support-report:<reportId>`.
- Expected project/team and private-details label come from the Linear support
  config.

Slack:

- The completion notification should contain the `reportId` and internal report
  URL when `SUPPORT_REPORT_INTERNAL_BASE_URL` is configured.
- The tracker notification should contain GitHub and Linear links when they
  exist.

S3:

- If you have only a date and rough time, list the support prefix for that day
  and sort by `LastModified`.
- Prefer finding the DB row first because the row has the exact bucket and
  prefix.

Sentry/PostHog/Desktop:

- Search recent Desktop Sentry event IDs from `request.json.telemetryRefs`.
- Search PostHog for `support_report_submitted` when hosted-product telemetry
  is enabled.
- Desktop's local upload queue key is
  `proliferate.supportReportJobs.v1`; attachment staging is under the native
  app data directory `support-report-attachments`.

## Database First

Fetch the row and use it as the truth table for the rest of the investigation.

```sql
select
  id,
  client_job_id,
  owner_user_id,
  primary_organization_id,
  primary_tenant_id,
  tenant_ids_json,
  status,
  source_surface,
  request_id,
  complete_request_id,
  s3_bucket,
  s3_prefix,
  request_object_written_at,
  completed_at,
  public_content_consent,
  cloud_diagnostics_status,
  cloud_diagnostics_error,
  cloud_diagnostics_started_at,
  cloud_diagnostics_completed_at,
  slack_notified_at,
  tracker_status,
  tracker_attempt_count,
  tracker_next_attempt_at,
  tracker_locked_until,
  tracker_synced_at,
  tracker_slack_notified_at,
  tracker_last_error_code,
  tracker_last_error_message,
  github_status,
  github_issue_number,
  github_issue_url,
  github_create_attempted_at,
  linear_status,
  linear_issue_identifier,
  linear_issue_url,
  linear_create_attempted_at,
  crosslink_status,
  created_at,
  updated_at
from support_report
where id = '<reportId>';
```

Then inspect JSON columns without printing private message content:

```sql
select
  source_context_json,
  workspace_refs_json,
  telemetry_refs_json,
  expected_uploads_json,
  object_manifest_json
from support_report
where id = '<reportId>';
```

Important lifecycle states:

- `status=created`: row exists, `request.json` should exist, upload targets may
  not have been requested yet.
- `status=uploading`: upload targets were issued and `object_manifest_json`
  should contain expected S3 keys/checksums.
- `status=completed`: server verified uploads, wrote `complete.json`, and
  tracker reconciliation should be pending, partial, completed, disabled, or
  failed.
- `request_object_written_at is null`: row creation started but `request.json`
  did not get committed to S3.
- `cloud_diagnostics_status=completed`: server wrote
  `cloud-diagnostics.json`.
- `cloud_diagnostics_status=failed`: report submission may still be complete;
  inspect `cloud_diagnostics_error` and CloudWatch.
- `tracker_status=partial`: GitHub exists, but Linear or crosslinking failed.
- `tracker_status=failed_retryable`: the reconciler should retry after
  `tracker_next_attempt_at`.
- `tracker_status=failed_permanent`: fix configuration or data manually; the
  reconciler will not fix it by waiting.

## S3 Bundle

Never paste object bodies into public systems. Download to a private temp
directory if you need to inspect them.

List objects:

```bash
export SUPPORT_REPORT_S3_BUCKET='<bucket-from-db>'
export SUPPORT_REPORT_S3_PREFIX='<s3-prefix-from-db>'

aws s3api list-objects-v2 \
  --bucket "$SUPPORT_REPORT_S3_BUCKET" \
  --prefix "$SUPPORT_REPORT_S3_PREFIX/" \
  --query 'Contents[].{Key:Key,Size:Size,LastModified:LastModified}' \
  --output table
```

Expected objects:

- `request.json`: written during `POST /v1/support/reports`.
- `diagnostics.json`: client diagnostics uploaded through a presigned `PUT`.
- `attachments/{clientFileId}/{safeFileName}`: explicit user attachments.
- `cloud-diagnostics.json`: server-collected cloud workspace diagnostics when
  authorized cloud workspace refs exist.
- `complete.json`: written during `POST /v1/support/reports/{reportId}/complete`.
- `tracker.json`: written after GitHub/Linear reconciliation.

Check object metadata:

```bash
aws s3api head-object \
  --bucket "$SUPPORT_REPORT_S3_BUCKET" \
  --key "$SUPPORT_REPORT_S3_PREFIX/diagnostics.json"
```

Inspect safe summaries only:

```bash
mkdir -p /tmp/proliferate-support-report

aws s3 cp \
  "s3://$SUPPORT_REPORT_S3_BUCKET/$SUPPORT_REPORT_S3_PREFIX/request.json" \
  /tmp/proliferate-support-report/request.json

jq '{
  schemaVersion,
  reportId,
  clientJobId,
  requestId,
  createdAt,
  publicContentConsent,
  source: .context.source,
  scope,
  correlation,
  telemetryRefs,
  messagePresent: ((.message // "") | length > 0),
  messageLength: ((.message // "") | length)
}' /tmp/proliferate-support-report/request.json
```

For `diagnostics.json`, check shape and caps before reading details:

```bash
aws s3 cp \
  "s3://$SUPPORT_REPORT_S3_BUCKET/$SUPPORT_REPORT_S3_PREFIX/diagnostics.json" \
  /tmp/proliferate-support-report/diagnostics.json

jq '{
  schemaVersion,
  generatedAt,
  correlation,
  diagnosticsKeys: (keys | sort),
  messagePresent,
  messageLength
}' /tmp/proliferate-support-report/diagnostics.json
```

For `cloud-diagnostics.json`, use the query hints:

```bash
aws s3 cp \
  "s3://$SUPPORT_REPORT_S3_BUCKET/$SUPPORT_REPORT_S3_PREFIX/cloud-diagnostics.json" \
  /tmp/proliferate-support-report/cloud-diagnostics.json

jq '{
  schemaVersion,
  reportId,
  generatedAt,
  normalizedIds,
  caps,
  truncation,
  queryHints,
  sectionErrors
}' /tmp/proliferate-support-report/cloud-diagnostics.json
```

For `tracker.json`:

```bash
aws s3 cp \
  "s3://$SUPPORT_REPORT_S3_BUCKET/$SUPPORT_REPORT_S3_PREFIX/tracker.json" \
  /tmp/proliferate-support-report/tracker.json

jq . /tmp/proliferate-support-report/tracker.json
```

## CloudWatch Logs

Use CloudWatch Logs Insights against the deployed API/server log group for the
environment. If you do not know the log group, find it from the ECS service,
task definition, or deployment environment.

Find likely log groups:

```bash
aws logs describe-log-groups \
  --log-group-name-prefix /aws/ecs/proliferate \
  --query 'logGroups[].logGroupName' \
  --output text
```

Start with the support report ID:

```sql
fields @timestamp, @message, support_report_id, request_id, user_id, tenant_id
| filter support_report_id = '<reportId>' or @message like /<reportId>/
| sort @timestamp asc
| limit 200
```

If you only have a user, tenant, or request ID:

```sql
fields @timestamp, @message, support_report_id, request_id, user_id, tenant_id
| filter request_id = '<requestId>'
    or user_id = '<ownerUserId>'
    or tenant_id = '<tenantId>'
    or @message like /\/v1\/support\/reports/
| sort @timestamp asc
| limit 200
```

Expected successful messages:

- `Support report created.`
- `Support report upload targets issued.`
- `Support report completed.`

Expected best-effort warning/failure messages to inspect:

- `Support report Slack notification failed`
- `Support cloud diagnostics collection failed.`
- `Support tracker processing failed.`
- `Support tracker Linear issue creation failed.`
- `Support tracker record could not be written.`
- `Support tracker Slack notification failed`
- `Support tracker reconciler pass failed.`

Tracker-focused query:

```sql
fields @timestamp, @message, support_report_id, tracker_status,
       github_status, linear_status, crosslink_status
| filter support_report_id = '<reportId>'
    or @message like /Support tracker/
| sort @timestamp asc
| limit 200
```

Endpoint-focused query:

```sql
fields @timestamp, @message, status_code, method, path,
       support_report_id, request_id, user_id, tenant_id
| filter path like /\/v1\/support\/reports/
    or @message like /\/v1\/support\/reports/
| sort @timestamp desc
| limit 200
```

When CloudWatch has an exception but no `support_report_id`, pivot by
`request_id`, `owner_user_id`, tenant ID, or the wall-clock time from
`created_at`/`updated_at`.

CLI form for a focused query:

```bash
export LOG_GROUP='<api-log-group>'
export REPORT_ID='<reportId>'
export START_TIME="$(python3 - <<'PY'
import time
print(int(time.time()) - 6 * 60 * 60)
PY
)"
export END_TIME="$(python3 - <<'PY'
import time
print(int(time.time()))
PY
)"

QUERY_ID="$(aws logs start-query \
  --log-group-name "$LOG_GROUP" \
  --start-time "$START_TIME" \
  --end-time "$END_TIME" \
  --query-string "fields @timestamp, @message, support_report_id, request_id, user_id, tenant_id | filter support_report_id = '$REPORT_ID' or @message like /$REPORT_ID/ | sort @timestamp asc | limit 200" \
  --query 'queryId' \
  --output text)"

aws logs get-query-results --query-id "$QUERY_ID"
```

## Sentry

Check Sentry before assuming the support report itself is the bug.

Search terms:

```text
support_report_id:<reportId>
request_id:<requestId>
tenant_id:<primaryTenantId>
user.id:<ownerUserId>
```

Also search any event IDs listed in `request.json.telemetryRefs.sentryEventIds`.

Use projects by surface:

- `proliferate-server`: report endpoints, S3 writes, tracker reconciler,
  GitHub/Linear failures.
- `proliferate-desktop`: support window, upload queue, presigned upload fetch,
  local payload building, toasts.
- `proliferate-desktop-native`: Tauri support window, file staging,
  diagnostics collection, native crashes.
- `anyharness`: local/runtime diagnostics collection errors.
- `proliferate-target`: cloud target/runtime failures referenced by
  `cloud-diagnostics.json`.
- `proliferate-web` and `proliferate-mobile`: zero-upload or future web/mobile
  support reports.

Sentry tags are intentionally ID-only. Do not add raw user text, prompts,
transcripts, command payloads, URLs with tokens, file contents, or attachment
data to Sentry context.

## GitHub And Linear

The support tracker is idempotent by hidden marker:

```text
<!-- proliferate-support-report:<reportId> -->
```

GitHub also searches for:

```text
proliferate-support-report:<reportId>
```

Expected GitHub state:

- One public issue in `SUPPORT_GITHUB_OWNER/SUPPORT_GITHUB_REPO`.
- Title is `Bug Report: <message summary>` when public consent is true.
- Title is `Bug Report: Support report <reportId>` when public consent is
  false.
- Body contains the hidden marker, report ID, optional Linear URL, and internal
  report line.
- Body contains user message and attachment names only when public consent is
  true.
- Labels include `SUPPORT_GITHUB_LABEL_SUPPORT`.
- Labels include `SUPPORT_GITHUB_LABEL_PRIVATE` when consent is false.

Expected Linear state:

- One issue in the configured support team/project when Linear is configured.
- Description contains the hidden marker, report ID, GitHub URL, internal report
  line, and public-consent-safe user content.
- Private-details label is present when consent is false.

Use the DB row to identify tracker drift:

- `github_status=completed` and no GitHub issue visible: check
  `github_issue_url`, repo permissions, deleted issue state, and GitHub search
  by hidden marker.
- `github_status=failed_permanent`: usually missing GitHub app configuration.
- `linear_status=failed_retryable`: GitHub should still be intact; check Linear
  API key, team/project IDs, labels, and GraphQL errors in CloudWatch.
- `crosslink_status=failed_retryable`: both issues may exist, but one body did
  not update; rerun tracker after external/API errors clear.

GitHub CLI check:

```bash
export SUPPORT_GITHUB_OWNER='<owner>'
export SUPPORT_GITHUB_REPO='<repo>'
export REPORT_ID='<reportId>'

gh api search/issues \
  -f q="\"proliferate-support-report:$REPORT_ID\" repo:$SUPPORT_GITHUB_OWNER/$SUPPORT_GITHUB_REPO type:issue in:body" \
  --jq '.items[] | {number, title, state, html_url, labels: [.labels[].name]}'
```

Linear API check:

```bash
export REPORT_ID='<reportId>'
export SUPPORT_LINEAR_API_KEY='<linear-api-key>'

curl -s https://api.linear.app/graphql \
  -H "Authorization: $SUPPORT_LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  --data "$(
    jq -nc --arg marker "<!-- proliferate-support-report:$REPORT_ID -->" '{
      query: "query SupportIssueByMarker($marker: String!) { issues(filter: { description: { contains: $marker } }, first: 10) { nodes { id identifier title url description project { name } labels { nodes { name } } } } }",
      variables: { marker: $marker }
    }'
  )" \
  | jq '.data.issues.nodes[] | {identifier, title, url, project: .project.name, labels: [.labels.nodes[].name]}'
```

## Failure Matrix

No `support_report` row:

- The client likely failed before or during `POST /v1/support/reports`.
- Check Desktop Sentry, renderer diagnostics, Cloud auth state, and CloudWatch
  for support endpoint 401/4xx/5xx.
- If Desktop showed `Sign in to Proliferate Cloud to send support reports.
  Report is queued.`, the job is waiting for real Cloud auth.
- If Desktop showed `Support reports need real Cloud sign-in. Disable dev auth
  bypass first.`, local dev auth bypass is blocking real support submission.

Row exists, `request_object_written_at` is null:

- Server created a row but failed to write `request.json`.
- Check `SUPPORT_REPORT_S3_BUCKET`, `SUPPORT_REPORT_S3_REGION`, bucket policy,
  IAM, and CloudWatch for `support_report_storage_unavailable`.
- Do not manually mark the report created unless `request.json` has been
  written correctly.

`status=created`, no upload manifest:

- Client never requested upload targets.
- Check Desktop queue, local attachment staging, diagnostics builder failures,
  auth token refresh, and Sentry in `proliferate-desktop`.
- The local job may retry from `proliferate.supportReportJobs.v1`.

`status=uploading`, missing S3 objects:

- Upload targets were issued, but one or more presigned `PUT` requests failed
  or expired.
- Compare `object_manifest_json` to S3 `list-objects-v2`.
- Check CORS/network failures, upload URL expiration, object size caps, and
  Desktop Sentry.
- A retry should refresh upload targets only when metadata matches the original
  manifest.

`/complete` returns an upload-invalid error:

- The completion payload did not match the immutable manifest.
- Compare completed keys, sizes, and SHA-256 values to `object_manifest_json`.
- Common causes are duplicate object keys, unknown keys, missing expected
  objects, size mismatches, checksum mismatches, or a key outside the report
  prefix.

`status=completed`, no Slack completion notification:

- The report is still valid. Slack is best effort.
- Check `slack_notified_at` and CloudWatch for
  `Support report Slack notification failed`.

`cloud_diagnostics_status=failed`:

- The user report may still be complete.
- Check `cloud_diagnostics_error` and CloudWatch for
  `Support cloud diagnostics collection failed.`
- If the error is S3 write related, verify bucket/IAM/region.
- If the error is authorization or no workspace refs, inspect
  `workspace_refs_json`; unverified cloud refs are intentionally excluded.

`cloud_diagnostics_status=skipped`:

- No authorized cloud workspace references were available.
- This is expected for app-only reports, local-only reports, or unauthorized
  cloud workspace refs.

`tracker_status=pending` for too long:

- Check `SUPPORT_TRACKER_ENABLED`.
- Check Celery Beat and a `periodic.default` worker are running the
  `support.reconcile_tracker` task.
- Check `tracker_next_attempt_at` and `tracker_locked_until`.
- Call the tracker nudge endpoint from an authenticated context if appropriate:

```bash
curl -X POST \
  "$PROLIFERATE_API_URL/v1/support/reports/<reportId>/tracker" \
  -H "Authorization: Bearer <user-or-internal-token>"
```

`tracker_status=failed_retryable`:

- Inspect `tracker_last_error_code`, `tracker_last_error_message`, and
  CloudWatch exception logs.
- Fix the external dependency or config, then let the reconciler retry or nudge
  the endpoint.
- Retry backoff is based on `SUPPORT_TRACKER_RETRY_BASE_SECONDS` and capped at
  one hour.

`tracker_status=failed_permanent`:

- Waiting will not fix the report.
- Common cause: GitHub support tracker is enabled but the GitHub app config is
  absent or invalid.
- Fix config, deploy, then decide whether to reset/requeue the specific report
  through an admin/backfill path.
- Use
  [`../runbooks/operator-security-posture.md`](../runbooks/operator-security-posture.md)
  for break-glass access and audit closeout if a manual reset/backfill is
  approved before a first-class recovery endpoint exists.

`tracker_status=partial`:

- GitHub exists and is the public source of truth.
- Linear or crosslinking failed.
- Fix Linear config/API issues and rerun tracker reconciliation.

Desktop toast says `Report could not be sent. We'll retry in the background.`:

- This is the generic transient fallback.
- Check whether the row exists.
- If no row exists, inspect auth/network/server create failures.
- If the row exists, inspect upload targets, S3 objects, complete status, and
  Desktop Sentry.
- The queue retries automatically; repeated toasts are rate-limited by failure
  kind.

Desktop toast says `Support uploads are not configured for this server. Report
is queued.`:

- Server returned `support_report_storage_unavailable`.
- Configure support S3 bucket/region and IAM for that environment, then retry.

## Backfill And Idempotency

Support reports are designed to be safely retried.

- Report creation is idempotent by authenticated `owner_user_id` and
  `client_job_id`.
- Upload targets are immutable after the first manifest is stored.
- Completion verifies exactly the objects in the stored manifest.
- GitHub and Linear issue creation are idempotent by the hidden marker.
- `tracker.json` lets S3-only audits see whether tracker reconciliation
  happened.

For batch audits:

1. Query completed rows whose tracker state is not `completed` or `disabled`.
2. Check whether `tracker_next_attempt_at` is due and
   `tracker_locked_until` is absent or expired.
3. Search GitHub and Linear by hidden marker before creating anything manually.
4. Prefer rerunning the server reconciler or a focused internal backfill over
   hand-creating issues.
5. If auditing S3 without DB access, list day prefixes and inspect
   `request.json`, `complete.json`, and `tracker.json` presence.

## Resolution Notes

When closing the investigation, update the GitHub issue with:

- `reportId`
- user-facing symptom
- affected surface/version when known
- root cause
- linked PR or deploy
- whether S3 diagnostics, Sentry, CloudWatch, Linear, or GitHub tracker state
  were checked
- user-facing owner needed

Do not include private S3 object names, bundle contents, attachment bodies, or
raw user diagnostics in the public closeout.
