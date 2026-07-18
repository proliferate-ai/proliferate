# Operator security posture

Status: authoritative baseline for privileged support and recovery actions.

Use this runbook before actions that can expose customer data, rotate secrets,
revoke worker access, attach directly to runtime infrastructure, or modify
billing/support/runtime state outside normal product flows.

## Required posture

- Name one incident owner before starting privileged work.
- Use the least-privileged access path that can answer the question or perform
  the recovery.
- Prefer read-only evidence collection before write actions.
- Keep secrets in the owning secret store. Never paste them into chat, issues,
  PRs, docs, terminal transcripts, screenshots, or support tickets.
- Record operator actions in the incident issue with sanitized ids and links.
- Create a follow-up issue when a manual action reveals missing product or
  operator tooling.

## Break-glass access

Break-glass access is for active incidents only.

1. Confirm the incident owner and affected environment.
2. State the exact action and why ordinary product/admin flows are insufficient.
3. Time-box the access and scope it to the smallest environment/resource set.
4. Capture sanitized evidence before and after the action.
5. Revoke or let temporary credentials expire after the action.
6. Add an audit closeout to the incident issue.

## Secret rotation

Rotate secrets through the owning hosted secret manager or provider dashboard.
Do not rotate by editing local env files and copying values around.

Common secret groups:

- Cloud control-plane signing: `CLOUD_SECRET_KEY`.
- Provider access: `E2B_API_KEY`.
- Provider webhooks: `E2B_WEBHOOK_SIGNATURE_SECRET`.
- Remote runtime observability: `CLOUD_RUNTIME_SENTRY_DSN`,
  `CLOUD_TARGET_SENTRY_DSN`.
- Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Support tracker/storage: support S3, GitHub, Linear, and Slack credentials.

After rotation:

- restart or redeploy the processes that read the secret;
- verify new requests succeed;
- verify old credentials no longer work when the provider supports it;
- update the incident issue with secret name, environment, operator, and
  verification, not the secret value.

## Support bundles and customer data

- Start from the `support_report` row and uploaded bundle index.
- Download only the files required for the investigation.
- Store temporary copies under a local private incident directory.
- Do not attach raw support bundle files to public issues or PRs.
- Delete temporary local copies after the investigation closes unless legal or
  security asks for retention.

## Direct attach and runtime credentials

Direct attach, runtime access tokens, and worker enrollment credentials are
privileged runtime access.

- Use direct attach only when logs, Sentry, database state, and support bundles
  are insufficient.
- Prefer provider console/session tooling that records operator identity.
- Rotate or revoke direct-attach credentials after use when compromise or
  broad exposure is suspected.
- Verify worker/control convergence after revocation.

## Integration external-action approvals

Durable integration approvals are a product-user security boundary. Operators
must not approve by editing database state, replaying MCP traffic, minting or
copying Worker/session credentials, changing prompt text, or inserting
approval-like provider arguments. Worker tokens, gateway bearers, and signed
MCP session headers authenticate the exact Worker/workspace/AnyHarness-session
runtime context only; none can perform a human approve, reject, or revoke
decision.

For Slack today:

- the OAuth definition remains exactly the six read/search scopes documented
  in the product integration contract; it does not include `chat:write` or any
  other write scope;
- known external-action tools may create a durable pending request, but no
  Slack mutation is delivered in the current slice;
- unknown Slack tools fail closed; and
- do not install or reauthorize Slack, invoke live Slack, or test a send, edit,
  delete, reaction, canvas, conversation, reminder, profile, or file action as
  an operational verification step.

An approval expires 600 seconds after the PostgreSQL-owned request timestamp.
Treat its `expires_at` as authoritative even if the stored active status has not yet been materialized
as `expired`; list/get/decision/admission observation writes the terminal state
and system audit event. Approval audit evidence includes immutable user,
organization, account revision, Worker, gateway session, workspace,
AnyHarness session, decision actor, timestamps,
and fixed safe action/account/source labels. Target and content presentation
remain absent until an executable tool owns a canonical typed action parser.
Do not copy raw provider payloads, credentials, auth headers, or unredacted
message content into an incident record.

If an approval flow appears stuck or mismatched, preserve the approval id and
sanitized binding ids, inspect its lifecycle events, account `auth_version`,
Worker/workspace/session match, and expiry, then let the user create a fresh request.
Never reset `consumed`, extend the TTL, alter a payload digest, or clone an
approval to force delivery. Escalate missing product recovery tooling instead
of bypassing one-time admission.

## Audit closeout

Every privileged action should leave an incident note with:

- operator;
- timestamp;
- environment;
- action category;
- affected ids;
- verification result;
- secrets rotated by name only;
- remaining risk or follow-up issue.

## Common failure modes

| Symptom | First response |
| --- | --- |
| Secret value appears in chat or an issue | Treat as exposure; rotate the secret and ask security/incident owner for retention cleanup. |
| Operator cannot prove what was changed | Stop additional manual work and reconstruct evidence from logs, provider audit trails, and database updated timestamps. |
| Temporary access remains active | Revoke it before closing the incident and record the revocation evidence. |
| Manual data repair was required | Open a product/operator-tooling follow-up so the action becomes audited and repeatable. |

## Final report

Report the incident owner, privileged action categories, affected ids, secret
names rotated, verification evidence, temporary access revocation, support
bundle handling, and follow-up issues. State explicitly that no secret values,
runtime tokens, signed URLs, or raw customer files were shared.
