# Stripe Local Testing

This branch does not route product billing through Stripe yet. Local sandbox
usage truth still lives in the Proliferate database. Stripe test-mode resources
exist so the next external-billing milestone can test checkout, refill, webhook,
and metered-usage flows without inventing IDs by hand.

## Test-Mode Resources

Create or refresh the Stripe test-mode resources:

```bash
node scripts/stripe-setup-test-mode.mjs --write-env-local
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

Once a Stripe webhook endpoint exists in the server, run one of these listeners
while the server is running locally.

Snapshot checkout/subscription/invoice events:

```bash
stripe listen \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed \
  --forward-to localhost:8000/api/v1/billing/webhooks/stripe
```

Thin meter validation events:

```bash
stripe listen \
  --thin-events v1.billing.meter.error_report_triggered,v1.billing.meter.no_meter_found \
  --forward-thin-to localhost:8000/api/v1/billing/webhooks/stripe
```

Use the `whsec_...` printed by `stripe listen` as `STRIPE_WEBHOOK_SECRET` for
that local listener session.

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
