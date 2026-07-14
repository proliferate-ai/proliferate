# Stripe webhook failure

Status: authoritative for triaging and recovering Stripe webhook delivery
failures.

Use this runbook when Checkout, subscription, invoice, refill, or payment-hold
state changed in Stripe but Proliferate did not reflect it. Billing behavior is
owned by [`../../codebase/platforms/product/billing.md`](../../codebase/platforms/product/billing.md).
Local webhook setup is owned by
[`../local/stripe-local-testing.md`](../local/stripe-local-testing.md).

## What exists

Stripe webhooks are the supported way to mirror commercial state into
Proliferate. The server verifies the Stripe signature, records idempotency in
`webhook_event_receipt`, and updates billing mirrors such as
`billing_subscription`, `billing_grant`, `billing_hold`, and
`billing_usage_export`.

Handled production billing events are:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

Synthetic `stripe trigger` events prove delivery and signature handling, but
they often lack the configured price, subscription, or customer shape required
to prove account-state side effects. Use real Checkout or real Stripe events
when verifying subscription mirrors, Pro grants, payment holds, and refills.

## Required access

- Stripe Dashboard or Stripe CLI access for the affected account mode.
- Read access to the affected Proliferate database.
- CloudWatch, Sentry, or server log access for the affected environment.
- GitHub Actions and environment-admin access only when deploy-time webhook
  configuration must be repaired.
- AWS ECS/SSM access when hosted runtime secrets or task definitions must be
  inspected or refreshed.

Secrets policy:

- Do not paste `sk_*`, `rk_*`, `whsec_*`, customer PII, card details, signed
  URLs, request bodies, or raw webhook payloads into chat, issues, PRs, or
  docs.
- Share Stripe event ids, customer ids, subscription ids, invoice ids, request
  ids, receipt status, and sanitized log excerpts.

## First response

1. Identify the environment: local, staging, or production. Confirm whether the
   event came from Stripe test mode or live mode.
2. Collect stable ids: Stripe event id, customer id, subscription id, invoice
   id, Checkout session id, Proliferate user id, organization id, and support
   report id if one exists.
3. In Stripe, inspect the event delivery for the Proliferate webhook endpoint.
   Note the HTTP status, last delivery time, and whether Stripe still has
   retries pending.
4. Check Proliferate intake by event id:

   ```sql
   select
     event_id,
     provider,
     event_type,
     status,
     attempt_count,
     received_at,
     processed_at,
     last_error
   from webhook_event_receipt
   where provider = 'stripe'
      and event_id = '<evt_...>'
   order by received_at desc;
   ```

5. Check the affected billing mirror. Start with the Stripe customer or
   subscription id:

   ```sql
   select id, kind, user_id, organization_id, stripe_customer_id
   from billing_subject
   where stripe_customer_id = '<cus_...>';

   select
     status,
     stripe_subscription_id,
     latest_invoice_id,
     latest_invoice_status,
     current_period_start,
     current_period_end,
     seat_quantity,
     updated_at
   from billing_subscription
   where stripe_subscription_id = '<sub_...>'
      or stripe_customer_id = '<cus_...>';

   select grant_type, remaining_seconds, source_ref, created_at
   from billing_grant
   where source_ref in ('<evt_...>', '<invoice-or-session-id>')
   order by created_at desc;

   select kind, status, source, source_ref, created_at, resolved_at
   from billing_hold
   where source_ref in ('<evt_...>', '<invoice-or-subscription-id>')
   order by created_at desc;
   ```

6. Search server logs and Sentry for the Stripe event id and request id. If the
   endpoint returned 5xx, fix the server/deploy incident before replaying.

## Recovery path

Prefer replaying Stripe events over manual database edits. Manual edits need an
incident owner and a follow-up issue because they bypass the idempotent webhook
path.

1. Fix the delivery blocker first:
   - Endpoint down or 5xx: restore the server, confirm `/api/health`, and
     check recent deploys.
   - Signature failure: verify the endpoint belongs to the same Stripe mode and
     environment, then refresh `STRIPE_WEBHOOK_SECRET` in the owning hosted
     secret store. Do not print the secret.
   - Wrong endpoint URL: correct the Stripe endpoint or hosted environment
     config, then confirm new deliveries reach
     `/v1/billing/webhooks/stripe`.
   - Event accepted but ignored: verify the event type and price ids. If the
     event type is unsupported, open a billing issue instead of replaying
     indefinitely.
2. Replay only the missing or failed event ids. Use the Stripe Dashboard resend
   action, or the Stripe CLI equivalent when the endpoint id is known:

   ```bash
   stripe events resend <evt_...> --webhook-endpoint <we_...>
   ```

3. Preserve causal order when replaying multiple events for the same customer:
   checkout or subscription creation before subscription updates, then invoice
   events.
4. Wait for Proliferate processing and re-run the receipt and billing mirror
   queries.
5. If a user is blocked from cloud launch by stale billing state, also inspect
   active holds:

   ```sql
   select kind, status, source, source_ref, created_at
   from billing_hold
   where billing_subject_id = '<billing-subject-id>'
     and status = 'active'
   order by created_at desc;
   ```

## Local recovery

For local profile testing, prefer restarting the Stripe listener rather than
editing `server/.env.local`.

```bash
make dev PROFILE=billing STRIPE=1
```

The profile launcher exports the listener's `STRIPE_WEBHOOK_SECRET` into the
backend process only. If you run the server manually, start the listener
yourself, copy the printed `whsec_...` into local process config, restart the
server, and trigger a test event:

```bash
stripe trigger invoice.payment_failed
```

## Verification

The incident is recovered when all of these are true:

- Stripe shows a successful delivery for the affected event ids.
- `webhook_event_receipt` has one processed receipt per replayed event id.
- `billing_subscription`, `billing_grant`, `billing_hold`, or
  `billing_usage_export` reflects the expected side effect.
- The user's Cloud settings or support-visible billing snapshot matches Stripe.
- Server logs and Sentry no longer show repeated failures for the same event.

## Common failure modes

| Symptom | First response |
| --- | --- |
| Stripe delivery returns 404 | Confirm the endpoint URL includes `/v1/billing/webhooks/stripe` under the API prefix for that environment. |
| Stripe delivery returns 400 signature errors | Verify the endpoint mode and `STRIPE_WEBHOOK_SECRET`; do not reuse a local listener secret in hosted environments. |
| Event receipt exists but no Pro grant appears | Check that the event references configured Cloud Pro or refill price ids; synthetic events may not. |
| Payment failure hold did not clear after payment | Replay or inspect the later `invoice.paid` event for the same customer and subscription. |
| Replayed event is ignored as duplicate | The receipt already processed successfully; inspect mirror rows and open a bug if side effects are still missing. |
| Local listener forwards to the wrong port | Restart with `make dev PROFILE=<name> STRIPE=1` so the profile-specific API port is exported. |

## Final report

Report the environment, Stripe event ids, customer/subscription/invoice ids,
Proliferate user or organization id, receipt status before and after recovery,
which events were replayed, verification query results, and any remaining
owner. State explicitly that no secret values or raw webhook payloads were
shared.
