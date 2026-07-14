# Pro early-access promo codes

Status: authoritative for granting free / discounted Proliferate Pro access.

How to give early users and influencers free Pro, using Stripe coupons +
per-person promotion codes. Pro status is derived from the Stripe subscription
(via `checkout.session.completed` / `customer.subscription.*` webhooks), so the
supported path to "free Pro" is a real subscription with a 100%-off coupon —
there is no app-side "make this account Pro" toggle.

## What exists

- **Checked-in default coupon:** the script's `DEFAULT_COUPON` is
  `early_2mo_free`. `STRIPE_PROMO_COUPON_ID` or `--coupon` can select a
  different coupon. This default is a repository value, not evidence that the
  coupon exists or has a particular shape in either Stripe mode.
- **Script** [`server/scripts/mint_pro_promo_codes.py`](../../../server/scripts/mint_pro_promo_codes.py):
  mints one unique, single-use code per person off the coupon.
- Checkout already passes `allow_promotion_codes=true`
  (`server/proliferate/integrations/stripe/client.py`), so codes are
  redeemable in the "Add promotion code" box at upgrade.

## Mint codes

Before creating codes, open the intended Stripe account and explicitly select
test or live mode. Verify that the selected coupon exists in that mode, is
valid, and has the intended percentage, duration, and product/overage effect.
Use a secret key or a restricted key from the same mode with coupon read and
promotion-code read/write access; a dry run validates the coupon and previews
codes but does not replace this mode check.

Read the key silently into a subshell so it is neither written as a literal
shell-history assignment nor retained after the command group exits. The exit
trap clears it on both success and failure:

```bash
(
  set -e
  trap 'unset STRIPE_API_KEY' EXIT
  printf 'Stripe API key: '
  IFS= read -r -s STRIPE_API_KEY
  printf '\n'
  export STRIPE_API_KEY
  COUPON_ID='early_2mo_free' # Change only after verifying the target Stripe mode.

  # Preview the exact people and coupon without creating anything.
  python server/scripts/mint_pro_promo_codes.py \
    --coupon "$COUPON_ID" \
    --csv people.csv \
    --dry-run

  printf 'Type CREATE after checking the coupon and mode: '
  IFS= read -r CONFIRM
  [ "$CONFIRM" = 'CREATE' ]

  python server/scripts/mint_pro_promo_codes.py \
    --coupon "$COUPON_ID" \
    --csv people.csv
)
```

For a small batch, replace `--csv people.csv` in both commands with one or more
`--person "Name:email@example.com"` arguments. Keep a real CSV private and
uncommitted; the script prints names, email addresses, and the generated codes
for the operator to deliver through the approved outreach channel.

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

## Free usage credits (cloud hours)

Separate from plan access. Mechanism exists (`BillingGrant` via
`ensure_billing_grant_record`, grant types in
`server/proliferate/constants/billing.py`) but there is **no** manual/admin path
to comp hours. A comp-hours path needs a script or admin route, likely a new
`comp` grant type wired into `server/proliferate/server/billing/domain/plans.py`.
