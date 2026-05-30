# Stripe Local Testing

Local Stripe test mode exercises the Cloud billing loop while keeping runtime
usage truth in the Proliferate database.

Use Stripe locally for commercial IO:

```text
Checkout / portal / refill  -> Stripe test mode
Stripe webhooks             -> local subscription mirror, Pro grants, refill grants, holds
E2B lifecycle/webhooks      -> local UsageSegment ledger
Billing authorization       -> local billing service
Meter events                -> managed cloud overage cents
```

Do not bill directly from E2B webhooks. They update local usage state; the
billing accounting pass keeps local usage cursors current. With Pro billing
enabled, uncovered managed-cloud usage exports integer cents to Stripe.

## Test-Mode Resources

Create or refresh the Stripe test-mode resources:

```bash
make stripe-setup-test
```

The script is idempotent. It creates these test-mode resources if missing:

- `Proliferate Cloud (Local Test)` product
- $20/user/month Pro test price
- `proliferate_managed_cloud_overage_cents` billing meter
- 1-cent managed-cloud overage meter price
- $20 10-hour refill test price

With `--write-env-local`, non-secret IDs are written to `server/.env.local`.
The script never writes `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`.

Profile-based `make dev PROFILE=<name>` does not run this setup automatically.
Run `make stripe-setup-test` when you need durable local Stripe price and meter
IDs in `server/.env.local`. Profile dev overrides port-specific Stripe redirect
URLs in the backend process environment at launch time.

When launched through `make dev` or `make dev-server`, the backend process reads
the Stripe CLI test-mode key from `stripe config --list` if `STRIPE_SECRET_KEY`
is otherwise unset. The key is exported only into that process environment and
is not written to `server/.env.local`.

For manual server runs outside Make, either export `STRIPE_SECRET_KEY` yourself
or run through `make dev-server`.

## End-To-End Dev Flow

1. Start the full local app with Stripe forwarding enabled:

   ```bash
   make dev PROFILE=billing STRIPE=1
   ```

   This runs migrations for the selected profile database, injects the Stripe
   CLI test key into the backend process, starts a Stripe webhook listener,
   starts the backend, and opens the desktop app.
   `make dev` and `make dev-server` export `DEBUG=true` for the backend process
   so a fresh local worktree does not need a committed production secret file.

2. In the desktop app, open Cloud settings and use the Cloud checkout action.

3. Complete Checkout in the browser with Stripe test card:

   ```text
   4242 4242 4242 4242
   any future expiration
   any CVC
   ```

4. Return focus to the desktop app. The Cloud settings hook refetches billing
   state on focus, and the Stripe listener forwards subscription/invoice
   webhooks to the local backend.

5. Use the billing portal action from Cloud settings to test customer portal
   handoff.

For accounting behavior, set billing mode in `server/.env.local`:

```bash
CLOUD_BILLING_MODE=observe
```

Observe mode consumes local grant balances for finite users and advances usage
cursors, but does not pause sandboxes. To test free-tier enforcement locally,
use:

```bash
CLOUD_BILLING_MODE=enforce
```

Then restart `make dev PROFILE=<name>`.

## Send A Meter Hit

Send one local usage hit into Stripe test mode:

```bash
node scripts/stripe-send-test-usage.mjs --seconds 180
```

To send usage for an existing Stripe customer:

```bash
node scripts/stripe-send-test-usage.mjs --customer cus_... --seconds 3600
```

The meter payload uses:

```text
event_name = proliferate_managed_cloud_overage_cents
payload[stripe_customer_id] = cus_...
payload[value] = overage cents
```

Stripe meter aggregation is asynchronous, so summaries and invoice previews may
lag after a hit is accepted.

The Pro overage price is configured as a metered monthly price at one cent per
unit. The server converts uncovered seconds to whole cents and sends that cents
quantity to Stripe.

## Local Webhook Delivery

`make dev PROFILE=<name>` starts a Stripe snapshot-event listener only when
`STRIPE=1` is set. If Stripe is unavailable, dev continues without the listener.

When the listener starts, `make dev` exports `STRIPE_WEBHOOK_SECRET` into the
backend process from `stripe listen --print-secret`. The secret is not written
to `server/.env.local`.

The listener forwards checkout/subscription/invoice events to the selected
profile API port:

```bash
stripe listen \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed \
  --forward-to http://127.0.0.1:$PROLIFERATE_API_PORT/v1/billing/webhooks/stripe
```

The endpoint verifies the Stripe signature before parsing the event and returns
a small acknowledgement with the Stripe event id and event type.

If you are not using profile-based `make dev`, start the listener manually:

```bash
stripe listen --forward-to http://127.0.0.1:8000/v1/billing/webhooks/stripe
```

Copy the printed `whsec_...` signing secret into `server/.env.local`, restart
the server, then trigger a test event:

```bash
stripe trigger checkout.session.completed
```

Synthetic `stripe trigger` events are useful for signature/ack checks, but most
billing handlers filter invoice/checkout line items by the configured Cloud and
refill price IDs. Use real local Checkout when validating subscription mirror
state, payment holds, and refill grants.

## Useful Local Checks

Verify generated Stripe IDs and shape:

```bash
make stripe-setup-test
```

Verify webhook intake with a synthetic event:

```bash
stripe trigger invoice.payment_failed
```

Inspect local billing tables:

```bash
make db-local
select status, event_type, attempt_count from webhook_event_receipt order by received_at desc limit 10;
select grant_type, remaining_seconds, source_ref from billing_grant order by created_at desc limit 10;
select status, quantity_seconds, error from billing_usage_export order by created_at desc limit 10;
```
