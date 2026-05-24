#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const DEFAULT_EVENT_NAME = "proliferate_managed_cloud_overage_cents";
const DEFAULT_OVERAGE_CENTS_PER_HOUR = 200;

function parseArgs(argv) {
  const args = {
    customer: "",
    seconds: null,
    cents: null,
    eventName: process.env.STRIPE_SANDBOX_METER_EVENT_NAME
      || process.env.STRIPE_MANAGED_CLOUD_OVERAGE_METER_EVENT_NAME
      || DEFAULT_EVENT_NAME,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--customer") {
      args.customer = String(next || "");
      index += 1;
    } else if (arg === "--seconds") {
      args.seconds = Number(next);
      index += 1;
    } else if (arg === "--cents") {
      args.cents = Number(next);
      index += 1;
    } else if (arg === "--event-name") {
      args.eventName = String(next || "");
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage(code) {
  console.log(`Usage:
  node scripts/stripe-send-test-usage.mjs --customer cus_... --seconds 3600
  node scripts/stripe-send-test-usage.mjs --customer cus_... --cents 200

Options:
  --customer    Stripe customer id to receive the meter event.
  --seconds     Managed-cloud seconds to convert into overage cents.
  --cents       Overage cents to send directly.
  --event-name  Stripe meter event name. Defaults to local Proliferate overage meter.
`);
  process.exit(code);
}

function stripeSecretKey() {
  if (process.env.STRIPE_SECRET_KEY) {
    return process.env.STRIPE_SECRET_KEY;
  }
  try {
    const output = execFileSync("stripe", ["config", "--list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = output.match(/^test_mode_api_key\s*=\s*'([^']+)'/m);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function quantityFromArgs(args) {
  if (Number.isFinite(args.cents) && args.cents !== null) {
    return Math.max(0, Math.round(args.cents));
  }
  if (!Number.isFinite(args.seconds) || args.seconds === null) {
    throw new Error("Pass --seconds or --cents.");
  }
  const rate = Number(process.env.PRO_OVERAGE_PRICE_PER_HOUR_CENTS || DEFAULT_OVERAGE_CENTS_PER_HOUR);
  return Math.max(0, Math.round((args.seconds * rate) / 3600));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = stripeSecretKey();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set and the Stripe CLI test key was not found.");
  }
  if (!args.customer) {
    throw new Error("Pass --customer cus_... so the meter event is attached to a test customer.");
  }
  const quantity = quantityFromArgs(args);
  if (quantity <= 0) {
    throw new Error("Usage quantity resolved to 0 cents; pass a larger --seconds value or --cents.");
  }
  const identifier = `local-${Date.now()}-${crypto.randomUUID()}`;
  const body = new URLSearchParams({
    event_name: args.eventName,
    identifier,
    "payload[stripe_customer_id]": args.customer,
    "payload[value]": String(quantity),
  });
  const response = await fetch(`${STRIPE_API_BASE}/billing/meter_events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `local-usage:${identifier}`,
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Stripe meter event failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  console.log(JSON.stringify({
    accepted: true,
    eventName: args.eventName,
    customer: args.customer,
    value: quantity,
    identifier,
    stripe: payload,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
