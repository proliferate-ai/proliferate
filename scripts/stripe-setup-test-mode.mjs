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
const METER_EVENT_NAME = "proliferate_managed_cloud_overage_cents";
const CLOUD_MONTHLY_LOOKUP_KEY = "proliferate_pro_monthly_test";
const SANDBOX_OVERAGE_LOOKUP_KEY = "proliferate_managed_cloud_overage_cent_test";
const REFILL_10H_LOOKUP_KEY = "proliferate_cloud_refill_10h_20usd_test";
const CLOUD_MONTHLY_UNIT_AMOUNT = 2000;
const SANDBOX_OVERAGE_UNIT_AMOUNT = 1;
const REFILL_10H_UNIT_AMOUNT = 2000;
const TEN_SANDBOX_HOURS_SECONDS = 36000;

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
    "Proliferate Managed Cloud Overage Cents (Local Test)",
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

function assertPriceShape(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateMonthlyCloudPrice(price) {
  assertPriceShape(
    price.unit_amount === CLOUD_MONTHLY_UNIT_AMOUNT,
    `Pro monthly price ${price.id} must be $20/user/month.`,
  );
  assertPriceShape(
    price.recurring?.interval === "month",
    `Pro monthly price ${price.id} must recur monthly.`,
  );
}

function validateSandboxOveragePrice(price, meterId) {
  assertPriceShape(
    price.unit_amount === SANDBOX_OVERAGE_UNIT_AMOUNT,
    `Managed cloud overage price ${price.id} must be one cent per unit.`,
  );
  assertPriceShape(
    price.recurring?.usage_type === "metered",
    `Managed cloud overage price ${price.id} must be metered.`,
  );
  assertPriceShape(
    price.recurring?.interval === "month",
    `Managed cloud overage price ${price.id} must recur monthly.`,
  );
  assertPriceShape(
    !price.recurring?.meter || price.recurring.meter === meterId,
    `Managed cloud overage price ${price.id} must point at meter ${meterId}.`,
  );
}

function validateRefillPrice(price) {
  assertPriceShape(
    price.unit_amount === REFILL_10H_UNIT_AMOUNT,
    `Refill price ${price.id} must be $20.`,
  );
  assertPriceShape(
    price.metadata?.proliferate_credit_seconds === `${TEN_SANDBOX_HOURS_SECONDS}`,
    `Refill price ${price.id} must grant ${TEN_SANDBOX_HOURS_SECONDS} seconds.`,
  );
}

function ensureCloudMonthlyPrice(productId) {
  const existing = findPriceByLookupKey(CLOUD_MONTHLY_LOOKUP_KEY);
  if (existing) {
    validateMonthlyCloudPrice(existing);
    return existing;
  }
  const price = runStripe([
    "prices",
    "create",
    "--product",
    productId,
    "--currency",
    "usd",
    "--unit-amount",
    `${CLOUD_MONTHLY_UNIT_AMOUNT}`,
    "--recurring.interval",
    "month",
    "--lookup-key",
    CLOUD_MONTHLY_LOOKUP_KEY,
    "--nickname",
    "Pro monthly seat (local test)",
    "-d",
    "metadata[environment]=local_test",
    "-d",
    "metadata[proliferate_plan]=pro",
  ]);
  validateMonthlyCloudPrice(price);
  return price;
}

function ensureSandboxOveragePrice(productId, meterId) {
  const existing = findPriceByLookupKey(SANDBOX_OVERAGE_LOOKUP_KEY);
  if (existing) {
    validateSandboxOveragePrice(existing, meterId);
    return existing;
  }
  const price = runStripe([
    "prices",
    "create",
    "--product",
    productId,
    "--currency",
    "usd",
    "--unit-amount",
    `${SANDBOX_OVERAGE_UNIT_AMOUNT}`,
    "--recurring.interval",
    "month",
    "--recurring.usage-type",
    "metered",
    "--recurring.meter",
    meterId,
    "--lookup-key",
    SANDBOX_OVERAGE_LOOKUP_KEY,
    "--nickname",
    "Managed cloud overage cent (local test)",
    "-d",
    "metadata[environment]=local_test",
    "-d",
    "metadata[proliferate_usage_unit]=managed_cloud_overage_cent",
  ]);
  validateSandboxOveragePrice(price, meterId);
  return price;
}

function ensureRefillPrice(productId) {
  const existing = findPriceByLookupKey(REFILL_10H_LOOKUP_KEY);
  if (existing) {
    validateRefillPrice(existing);
    return existing;
  }
  const price = runStripe([
    "prices",
    "create",
    "--product",
    productId,
    "--currency",
    "usd",
    "--unit-amount",
    `${REFILL_10H_UNIT_AMOUNT}`,
    "--lookup-key",
    REFILL_10H_LOOKUP_KEY,
    "--nickname",
    "10 sandbox-hour refill (local test)",
    "-d",
    "metadata[environment]=local_test",
    "-d",
    `metadata[proliferate_credit_seconds]=${TEN_SANDBOX_HOURS_SECONDS}`,
  ]);
  validateRefillPrice(price);
  return price;
}

function updateEnvLocal(values) {
  const existing = existsSync(envLocalPath) ? readFileSync(envLocalPath, "utf8") : "";
  const lines = existing.split("\n").filter((line) => line.length > 0);
  const managedKeys = new Set(Object.keys(values));
  const preserved = lines.filter((line) => {
    const key = line.split("=", 1)[0];
    return !managedKeys.has(key);
  });
  const managed = Object.entries(values).map(([key, value]) => {
    const quotedValue = `'${String(value).replaceAll("'", "'\\''")}'`;
    return `${key}=${quotedValue}`;
  });
  writeFileSync(
    envLocalPath,
    `${preserved.concat(managed).join("\n")}\n`,
    { encoding: "utf8" },
  );
}

const product = ensureProduct();
const meter = ensureMeter();
const cloudMonthly = ensureCloudMonthlyPrice(product.id);
const overage = ensureSandboxOveragePrice(product.id, meter.id);
const refill = ensureRefillPrice(product.id);

const envValues = {
  PRO_BILLING_ENABLED: "true",
  STRIPE_PRO_MONTHLY_PRICE_ID: cloudMonthly.id,
  STRIPE_MANAGED_CLOUD_OVERAGE_METER_ID: meter.id,
  STRIPE_MANAGED_CLOUD_OVERAGE_METER_EVENT_NAME: meter.event_name,
  STRIPE_MANAGED_CLOUD_OVERAGE_PRICE_ID: overage.id,
  STRIPE_CLOUD_MONTHLY_PRICE_ID: cloudMonthly.id,
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
    proMonthly: cloudMonthly.id,
    managedCloudOverageCent: overage.id,
    refill10h: refill.id,
  },
  wroteEnvLocal: writeEnvLocal,
  envLocalPath: writeEnvLocal ? envLocalPath : null,
}, null, 2));
