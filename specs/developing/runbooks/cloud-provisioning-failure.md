# Cloud provisioning failure

Status: authoritative for first-response triage of managed cloud sandbox
provisioning failures.

Use this runbook when managed cloud target creation, sandbox creation, runtime
bootstrap, or workspace materialization fails before a worker is enrolled. The
data model is owned by
[`../../codebase/platforms/product/sandbox-provisioning.md`](../../codebase/platforms/product/sandbox-provisioning.md).
Template rollback is covered by
[`e2b-template-rollback.md`](e2b-template-rollback.md).

## Required access

- Read access to the affected Proliferate database.
- CloudWatch, Sentry, or server log access for the affected environment.
- E2B dashboard access for the affected environment.
- GitHub Actions access when the failure follows a template or deploy change.
- Secret-store access only when an incident owner asks you to verify provider
  credentials or runtime injection config.

Secrets policy:

- Do not paste provider API keys, worker enrollment tokens, runtime access
  tokens, signed URLs, target environment values, or user repo secrets into
  chat, issues, PRs, or docs.
- Share target ids, sandbox ids, workspace ids, command ids, request ids,
  template refs, workflow run URLs, and sanitized log snippets.

## First response

1. Identify the failing environment and provider:

   ```sql
   select id, slug, provider, status, created_at, updated_at
   from cloud_target
   where id = '<target-id>';
   ```

2. Inspect the active sandbox row:

   ```sql
   select
     id,
     target_id,
     provider,
     provider_sandbox_id,
     status,
     template_ref,
     last_error_code,
     last_error_message,
     created_at,
     updated_at
   from cloud_sandbox
   where target_id = '<target-id>'
   order by created_at desc
   limit 5;
   ```

3. Check provisioning commands and runtime events around the same time:

   ```sql
   select id, kind, status, error_code, error_message, created_at, updated_at
   from cloud_command
   where target_id = '<target-id>'
   order by created_at desc
   limit 20;
   ```

4. Search logs and Sentry for the target id, sandbox id, provider sandbox id,
   request id, and template ref.
5. If the failure started immediately after a template promotion, follow
   [`e2b-template-rollback.md`](e2b-template-rollback.md) before retrying more
   user work.

## Recovery path

Prefer fixing the upstream provisioning blocker and retrying the normal product
path. Avoid manual database edits unless an incident owner records the exact
reason and a follow-up issue.

1. Provider auth or quota failure: verify provider status, account quota, and
   hosted secret configuration. Refresh secrets in the owning secret store
   without printing values.
2. Template boot or missing binary failure: roll back the template or deploy a
   repaired immutable template. Do not keep creating sandboxes from a known bad
   rolling tag.
3. Runtime bootstrap failure: inspect injected binary paths and Sentry DSNs in
   [`../reference/env-secrets-matrix.md`](../reference/env-secrets-matrix.md).
4. Workspace materialization failure: inspect the command payload, workspace
   row, and repo config. Retry only after the root cause is fixed.
5. If an already-created target is stuck on a bad sandbox image, use
   [`managed-target-replacement.md`](managed-target-replacement.md) for
   containment and escalation.

## Verification

The incident is recovered when all of these are true:

- New sandbox creation reaches the expected running/enrolled state.
- The active `cloud_sandbox` row has the expected provider id and no current
  provisioning error.
- A new or retried workspace command completes successfully.
- CloudWatch and Sentry no longer show repeated provisioning failures for the
  same template, provider account, or target cohort.
- Any affected support report or incident issue is updated with target ids,
  sandbox ids, and sanitized verification evidence.

## Common failure modes

| Symptom | First response |
| --- | --- |
| Provider create returns auth failure | Verify provider secret presence and environment binding; rotate only through the secret store. |
| Provider create returns quota or capacity failure | Check provider status/quota and pause retries if capacity is exhausted. |
| Sandbox starts but worker never enrolls | Switch to [`worker-enrollment-failure.md`](worker-enrollment-failure.md). |
| New sandboxes boot with the old bad image | Confirm `E2B_TEMPLATE_NAME` or provider config is not pinned to a bad immutable ref. |
| Existing targets still fail after rollback | Existing sandboxes keep their image; coordinate target replacement or user rematerialization. |

## Final report

Report the environment, provider, target ids, sandbox ids, template ref,
first-failing deploy or workflow run, recovery action, verification query
results, and any targets that still need replacement. State explicitly that no
secrets, signed URLs, enrollment tokens, or raw user repo values were shared.
