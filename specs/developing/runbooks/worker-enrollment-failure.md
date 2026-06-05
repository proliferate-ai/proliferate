# Worker enrollment failure

Status: authoritative for first-response triage of managed worker enrollment
failures.

Use this runbook when the sandbox provider created a sandbox, but the
Proliferate Worker or Supervisor does not enroll, does not heartbeat, or cannot
receive control-loop work. Worker structure is owned by
[`../../codebase/structures/proliferate-worker/README.md`](../../codebase/structures/proliferate-worker/README.md).
Provisioning failures before worker startup are covered by
[`cloud-provisioning-failure.md`](cloud-provisioning-failure.md).

## Required access

- Read access to target, worker, sandbox, command, and runtime-access rows.
- CloudWatch, Sentry, or provider log access for server and target processes.
- Provider dashboard access for the affected sandbox.
- GitHub Actions access when the failure follows a worker, supervisor, or
  template release.
- Secret-store access only when rotating signing keys or provider/runtime
  credentials.

Secrets policy:

- Do not paste worker enrollment tokens, direct-attach tokens, runtime access
  token ciphertext, JWT signing keys, provider API keys, or sandbox environment
  values into chat, issues, PRs, or docs.
- Share worker ids, target ids, sandbox ids, command ids, request ids, template
  refs, and sanitized log excerpts.

## First response

1. Find the target, sandbox, and latest worker records:

   ```sql
   select id, status, last_seen_at, desired_version, created_at, updated_at
   from cloud_worker
   where target_id = '<target-id>'
   order by created_at desc
   limit 10;
   ```

2. Inspect target runtime access:

   ```sql
   select target_id, runtime_url, created_at, updated_at
   from cloud_target_runtime_access
   where target_id = '<target-id>';
   ```

3. Check control and command delivery state:

   ```sql
   select id, kind, status, lease_id, error_code, updated_at
   from cloud_command
   where target_id = '<target-id>'
   order by created_at desc
   limit 20;
   ```

4. Search logs and Sentry for the target id, worker id, sandbox id, enrollment
   token fingerprint if one exists, and request id.
5. If a recent template or worker binary promotion preceded the failure, check
   the corresponding GitHub Actions run before rotating credentials.

## Recovery path

1. Worker binary missing or crashes before enrollment: treat it as a template
   or runtime injection issue and use
   [`e2b-template-rollback.md`](e2b-template-rollback.md) if the bad image is
   newly promoted.
2. Enrollment token rejected: verify target identity, token domain, token
   expiry, and server signing key configuration. Rotate signing keys only via
   the operator security posture runbook.
3. Worker enrolls but does not heartbeat: inspect Supervisor and Worker logs in
   the sandbox. Check network egress and server URL configuration.
4. Worker heartbeats but does not receive work: inspect control-loop cursor,
   command leases, and revoked-token delivery. Confirm the worker supports the
   command kind being queued.
5. Existing target remains unhealthy after provider/template recovery: use
   [`managed-target-replacement.md`](managed-target-replacement.md) for
   containment and escalation.

## Verification

The incident is recovered when all of these are true:

- A worker row for the target is active and heartbeating.
- The active sandbox has runtime access materialized.
- A control-loop poll advances and command leases are not stuck.
- A lightweight command or workspace materialization completes successfully.
- Logs and Sentry no longer show repeated enrollment or heartbeat failures for
  the same target cohort.

## Common failure modes

| Symptom | First response |
| --- | --- |
| Worker never appears | Check template contents, binary paths, Supervisor startup, and provider logs. |
| Worker enrollment is unauthorized | Verify token domain/expiry and server signing config; do not print tokens. |
| Worker enrolls repeatedly | Check sandbox restarts, Supervisor crash loops, and duplicate startup scripts. |
| Worker heartbeats but commands remain queued | Inspect supported command kinds, control-loop state, and command leases. |
| Revoked worker continues polling | Confirm revoked-token delivery and rotate direct-attach credentials if needed. |

## Final report

Report the environment, target ids, worker ids, sandbox ids, template ref,
first-failing deploy or workflow run, recovery action, verification query
results, and any targets that still need replacement. State explicitly that no
worker tokens, signing keys, provider secrets, or sandbox environment values
were shared.
