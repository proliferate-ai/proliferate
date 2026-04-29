# Stripe Local Testing

Local Stripe test mode exercises the Cloud billing loop while keeping runtime
usage truth in the Proliferate database.

Use Stripe locally for commercial IO:

```text
Checkout / portal / refill  -> Stripe test mode
Stripe webhooks             -> local billing mirror, grants, holds
E2B lifecycle/webhooks      -> local UsageSegment ledger
Billing authorization       -> local billing service
Overage export              -> local accounting rows -> Stripe meter events
```

Do not bill directly from E2B webhooks. They update local usage state; the
billing accounting pass exports uncovered usage to Stripe.

## Test-Mode Resources

Create or refresh the Stripe test-mode resources:

```bash
make stripe-setup-test
```

The script is idempotent. It creates these test-mode resources if missing:

- `Proliferate Cloud (Local Test)` product
- $200/month Cloud test price
- `proliferate_sandbox_seconds` billing meter
- $20 per 10-hour overage block test price
- $20 10-hour refill test price

With `--write-env-local`, non-secret IDs are written to `server/.env.local`.
The script never writes `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`.

`make dev` also runs this setup before sourcing `server/.env.local`, so a first
local dev run gets the generated non-secret Stripe IDs in the backend process.
It does not persist Stripe secrets locally.

When launched through `make dev` or `make dev-server`, the backend process reads
the Stripe CLI test-mode key from `stripe config --list` if `STRIPE_SECRET_KEY`
is otherwise unset. The key is exported only into that process environment and
is not written to `server/.env.local`.

For manual server runs outside Make, either export `STRIPE_SECRET_KEY` yourself
or run through `make dev-server`.

## End-To-End Dev Flow

1. Start the full local app:

   ```bash
   make dev
   ```

   This runs migrations, creates/validates Stripe test resources, injects the
   Stripe CLI test key into the backend process, starts a Stripe webhook
   listener, starts the backend, and opens the desktop app.
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

5. Use the refill action from Cloud settings to test one-time refill Checkout.

6. Toggle overage in Cloud settings to test local overage preference storage.

For accounting/export behavior, set billing mode in `server/.env.local`:

```bash
CLOUD_BILLING_MODE=observe
```

Observe mode consumes local grant balances and records observed export rows, but
does not pause sandboxes or send Stripe meter events. To test actual Stripe
meter exports in test mode, use:

```bash
CLOUD_BILLING_MODE=enforce
```

Then restart `make dev`.

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
event_name = proliferate_sandbox_seconds
payload[stripe_customer_id] = cus_...
payload[value] = sandbox seconds
```

Stripe meter aggregation is asynchronous, so summaries and invoice previews may
lag after a hit is accepted.

The overage price must be configured as `$20` per transformed unit with
`transform_quantity.divide_by=36000` and `transform_quantity.round=up`. The
setup script validates this shape so raw second exports cannot accidentally be
priced as raw units.

## Local Webhook Delivery

`make dev` starts a Stripe snapshot-event listener automatically when the Stripe
CLI is installed and authenticated. If Stripe is unavailable, dev continues
without the listener.

When the listener starts, `make dev` exports `STRIPE_WEBHOOK_SECRET` into the
backend process from `stripe listen --print-secret`. The secret is not written
to `server/.env.local`.

The listener forwards checkout/subscription/invoice events to the planned local
Stripe webhook path:

```bash
stripe listen \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed \
  --forward-to http://127.0.0.1:8000/v1/billing/webhooks/stripe
```

The endpoint verifies the Stripe signature before parsing the event and returns
a small acknowledgement with the Stripe event id and event type.

If you are not using `make dev`, start the listener manually:

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
refill price IDs. Use real local Checkout when validating monthly grants,
refills, payment holds, and subscription mirror state.

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
