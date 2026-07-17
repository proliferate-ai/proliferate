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

Sandbox connection attempts are serialized by a per-sandbox lock and reload
the row after acquiring it. A failed attempt durably moves the row to `error`
with a bounded, secret-safe `last_error`; authoritative loss of the current
provider records the same kind of terminal receipt. This is evidence for the
latest failed attempt or provider-loss observation, not destruction of the
logical sandbox. The next normal materialization starts a retry by moving the
row to `creating` and clearing the receipt. If the persisted provider target is
authoritatively gone, that retry atomically supersedes only the expected
binding and closes its exact old usage segment with cloud-row-first lock order,
commits the detach, and creates at most one replacement. Transient or
configuration errors retain the binding and fail closed.

Every connection advances `materialization_attempt`, including `ready` reuse,
and advances a provider-specific `provider_observed_at` floor around provider
I/O. Webhooks, reconciliation, and connection completions must match the exact
attempt and be newer than that floor. Before provider I/O, a legacy open usage
segment with a null provider id is closed with `binding_convergence` under its
unchanged unknown identity; a successful resume then opens a fresh segment for
the current provider. A non-null mismatch is preserved open and the attempt
records a terminal support receipt before any provider call, because the
conflicting provider may still be live. Neither path moves old duration
between provider ids.
If pause evidence overlaps a successful resume request, the server performs one
post-resume exact-ID state observation: running reopens exact usage, paused
keeps it closed, and target-not-found detaches through the same fenced recovery
transaction. Runtime-ready persistence does not advance provider freshness.

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
  materialization_attempt,
  last_error,
  (anyharness_base_url is not null) as has_anyharness_url,
  (runtime_token_ciphertext is not null) as has_runtime_token,
  (anyharness_data_key_ciphertext is not null) as has_data_key,
  ready_at,
  last_health_at,
  provider_observed_at,
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

When an approved production read-only database path exists, this aggregate-only
query measures the legacy ledger shape without returning row or customer ids.
Do not obtain credentials, start an ad-hoc task, or open a production shell to
run it; absence of an authorized path is not evidence that the count is zero.

```sql
BEGIN READ ONLY;

select
  count(*) filter (where us.external_sandbox_id is null)
    as open_null_provider_segments,
  count(*) filter (
    where us.external_sandbox_id is not null
      and us.external_sandbox_id is distinct from cs.provider_sandbox_id
  ) as open_mismatched_provider_segments
from usage_segment us
join cloud_sandbox cs on cs.id = us.sandbox_id
where us.ended_at is null;

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
| Sandbox row is `error` with `last_error` | Treat it as the terminal receipt for the latest sandbox connection failure or authoritative current-provider loss. Repair the classified provider/runtime cause, then retry through the normal materialization or workspace path; the retry moves the same logical row to `creating` and clears the old receipt. |
| Persisted provider target is authoritatively not found | Retry through the normal product path. Under the sandbox lock, the server atomically supersedes only the expected binding and closes its exact old usage segment, commits the detach, and permits one replacement create. Do not clear the id or create a provider sandbox manually. |
| Provider request is transiently unavailable or configuration is invalid | Repair or wait for the classified cause and retry normally. The server intentionally retains the provider binding and does not infer that the target is gone. |
| Provider reports a killed event for the current binding | The logical row remains recoverable: the event closes and detaches that exact provider binding and records `error`. Retry through the normal product path after confirming the cause; only explicit product deletion destroys the logical row. |
| Open usage has a null provider id | Retry through the normal product path. Before provider I/O the server closes the historical segment under the unchanged null identity with `binding_convergence`; it opens current-provider usage only after successful resume. Do not rewrite attribution manually. |
| Open usage has a non-null provider id different from the current binding | The normal retry fails before provider I/O, leaves the conflicting interval open, and records a support receipt. Verify whether that exact historical provider remains live and escalate for an approved accounting/cleanup decision; never reassign or close it as the current provider. |
| Materialization row is `error` | Use `last_error`, logs, and Sentry to repair the repository setup, secret materialization, provider, or runtime cause before retrying through the product. |
| Existing Cloud workspace has no AnyHarness id after the cause is fixed | Delete and recreate that Cloud workspace through the product; do not patch the row manually. |
| Create request failed after AnyHarness may have created the worktree | Correlate the request, user, repository, and branch with the AnyHarness target path, whose suffix contains only the attempted Cloud id's eight-character prefix. Include the AnyHarness workspace id when present, then escalate suspected orphan cleanup; a blind retry can hit the orphaned branch. |
| Sandbox row exists but provider/runtime evidence is absent | Trigger the normal materialization or workspace path; `ensure`/`wake` alone do not perform provider connection. |
| Existing sandbox remains unrecoverable after a classified retry | Escalate with the exact logical sandbox id, current provider binding, sanitized receipt, and provider evidence. Automatic replacement is intentionally limited to authoritative target absence; sandbox deletion still does not remap existing workspaces. |

Do not manually mutate rows, destroy provider sandboxes, rotate tokens, or
attempt a row-by-row sandbox replacement as routine recovery.

## Verification

Recovery is complete when the normal product path connects the provider
sandbox, the `cloud_sandbox` row is `ready` with `last_error IS NULL`, the
materialization row is `ready` with no current error, the Cloud workspace has
an AnyHarness workspace id, and authenticated AnyHarness access through the
cloud-sandbox gateway succeeds. For a replacement, verify that the old exact
usage segment is closed, only one new provider id is bound, and stale events or
reconciliation for the old id did not alter the new binding. Confirm that
any `binding_convergence` segment retained its null provider identity, ended no
earlier than it started, and did not absorb the current provider's new duration.
For a non-null mismatch, verify that the interval remained open and the retry
made no provider call. Confirm that
repeated server/Sentry errors have stopped and record any suspected orphan
runtime worktree for explicit cleanup. Worker health is separate from
AnyHarness availability.

Deterministic integration tests cover error persistence, classification,
concurrent retry, and binding fences. Do not report those tests as live E2B
qualification; record a separate provider-backed receipt when one is run.

## Final report

Report the environment; affected user, Cloud sandbox, provider sandbox,
repository environment, Cloud workspace, and AnyHarness workspace ids; the
first failing deploy/template evidence; root cause; recovery; and verification.
State any unresolved provider cleanup or workspace recreation explicitly, and
confirm that no secrets, ciphertext, signed URLs, or user files were shared.
