# Salvage note: provider-webhook verification shape (cull A-b)

Starting material for the environments rebuild, captured before deleting the
E2B lane of `server/cloud/webhooks/` per
[delivery-spec-delete-dark-cloud](delivery-spec-delete-dark-cloud.md). Git
history holds the full code; this records the discipline worth keeping.

## What survives in place (not deleted)

- The HMAC primitive `verify_e2b_webhook_signature` in
  `server/proliferate/integrations/sandbox/e2b_webhooks.py` (the E2B adapter
  is a keep): `sha256(secret + raw_body)`, base64 without padding, constant
  time compare via `hmac.compare_digest`, plus a legacy urlsafe-alphabet
  variant accepted during rotation. Failure reasons are typed
  (`unconfigured` / `missing_signature` / `invalid_signature`), never
  boolean.
- The GitHub App webhook route (`/v1/cloud/webhooks/github-app`) — live
  github-system surface, relocated (path verbatim) rather than deleted; its
  own HMAC (`x-hub-signature-256`) lives with the github system.

## The service-level discipline the dying lane encoded

1. **Verify against the raw body before any parse or DB read.** The route
   handler passes `await request.body()` bytes straight to verification;
   typed failures map to stable API errors: `unconfigured` →
   `webhook_unavailable` 503 (fail closed, tells the operator), missing or
   invalid signature → `invalid_webhook_signature` 401.
2. **Receipt idempotency at the database.** Provider redelivers aggressively;
   every event lands as a receipt row guarded by a unique
   `(provider, event id)` constraint (`webhook_event_receipt`,
   `uq_webhook_event_receipt_provider_event_id` — billing-owned, still
   standing) so replays converge instead of double-applying.
3. **Phase commits before external I/O.** `commit_webhook_phase` commits each
   completed DB phase before taking locks or doing provider I/O, so a crash
   mid-handler never holds observed-state hostage.
4. **Event-ordering floor.** Events at or before the row's
   `provider_observed_at` are ignored (monotonic observation floor); a
   destroyed resource ignores everything except usage-terminal events
   (killed/paused/timeout) so billing can still close.
5. **Subject resolution from provider metadata**, tolerating multiple keys
   (`cloud_sandbox_id`, `proliferate_cloud_sandbox_id`) and treating an
   unparseable id as "not ours", not an error.
