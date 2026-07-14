# Cloud provisioning failure

Status: authoritative for first-response triage of managed cloud sandbox and
workspace materialization failures.

Use this runbook when a user's cloud sandbox cannot be connected, a repository
environment cannot be materialized, or a Cloud workspace cannot reach its
AnyHarness worktree. The current lifecycle is owned by
[`sandbox-provisioning.md`](../../codebase/platforms/product/sandbox-provisioning.md)
and
[`workspace-provisioning.md`](../../codebase/platforms/product/workspace-provisioning.md).
Use [`worker-enrollment-failure.md`](worker-enrollment-failure.md) only after
checking AnyHarness independently: Worker startup is optional and
best-effort.

## Required access

- Read-only access to the affected Proliferate database.
- Server logs and Sentry for the affected environment.
- E2B dashboard access for the affected provider sandbox.
- GitHub Actions access when the failure follows a deploy or template change.

Do not paste provider keys, runtime tokens or data keys, repository secrets,
signed URLs, or user files into chat, issues, PRs, or logs. Share only the
affected user, sandbox, provider sandbox, repository environment, workspace,
request, and sanitized evidence identifiers.

## Mental model

`ensure` and `wake` validate configuration and billing and ensure the user's
`cloud_sandbox` row. E2B create/resume and AnyHarness connection occur later,
just in time during repository materialization. Saving a Cloud repo environment
schedules best-effort materialization; creating a workspace forces
materialization synchronously and then calls AnyHarness directly.

Cloud and AnyHarness workspace creation is not atomic. The Cloud row is flushed
before the AnyHarness call but remains in the request transaction; a propagated
failure rolls it back. If AnyHarness succeeds and a later Cloud write or commit
fails, the runtime worktree can remain without a committed Cloud row. There is
no automatic cleanup or routine retry for that state.

Pre-existing or legacy Cloud rows with `anyharness_workspace_id = NULL` still
remain `materializing` and become `error` after the current stale threshold.
The shipped recovery for that row is delete and recreate after the root cause
is fixed.

## Read-only diagnosis

Replace the placeholders locally. Do not include token or ciphertext columns
in query output.

```sql
BEGIN READ ONLY;

-- 1. Find the user's current personal sandbox and whether runtime access exists.
select
  id,
  owner_user_id,
  sandbox_type,
  provider_sandbox_id,
  status,
  (anyharness_base_url is not null) as has_anyharness_url,
  (runtime_token_ciphertext is not null) as has_runtime_token,
  (anyharness_data_key_ciphertext is not null) as has_data_key,
  ready_at,
  last_health_at,
  destroyed_at,
  created_at,
  updated_at
from cloud_sandbox
where owner_user_id = '<user-id>'
order by created_at desc;

-- 2. Find the user's Cloud repository environments.
select
  re.id as repo_environment_id,
  rc.git_owner,
  rc.git_repo_name,
  re.default_branch,
  re.updated_at,
  re.deleted_at
from repo_environment re
join repo_config rc on rc.id = re.repo_config_id
where rc.user_id = '<user-id>'
  and re.environment_kind = 'cloud'
order by re.updated_at desc;

-- 3. Inspect materialization state and its persisted error.
select
  id,
  cloud_sandbox_id,
  repo_environment_id,
  status,
  applied_repo_environment_updated_at,
  last_error,
  materialized_at,
  created_at,
  updated_at
from cloud_repo_environment_materialization
where cloud_sandbox_id = '<cloud-sandbox-id>'
  and repo_environment_id = '<repo-environment-id>';

-- 4. Correlate the user's Cloud workspaces with AnyHarness identities.
select
  id,
  repo_environment_id,
  display_name,
  git_branch,
  git_base_branch,
  anyharness_workspace_id,
  archived_at,
  created_at,
  updated_at
from cloud_workspace
where owner_user_id = '<user-id>'
  and repo_environment_id = '<repo-environment-id>'
order by created_at desc;

ROLLBACK;
```

Then correlate `cloud_sandbox.id`, `provider_sandbox_id`,
`repo_environment.id`, `cloud_workspace.id`, `anyharness_workspace_id`, user
id, and request id across structured server logs and Sentry. In E2B, verify the
persisted provider sandbox's current state. If the incident follows a deploy or
template change, compare that evidence with the exact deploy/template workflow
run and immutable template tag.

## First response

| Evidence | First response |
| --- | --- |
| Provider auth, quota, or capacity failure | Check E2B status and account quota; repair credentials only in their owning secret store. |
| New template fails to boot or lacks a required binary | Follow [`e2b-template-rollback.md`](e2b-template-rollback.md). |
| Materialization row is `error` | Use `last_error`, logs, and Sentry to repair the repository setup, secret materialization, provider, or runtime cause before retrying through the product. |
| Existing Cloud workspace has no AnyHarness id after the cause is fixed | Delete and recreate that Cloud workspace through the product; do not patch the row manually. |
| Create request failed after AnyHarness may have created the worktree | Correlate the request, user, repository, and branch with the AnyHarness target path, whose suffix contains only the attempted Cloud id's eight-character prefix. Include the AnyHarness workspace id when present, then escalate suspected orphan cleanup; a blind retry can hit the orphaned branch. |
| Sandbox row exists but provider/runtime evidence is absent | Trigger the normal materialization or workspace path; `ensure`/`wake` alone do not perform provider connection. |
| Existing sandbox remains unrecoverable | Escalate. There is no shipped atomic sandbox-replacement flow, and sandbox deletion does not kill E2B or remap existing workspaces. |

Do not manually mutate rows, destroy provider sandboxes, rotate tokens, or
attempt a row-by-row sandbox replacement as routine recovery.

## Verification

Recovery is complete when the normal product path connects the provider
sandbox, the materialization row is `ready` with no current error, the Cloud
workspace has an AnyHarness workspace id, and authenticated AnyHarness access
through the cloud-sandbox gateway succeeds. Confirm that repeated server/Sentry
errors have stopped and record any suspected orphan runtime worktree for
explicit cleanup. Worker health is separate from AnyHarness availability.

## Final report

Report the environment; affected user, Cloud sandbox, provider sandbox,
repository environment, Cloud workspace, and AnyHarness workspace ids; the
first failing deploy/template evidence; root cause; recovery; and verification.
State any unresolved provider cleanup or workspace recreation explicitly, and
confirm that no secrets, ciphertext, signed URLs, or user files were shared.
