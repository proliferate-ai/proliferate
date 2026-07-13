#!/usr/bin/env python3
"""Mint unique Stripe promotion codes for Proliferate Pro early access.

Each code rides the base coupon (default: ``early_2mo_free`` = 100% off the
first 2 months). One unique, single-use code per person, expiring N days from
creation. Idempotent per email: if a code already exists on the coupon for an
email, it is reused instead of minting a duplicate.

Auth: reads ``STRIPE_API_KEY`` from the environment (use the live secret key,
or a restricted key with promotion_code + coupon read/write).

Usage:
    STRIPE_API_KEY=sk_live_... python server/scripts/mint_pro_promo_codes.py \\
        --person "Alice Example:alice@example.com" \\
        --person "Bob:bob@example.com"

    # from a CSV with "name,email" per line (header optional):
    STRIPE_API_KEY=sk_live_... python server/scripts/mint_pro_promo_codes.py --csv people.csv

    # preview without creating anything:
    STRIPE_API_KEY=sk_live_... python server/scripts/mint_pro_promo_codes.py --person "Cara:cara@x.com" --dry-run

Notes:
    * The default coupon waives 100% for 2 months. Because the Pro seat price and
      the metered overage price live on the same Stripe product, redeemers get
      the seat AND any usage overage free for those 2 months (intended: liberal
      early-access). Change --coupon to use a different policy.
    * Codes are created in whatever mode the key is (live key -> live codes).
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import secrets
import sys
import time
import urllib.parse
import urllib.request

API_ROOT = "https://api.stripe.com/v1"
# Pin a stable API version: the account's default version rejects the bare
# `coupon` param on promotion_codes.create ("Received unknown parameter: coupon").
STRIPE_VERSION = "2024-06-20"
DEFAULT_COUPON = "early_2mo_free"
CODE_PREFIX = "EARLY"
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no ambiguous chars (0/O, 1/I)


def _request(method: str, path: str, key: str, params: dict | None = None) -> dict:
    url = f"{API_ROOT}/{path}"
    data = None
    if method == "GET" and params:
        url += "?" + urllib.parse.urlencode(params)
    elif params:
        data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Stripe-Version", STRIPE_VERSION)
    if data is not None:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = json.loads(exc.read() or b"{}")
        err = body.get("error", {})
        raise RuntimeError(
            f"{exc.code} {err.get('code', '')}: {err.get('message', exc.reason)}"
        ) from None


def slug(name: str, email: str) -> str:
    base = name.strip() or email.split("@", 1)[0]
    base = re.sub(r"[^A-Za-z0-9]", "", base.split()[0] if base.split() else base).upper()
    return (base or "USER")[:10]


def gen_code(name: str, email: str) -> str:
    suffix = "".join(secrets.choice(CODE_ALPHABET) for _ in range(4))
    return f"{CODE_PREFIX}-{slug(name, email)}-{suffix}"


def existing_code_for_email(key: str, coupon: str, email: str) -> str | None:
    """Scan promotion codes on the coupon for one whose metadata.email matches."""
    email = email.lower()
    params = {"coupon": coupon, "limit": 100}
    while True:
        page = _request("GET", "promotion_codes", key, params)
        for pc in page.get("data", []):
            if (pc.get("metadata") or {}).get("email", "").lower() == email:
                return pc["code"]
        if not page.get("has_more"):
            return None
        params["starting_after"] = page["data"][-1]["id"]


def parse_people(args) -> list[tuple[str, str]]:
    people: list[tuple[str, str]] = []
    for entry in args.person or []:
        name, _, email = entry.partition(":")
        if not email:
            sys.exit(f"--person must be 'Name:email', got: {entry!r}")
        people.append((name.strip(), email.strip()))
    if args.csv:
        with open(args.csv, newline="") as fh:
            for row in csv.reader(fh):
                if not row or not row[0].strip():
                    continue
                if "@" not in "".join(row):  # skip header row
                    continue
                if len(row) == 1:
                    name, email = "", row[0]
                else:
                    name, email = row[0], row[1]
                if "@" not in email and "@" in name:  # columns swapped
                    name, email = email, name
                people.append((name.strip(), email.strip()))
    # de-dup by email, keep first
    seen, out = set(), []
    for name, email in people:
        if email.lower() in seen:
            continue
        seen.add(email.lower())
        out.append((name, email))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Mint Pro early-access promo codes.")
    ap.add_argument("--person", action="append", help="'Name:email' (repeatable)")
    ap.add_argument("--csv", help="CSV file with name,email per line")
    ap.add_argument("--coupon", default=os.environ.get("STRIPE_PROMO_COUPON_ID", DEFAULT_COUPON))
    ap.add_argument(
        "--redeem-days", type=int, default=30, help="days until code expires (default 30)"
    )
    ap.add_argument("--dry-run", action="store_true", help="preview without creating codes")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        sys.exit("STRIPE_API_KEY not set")

    people = parse_people(args)
    if not people:
        sys.exit("No people given. Use --person 'Name:email' or --csv file.")

    # validate coupon exists / is usable
    coup = _request("GET", f"coupons/{args.coupon}", key)
    if not coup.get("valid"):
        sys.exit(f"Coupon {args.coupon} is not valid.")
    expires_at = int(time.time()) + args.redeem_days * 86400

    print(
        f"Coupon {args.coupon}: {coup.get('percent_off')}% off, {coup.get('duration')} "
        f"{coup.get('duration_in_months') or ''} | redeem window {args.redeem_days}d"
        f"{'  [DRY-RUN]' if args.dry_run else ''}\n"
    )
    rows = []
    for name, email in people:
        existing = existing_code_for_email(key, args.coupon, email)
        if existing:
            rows.append((name or "-", email, existing, "exists"))
            continue
        code = gen_code(name, email)
        if args.dry_run:
            rows.append((name or "-", email, code, "would create"))
            continue
        params = {
            "coupon": args.coupon,
            "code": code,
            "max_redemptions": 1,
            "expires_at": expires_at,
            "metadata[email]": email,
            "metadata[name]": name,
            "metadata[source]": "mint_pro_promo_codes",
        }
        try:
            pc = _request("POST", "promotion_codes", key, params)
            rows.append((name or "-", email, pc["code"], "created"))
        except RuntimeError as exc:
            rows.append((name or "-", email, code, f"ERROR {exc}"))

    w_name = max(len(r[0]) for r in rows + [("name", "", "", "")])
    w_email = max(len(r[1]) for r in rows + [("", "email", "", "")])
    w_code = max(len(r[2]) for r in rows + [("", "", "code", "")])
    hdr = f"{'NAME':<{w_name}}  {'EMAIL':<{w_email}}  {'CODE':<{w_code}}  STATUS"
    print(hdr)
    print("-" * len(hdr))
    for name, email, code, status in rows:
        print(f"{name:<{w_name}}  {email:<{w_email}}  {code:<{w_code}}  {status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
