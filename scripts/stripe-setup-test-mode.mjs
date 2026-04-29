#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const envLocalPath = path.join(repoRoot, "server", ".env.local");

const WRITE_ENV_FLAG = "--write-env-local";
const writeEnvLocal = process.argv.includes(WRITE_ENV_FLAG);

const PRODUCT_KEY = "proliferate_cloud_local_test";
const METER_EVENT_NAME = "proliferate_sandbox_seconds";

const PRICE_DEFS = [
  {
    envName: "STRIPE_STARTER_MONTHLY_PRICE_ID",
    lookupKey: "proliferate_cloud_starter_monthly_test",
    nickname: "Starter monthly (local test)",
    unitAmount: "100",
    recurringInterval: "month",
    metadata: {
      proliferate_plan: "starter",
      included_sandbox_hours: "20",
    },
  },
  {
    envName: "STRIPE_PRO_MONTHLY_PRICE_ID",
    lookupKey: "proliferate_cloud_pro_monthly_test",
    nickname: "Pro monthly (local test)",
    unitAmount: "1000",
    recurringInterval: "month",
    metadata: {
      proliferate_plan: "pro",
      included_sandbox_hours: "100",
    },
  },
];

function runStripe(args) {
  const out = execFileSync("stripe", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

function listAll(resourceArgs) {
  return runStripe([...resourceArgs, "--limit", "100"]).data ?? [];
}

function ensureProduct() {
  const existing = listAll(["products", "list"]).find(
    (product) => product.metadata?.proliferate_key === PRODUCT_KEY,
  );
  if (existing) {
    return existing;
  }
  return runStripe([
    "products",
    "create",
    "--name",
    "Proliferate Cloud (Local Test)",
    "--description",
    "Test-mode billing resources for local Proliferate development.",
    "-d",
    `metadata[proliferate_key]=${PRODUCT_KEY}`,
    "-d",
    "metadata[environment]=local_test",
  ]);
}

function ensureMeter() {
  const existing = listAll(["billing", "meters", "list"]).find(
    (meter) => meter.event_name === METER_EVENT_NAME,
  );
  if (existing) {
    return existing;
  }
  return runStripe([
    "billing",
    "meters",
    "create",
    "--display-name",
    "Proliferate Sandbox Seconds (Local Test)",
    "--event-name",
    METER_EVENT_NAME,
    "--default-aggregation.formula",
    "sum",
    "--customer-mapping.type",
    "by_id",
    "--customer-mapping.event-payload-key",
    "stripe_customer_id",
    "--value-settings.event-payload-key",
    "value",
  ]);
}

function findPriceByLookupKey(lookupKey) {
  const result = runStripe([
    "prices",
    "list",
    "-d",
    `lookup_keys[]=${lookupKey}`,
    "--limit",
    "1",
  ]);
  return result.data?.[0] ?? null;
}

function ensureRecurringPrice(productId, definition) {
  const existing = findPriceByLookupKey(definition.lookupKey);
  if (existing) {
    return existing;
  }
  const args = [
    "prices",
    "create",
    "--product",
    productId,
    "--currency",
    "usd",
    "--unit-amount",
    definition.unitAmount,
    "--recurring.interval",
    definition.recurringInterval,
    "--lookup-key",
    definition.lookupKey,
    "--nickname",
    definition.nickname,
    "-d",
    "metadata[environment]=local_test",
  ];
  for (const [key, value] of Object.entries(definition.metadata)) {
    args.push("-d", `metadata[${key}]=${value}`);
  }
  return runStripe(args);
}

function ensureSandboxOveragePrice(productId, meterId) {
  const lookupKey = "proliferate_cloud_sandbox_hour_overage_test";
  const existing = findPriceByLookupKey(lookupKey);
  if (existing) {
    return existing;
  }
  return runStripe([
    "prices",
    "create",
    "--product",
    productId,
    "--currency",
    "usd",
    "--unit-amount",
    "1",
    "--recurring.interval",
    "month",
    "--recurring.usage-type",
    "metered",
    "--recurring.meter",
    meterId,
    "--transform-quantity.divide-by",
    "3600",
    "--transform-quantity.round",
    "up",
    "--lookup-key",
    lookupKey,
    "--nickname",
    "Sandbox hour overage (local test)",
    "-d",
    "metadata[environment]=local_test",
    "-d",
    "metadata[proliferate_usage_unit]=sandbox_hour",
  ]);
}

function ensureRefillPrice(productId) {
  const lookupKey = "proliferate_cloud_refill_10h_test";
  const existing = findPriceByLookupKey(lookupKey);
  if (existing) {
    return existing;
  }
  return runStripe([
    "prices",
    "create",
    "--product",
    productId,
    "--currency",
    "usd",
    "--unit-amount",
    "500",
    "--lookup-key",
    lookupKey,
    "--nickname",
    "10 sandbox-hour refill (local test)",
    "-d",
    "metadata[environment]=local_test",
    "-d",
    "metadata[proliferate_credit_seconds]=36000",
  ]);
}

function updateEnvLocal(values) {
  const existing = existsSync(envLocalPath) ? readFileSync(envLocalPath, "utf8") : "";
  const lines = existing.split("\n").filter((line) => line.length > 0);
  const managedKeys = new Set(Object.keys(values));
  const preserved = lines.filter((line) => {
    const key = line.split("=", 1)[0];
    return !managedKeys.has(key);
  });
  const managed = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  writeFileSync(
    envLocalPath,
    `${preserved.concat(managed).join("\n")}\n`,
    { encoding: "utf8" },
  );
}

const product = ensureProduct();
const meter = ensureMeter();
const starter = ensureRecurringPrice(product.id, PRICE_DEFS[0]);
const pro = ensureRecurringPrice(product.id, PRICE_DEFS[1]);
const overage = ensureSandboxOveragePrice(product.id, meter.id);
const refill = ensureRefillPrice(product.id);

const envValues = {
  STRIPE_STARTER_MONTHLY_PRICE_ID: starter.id,
  STRIPE_PRO_MONTHLY_PRICE_ID: pro.id,
  STRIPE_SANDBOX_METER_ID: meter.id,
  STRIPE_SANDBOX_METER_EVENT_NAME: meter.event_name,
  STRIPE_SANDBOX_OVERAGE_PRICE_ID: overage.id,
  STRIPE_REFILL_10H_PRICE_ID: refill.id,
  STRIPE_CHECKOUT_SUCCESS_URL: "http://localhost:1420/settings/cloud?checkout=success",
  STRIPE_CHECKOUT_CANCEL_URL: "http://localhost:1420/settings/cloud?checkout=cancel",
  STRIPE_CUSTOMER_PORTAL_RETURN_URL: "http://localhost:1420/settings/cloud",
};

if (writeEnvLocal) {
  updateEnvLocal(envValues);
}

console.log(JSON.stringify({
  mode: "test",
  product: { id: product.id, name: product.name },
  meter: { id: meter.id, eventName: meter.event_name },
  prices: {
    starterMonthly: starter.id,
    proMonthly: pro.id,
    sandboxHourOverage: overage.id,
    refill10h: refill.id,
  },
  wroteEnvLocal: writeEnvLocal,
  envLocalPath: writeEnvLocal ? envLocalPath : null,
}, null, 2));
