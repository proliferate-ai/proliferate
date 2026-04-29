# Stripe Local Testing

This branch does not route product billing through Stripe yet. Local sandbox
usage truth still lives in the Proliferate database. Stripe test-mode resources
exist so the next external-billing milestone can test checkout, refill, webhook,
and metered-usage flows without inventing IDs by hand.

## Test-Mode Resources

Create or refresh the Stripe test-mode resources:

```bash
make stripe-setup-test
```

The script is idempotent. It creates these test-mode resources if missing:

- `Proliferate Cloud (Local Test)` product
- Starter monthly test price
- Pro monthly test price
- `proliferate_sandbox_seconds` billing meter
- sandbox-hour overage test price
- 10-hour refill test price

With `--write-env-local`, non-secret IDs are written to `server/.env.local`.
The script never writes `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`.

`make dev` also runs this setup before sourcing `server/.env.local`, so a first
local dev run gets the generated non-secret Stripe IDs in the backend process.
It does not persist Stripe secrets locally.

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
  --forward-to localhost:8000/api/v1/billing/webhooks/stripe
```

Until the webhook endpoint is implemented, forwarded deliveries may return 404
locally; the listener is present so the dev path is already wired for the
external-billing milestone.

## Local Mental Model

Use Stripe locally for external billing IO:

```text
Checkout / portal / payment webhooks -> future Stripe webhook endpoint
Meter event API calls              -> Stripe test-mode meter aggregation
E2B lifecycle/webhooks             -> local UsageSegment ledger
Billing authorization              -> local billing service
```

Do not bill directly from E2B webhooks. They update local usage state; a future
export worker should turn closed or chunked usage into idempotent Stripe meter
events.
