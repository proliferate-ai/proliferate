# Managed target replacement

Status: operational placeholder until the operator-safe replacement flow ships.

Use this runbook when an already-created managed target is stuck on a bad
sandbox image, corrupted runtime state, revoked credentials, or an unrecoverable
provider-side sandbox. The current product has target archive and sandbox
state helpers, but it does not yet expose a single safe operator flow that
archives the old target, creates a replacement, rematerializes workspaces, and
makes stale callbacks inert.

## Required access

- Incident owner approval before replacing or archiving user runtime state.
- Read/write access to the affected Proliferate database only through approved
  internal tooling or migration scripts.
- Provider dashboard access for the affected sandbox.
- Server logs, CloudWatch, and Sentry access.
- Product/support context for affected user, organization, workspace, and repo.

Secrets policy:

- Do not paste provider API keys, runtime tokens, worker enrollment tokens,
  direct-attach credentials, signed URLs, repo secrets, or user files into
  chat, issues, PRs, or docs.
- Share target ids, sandbox ids, worker ids, workspace ids, command ids,
  support report ids, and sanitized error messages.

## Current safe posture

Because the full replacement flow is not implemented yet, do not improvise a
manual row-by-row replacement during a live incident. Use this containment path
instead:

1. Stop the bleeding:
   - Roll back a bad template if new targets are also affected.
   - Disable or pause provider retries if they are creating more bad sandboxes.
   - Keep the affected target isolated from new work where product controls
     allow it.
2. Preserve evidence:
   - Record target id, sandbox id, worker id, workspace ids, template ref,
     provider state, command ids, and support report id.
   - Save sanitized logs and Sentry links.
3. Determine user impact:
   - Is work already committed or exportable?
   - Are pending commands idempotent to replay?
   - Does the user need a support-led migration to a fresh workspace?
4. Escalate to an incident owner for one of:
   - product-supported archive and recreate,
   - a reviewed one-off data repair,
   - waiting for the operator-safe replacement implementation.

## Target end state for the future flow

The replacement implementation should be treated as complete only when it can
do all of the following atomically or with a resumable operation record:

- archive the old target and revoke old workers/grants;
- mark the old sandbox terminal and reject stale provider callbacks;
- create or select the replacement target and provision a fresh sandbox;
- rematerialize affected workspaces or clearly mark them for user action;
- publish control/patch events so workers and clients converge;
- emit operator audit events for each privileged action;
- provide verification queries and a rollback/abort story.

## Verification for any approved one-off

The incident owner must verify:

- The old target no longer accepts new work.
- Old workers, runtime grants, and direct-attach credentials are revoked or
  expired.
- The old sandbox is terminal or provider-killed.
- A new target or workspace can run a lightweight command successfully.
- Stale callbacks from the old sandbox no longer mutate active product state.
- The support issue names the remaining user-visible work, if any.

## Common failure modes

| Symptom | First response |
| --- | --- |
| Existing target still uses bad image after template rollback | Existing sandboxes keep their image; contain the target and escalate replacement. |
| Old worker keeps polling after archive | Re-check worker revocation and direct-attach token expiry; rotate if necessary. |
| Provider callback updates archived state | Open a blocking bug; stale callback rejection is required before broad replacement. |
| Workspace state is unclear | Stop and involve support/product; do not guess whether user work is disposable. |

## Final report

Report the incident owner, affected ids, containment action, user-impact
decision, approved repair path, verification evidence, and any follow-up code
or product work. State explicitly that no secrets, signed URLs, tokens, repo
secrets, or user files were shared.
