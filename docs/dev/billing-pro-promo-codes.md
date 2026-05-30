# Pro early-access promo codes

Status: authoritative for granting free / discounted Proliferate Pro access.

How to give early users and influencers free Pro, using Stripe coupons +
per-person promotion codes. Pro status is derived from the Stripe subscription
(via `checkout.session.completed` / `customer.subscription.*` webhooks), so the
supported path to "free Pro" is a real subscription with a 100%-off coupon —
there is no app-side "make this account Pro" toggle.

## What exists

- **Base coupon `early_2mo_free`** (live): 100% off, `duration=repeating`,
  `duration_in_months=2`. Because the Pro seat price and the metered overage
  price live on the same Stripe product, a redeemer gets the seat **and** any
  usage overage free for those two months (intentional: liberal early access).
- **Script** [`server/scripts/mint_pro_promo_codes.py`](../../server/scripts/mint_pro_promo_codes.py):
  mints one unique, single-use code per person off the coupon.
- Checkout already passes `allow_promotion_codes=true`
  (`server/proliferate/integrations/billing/stripe.py`), so codes are
  redeemable in the "Add promotion code" box at upgrade.

## Mint codes

```bash
# STRIPE_API_KEY = a live secret key, or a restricted key with
# promotion_code write + coupon read. Do not paste keys into chat/commits.
export STRIPE_API_KEY=sk_live_...

# one or more people
python server/scripts/mint_pro_promo_codes.py \
  --person "Alice Example:alice@example.com" \
  --person "Bob:bob@example.com"

# from a CSV (name,email per line)
python server/scripts/mint_pro_promo_codes.py --csv people.csv

# preview without creating anything
python server/scripts/mint_pro_promo_codes.py --person "Cara:cara@x.com" --dry-run
```

Each code: format `EARLY-<NAME>-<rand4>`, `max_redemptions=1`, expires 30 days
out (`--redeem-days` to change), `metadata.email` set for tracking. The script
is **idempotent per email** — if a code already exists on the coupon for an
email it is reused, not duplicated. Output is a `name / email / code / status`
table to hand to outreach.

## Redeeming (what the user does)

1. Click **Upgrade Team**.
2. **Add promotion code** → enter the code → total drops to `$0.00`.
3. Complete checkout (a card may be collected but is not charged during the
   free period). The webhook flips the account to Pro.

## Gotcha: pin the Stripe API version

The account's default API version rejects the bare `coupon` parameter on
`POST /v1/promotion_codes` (`Received unknown parameter: coupon`). The script
pins `Stripe-Version: 2024-06-20`; any manual `curl`/CLI call must send the same
header.

## Other durations

- **Forever free:** create a `percent_off=100, duration=forever` coupon and mint
  codes against it (pass `--coupon <id>`).
- **Direct comp (no checkout):** create a subscription on the user's Stripe
  customer with the coupon applied — fires the same webhooks. Prefer the
  code-redeem path so the user stays in control.

## Free usage credits (cloud hours) — not yet built

Separate from plan access. Mechanism exists (`BillingGrant` via
`ensure_billing_grant_record`, grant types in
`server/proliferate/constants/billing.py`) but there is **no** manual/admin path
to comp hours yet; it needs a small build (script or admin route, likely a new
`comp` grant type wired into `server/proliferate/server/billing/domain/plans.py`).
