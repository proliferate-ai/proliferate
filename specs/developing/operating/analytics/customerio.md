# Customer.io Operations

Status: authoritative for discovering and verifying current Customer.io state.

Use this procedure to determine whether a deployment is configured for
Customer.io, verify the code-owned profile/event contract, inspect current
provider state, or make an explicitly approved provider-configuration change.
The system contract is [Product Engagement](../../../codebase/systems/product/engagement/README.md).

## Applicability

| Deployment | Procedure scope |
| --- | --- |
| Proliferate hosted | Authorized operators may inspect the configured hosted environment and its current Customer.io account. Provider object names, ids, and activation state must be discovered at execution time. |
| Self-hosted | Useful only when the operator has deliberately configured both Customer.io Track API settings for their own account and runs the server plus background worker and Beat. Otherwise the integration is a supported no-op. |
| Local profile | Useful only for an intentionally configured test profile. Do not point routine development at a production Customer.io account. |

## Secret And Privacy Safety

Never place Customer.io credentials or secret values in CLI arguments, shell
history, terminal output, screenshots, issues, PRs, documentation, or chat.
Use an approved credential store or an already authenticated provider session.
Do not expose user email, profile attributes, or delivery content in shared
evidence; report the Proliferate user UUID and sanitized timestamps/statuses
where possible.

This integration carries identified user data. It does not carry replay data,
prompts, repository contents, workspace names, or transcripts. If observed
provider data exceeds the contract in Product Engagement, stop and investigate
the source before changing provider configuration.

## Read-Only Discovery

Start every investigation without changing repository, deployment, or
provider state.

1. Identify the deployment and source revision being inspected.
2. Through that deployment's configuration control plane, confirm only whether
   the names `CUSTOMERIO_SITE_ID` and `CUSTOMERIO_API_KEY` are both present.
   Do not read or print their values.
3. Confirm that the server revision contains the current adapter and that the
   background worker imports `customerio_sync`. When the settings are absent,
   stop: identify/event calls are inert and Beat does not register the nightly
   task.
4. In an authenticated Customer.io session, discover the current account or
   workspace, campaigns, segments, templates, and activation states. Treat
   this as time-stamped provider evidence, not a fact to copy into canonical
   docs.
5. Choose an approved test profile by Proliferate user UUID. Keep its email and
   other personal attributes out of captured evidence.

## Verify Desktop Authentication Delivery

1. Record the deployment revision and a narrow server-log time window.
2. Complete a real desktop GitHub authentication with the approved test user.
3. In read-only server logs, check for a Customer.io scheduling or adapter
   warning. The adapter intentionally logs only a static operation, HTTP status
   when available, and exception type.
4. In Customer.io's read-only profile/event views, find the profile by the
   Proliferate user UUID and verify the code-owned fields in
   [Product Engagement](../../../codebase/systems/product/engagement/README.md).
5. Verify one `desktop_authenticated` event with
   `auth_provider = "github"` in the expected time window.

Absence of an adapter warning is not proof of provider delivery. Provider
profile/event evidence is the final check.

## Verify The Nightly Sync

1. Confirm the Beat scheduler and background worker for the deployment are
   running and using the expected revision.
2. Confirm the schedule contains `customerio-engagement-sync` at 09:00 UTC.
3. After the next scheduled run, find the completion log and record only the
   users-processed and successful-push counts plus the time window.
4. Investigate any static `Failed to push Customer.io user attributes` warnings
   in that window. A run can return `ok` even when some profile pushes failed.
5. In Customer.io, inspect a small approved sample by user UUID. Compare
   `workspace_count`, `last_active_at`, and `email_type` with read-only source
   data without exporting personal data into the incident record.

The implementation performs one user-pagination query and three aggregate
queries for each nonempty page of up to 500 users. Unexpected per-user database
query growth is a code regression, not provider behavior.

## Provider Configuration Changes

Campaigns, segments, templates, senders, topics, ids, and activation state are
mutable Customer.io configuration. Do not infer their current state from this
repository.

For an approved change:

1. Capture a read-only, time-stamped summary of the current object and delivery
   state without secrets or user data.
2. Write the intended audience, trigger, content owner, subscription behavior,
   rollback, and proof before editing.
3. Obtain the required human approval for audience, copy, and activation.
4. Use an authenticated provider session or credential-store-backed CLI. Never
   put a token or secret in a command.
5. Prefer the provider's draft, preview, or test mode. Send only to an approved
   test profile and verify the resulting delivery in the provider's delivery
   view before activation.
6. Apply the smallest approved change, then repeat the read-only discovery and
   delivery checks.
7. Record what changed and the evidence time. Keep mutable provider ids and
   rollout status in the operational record, not canonical system docs.

If a provider change needs a new event, attribute, destination, identity rule,
or enablement gate, stop and make the source and Product Engagement contract
change together in a separate reviewed PR.

## Failure Interpretation

| Evidence | Meaning |
| --- | --- |
| Either Track API setting absent | Supported no-op; no identify/event traffic and no nightly schedule. |
| Static identify/event warning | The auth flow continued, but Customer.io did not confirm that operation. |
| Static profile-push warning | That nightly profile write was not counted as successful; remaining users continued. |
| Completion count lower than processed count | At least one profile was disabled or failed to push; the task can still return `ok`. |
| Profile/event absent with no server warning | Reconfirm deployment revision, settings presence, callback path, time window, and provider account before escalating. |

Do not rotate credentials, activate campaigns, change audiences, or replay a
bulk sync as routine diagnosis. Escalate with the deployment revision, user UUID,
sanitized time window, operation type, and provider delivery status.
