// Billing harness — environment plumbing, HTTP, and Postgres access.
// Split out of billing.ts to keep each module under the repo-shape line cap.
// Published by stack/billing-global-setup.ts.

import { Client } from "pg";

export function apiBaseUrl(): string {
  return required("TIER2_BILLING_API_BASE_URL");
}
export function webBaseUrl(): string {
  return required("TIER2_BILLING_WEB_BASE_URL");
}
export function databaseUrl(): string {
  return required("TIER2_BILLING_DATABASE_URL");
}
export function webhookSecret(): string {
  return required("TIER2_BILLING_STRIPE_WEBHOOK_SECRET");
}
export function stripeSecretKey(): string {
  return required("TIER2_BILLING_STRIPE_SECRET_KEY");
}
export function proMonthlyPriceId(): string {
  return required("TIER2_BILLING_STRIPE_PRO_MONTHLY_PRICE_ID");
}
export function overagePriceId(): string {
  return required("TIER2_BILLING_STRIPE_OVERAGE_PRICE_ID");
}
export function refillPriceId(): string {
  return required("TIER2_BILLING_STRIPE_REFILL_PRICE_ID");
}
export function meterId(): string {
  return process.env.TIER2_BILLING_STRIPE_METER_ID ?? "";
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — did the billing globalSetup run?`);
  }
  return value;
}

// ── HTTP against the booted server ──

export interface ApiResult<T> {
  status: number;
  body: T;
}

export async function apiRequest<T = unknown>(
  urlPath: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`${apiBaseUrl()}${urlPath}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : (undefined as T);
  return { status: response.status, body };
}

/** Shared typed shape for the block-state fields `/billing/overview` and
 * `/billing/cloud-plan` expose (the resume gate's inputs). */
export interface BlockState {
  startBlocked: boolean;
  startBlockReason: string | null;
  activeSpendHold: boolean;
  holdReason: string | null;
  remainingSeconds: number;
}

// ── Postgres (raw seeding + assertion reads) ──
//
// node-postgres needs the plain scheme and chokes on the bracketed `[::1]`
// host the macOS profile default uses; mirror seed.ts's mapping.
function pgUrl(): string {
  return databaseUrl()
    .replace(/^postgresql\+asyncpg:\/\//, "postgresql://")
    .replace("@[::1]:", "@localhost:");
}

export async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: pgUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
