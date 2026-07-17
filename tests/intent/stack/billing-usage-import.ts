// Real managed-LLM importer driver + LiteLLM-management-fake wiring (PR 4,
// BRIEF §5). The import cell (T2-BILL-15) and the exhaustion cell (T2-BILL-6)
// drive the REAL `run_usage_import` (and real enrollment sync) against the
// management-plane fake instead of direct-SQL seeding `agent_llm_usage_event`,
// so pagination/cursor/overlap/dedup/needs_review/attribution/exhaustion are
// exercised for real, offline and deterministic (no live LiteLLM, no real
// inference call).

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

import { REPO_ROOT, type BootedStack, type StripeBillingEnv } from "./boot.ts";
import { bootBillingStack, type BillingBootResult } from "./billing-boot.ts";
import {
  databaseUrl,
  overagePriceId,
  proMonthlyPriceId,
  refillPriceId,
  stripeSecretKey,
  webhookSecret,
  withDb,
} from "./billing-env.ts";
import { startLitellmManagementFake, type LitellmManagementFake } from "../fakes/litellm-management/server.ts";

export type { FakeMintedKey, FakeSpendRow, LitellmManagementFake } from "../fakes/litellm-management/server.ts";

export interface BillingStackWithFake {
  stack: BootedStack;
  /** The resolved Stripe test-mode env this boot wired (from the inner
   * `bootBillingStack`), so a single-process consumer (the `tests/release`
   * Tier-2 harness) has the same `StripeBillingEnv` the plain boot returns. */
  stripe: StripeBillingEnv;
  fake: LitellmManagementFake;
}

export type BootWithFakeResult =
  | { skipped: true; reason: string }
  | ({ skipped: false } & BillingStackWithFake);

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — did bootBillingStackWithLitellmFake() run?`);
  }
  return value;
}

/** The fake's base URL/master key, published the same way `billing-boot.ts`
 * publishes `TIER2_BILLING_*` — so the out-of-process `serverPass` below (a
 * fresh `python -c` invocation, not a child of the booted server) can read
 * them deterministically instead of relying on the server's own env, which
 * `extraServerEnv` only reaches inside the spawned uvicorn process. */
export function litellmFakeBaseUrl(): string {
  return required("TIER2_BILLING_LITELLM_BASE_URL");
}
export function litellmFakeMasterKey(): string {
  return required("TIER2_BILLING_LITELLM_MASTER_KEY");
}

/** Read the fake's blocked/minted-key state over its `/__test/*` introspection
 * routes (server.ts) — works across process boundaries (globalSetup vs.
 * Playwright worker), unlike calling methods on the in-process
 * `LitellmManagementFake` object returned by `startLitellmManagementFake()`,
 * which only the process that started the fake holds. */
export async function fetchFakeBlockedKeys(): Promise<string[]> {
  const response = await fetch(`${litellmFakeBaseUrl()}/__test/blocked-keys`);
  const body = (await response.json()) as { blockedKeys: string[] };
  return body.blockedKeys;
}

export async function fetchFakeMintedKeys(): Promise<
  Array<{ tokenId: string; keyAlias: string | null; userId: string | null; blocked: boolean; deleted: boolean }>
> {
  const response = await fetch(`${litellmFakeBaseUrl()}/__test/minted-keys`);
  const body = (await response.json()) as {
    mintedKeys: Array<{ tokenId: string; keyAlias: string | null; userId: string | null; blocked: boolean; deleted: boolean }>;
  };
  return body.mintedKeys;
}

/** Seed spend rows on the fake over HTTP is unnecessary — the fake is
 * in-process for whichever code calls `seedSpendRows` directly — but a
 * Playwright spec (a different process than globalSetup) has no handle to
 * that object either. Route seeding through the same `/__test/*` surface for
 * symmetry with the read-back helpers above. */
export async function seedFakeSpendRows(rows: import("../fakes/litellm-management/server.ts").FakeSpendRow[]): Promise<void> {
  const response = await fetch(`${litellmFakeBaseUrl()}/__test/spend-rows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  if (!response.ok) {
    throw new Error(`seeding fake spend rows failed: ${response.status}`);
  }
}

/**
 * Boot the billing stack with the LiteLLM management fake fronting the gateway:
 * starts the fake FIRST, then boots with AGENT_GATEWAY_ENABLED=true and the
 * gateway admin/public base URLs + master key pointed at the fake. The fake must
 * exist before boot because the server reads these at startup. Skips the
 * desktop web/AnyHarness runtime (`skipFrontend`) since every import/exhaustion
 * assertion is API + DB, never UI.
 */
export async function bootBillingStackWithLitellmFake(): Promise<BootWithFakeResult> {
  const fake = await startLitellmManagementFake();
  const boot: BillingBootResult = await bootBillingStack({
    skipFrontend: true,
    extraServerEnv: {
      AGENT_GATEWAY_ENABLED: "true",
      AGENT_GATEWAY_LITELLM_BASE_URL: fake.baseUrl,
      AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: fake.baseUrl,
      AGENT_GATEWAY_LITELLM_MASTER_KEY: fake.masterKey,
    },
  });
  if (boot.skipped) {
    await fake.close();
    return { skipped: true, reason: boot.reason };
  }
  process.env.TIER2_BILLING_LITELLM_BASE_URL = fake.baseUrl;
  process.env.TIER2_BILLING_LITELLM_MASTER_KEY = fake.masterKey;
  // Publish the gateway env into THIS process too, not just the booted server's
  // env. The out-of-process product passes the gateway-dependent cells drive
  // (`billing.ts::serverPass` for the top-up pass, `t2-bill.ts`'s free-credit
  // pass) inherit `...process.env`, and the release harness's `gatewayEnabled()`
  // guard reads `AGENT_GATEWAY_ENABLED` here — so the single-process release
  // runner sees the gateway as enabled exactly as the server does. (The
  // billing-usage-import passes already set these explicitly from
  // `litellmFake*()`; publishing here keeps every inheritor consistent.)
  process.env.AGENT_GATEWAY_ENABLED = "true";
  process.env.AGENT_GATEWAY_LITELLM_BASE_URL = fake.baseUrl;
  process.env.AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL = fake.baseUrl;
  process.env.AGENT_GATEWAY_LITELLM_MASTER_KEY = fake.masterKey;
  return { skipped: false, stack: boot.stack, stripe: boot.stripe, fake };
}

/** Clear the gateway env this module published into `process.env`, so a later
 * scenario booted in the same runner process (e.g. T2-IDENTITY-ORG) does not
 * inherit a stale `AGENT_GATEWAY_ENABLED`. Paired with the fake teardown. */
export function clearPublishedGatewayEnv(): void {
  delete process.env.AGENT_GATEWAY_ENABLED;
  delete process.env.AGENT_GATEWAY_LITELLM_BASE_URL;
  delete process.env.AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL;
  delete process.env.AGENT_GATEWAY_LITELLM_MASTER_KEY;
  delete process.env.TIER2_BILLING_LITELLM_BASE_URL;
  delete process.env.TIER2_BILLING_LITELLM_MASTER_KEY;
}

/** Same out-of-process product-pass mechanism the billing harness uses
 * (`stack/billing.ts::serverPass`), scoped to the LiteLLM importer + fake
 * gateway: a fresh `python -c` process against the same profile DB, with the
 * gateway env pointed at the fake (never the server's own env — this is a
 * separate process, not a child of the booted uvicorn).
 *
 * ASYNC by design: these passes make HTTP calls to the management-plane fake,
 * which — in the single-process `tests/release` runner — is served by THIS
 * process's event loop. A blocking `spawnSync` would freeze that loop while the
 * pass waits on the fake, deadlocking. `spawn` + an awaited exit keeps the loop
 * free to serve the fake. (The Playwright suite runs the fake in a separate
 * globalSetup process, so blocking there was harmless; awaiting is correct for
 * both.) The DB-only passes elsewhere (`billing.ts`, `runFreeCreditGrantPass`)
 * touch no in-process fake, so they stay `spawnSync`. */
function serverPass(pyExpr: string): Promise<void> {
  const child = spawn(path.join(REPO_ROOT, "server", ".venv", "bin", "python"), ["-c", pyExpr], {
    cwd: path.join(REPO_ROOT, "server"),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl(),
      DEBUG: "true",
      PRO_BILLING_ENABLED: "true",
      CLOUD_BILLING_MODE: process.env.TIER2_BILLING_MODE ?? "enforce",
      AGENT_GATEWAY_ENABLED: "true",
      AGENT_GATEWAY_LITELLM_BASE_URL: litellmFakeBaseUrl(),
      AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: litellmFakeBaseUrl(),
      AGENT_GATEWAY_LITELLM_MASTER_KEY: litellmFakeMasterKey(),
      STRIPE_SECRET_KEY: stripeSecretKey(),
      STRIPE_WEBHOOK_SECRET: webhookSecret(),
      STRIPE_PRO_MONTHLY_PRICE_ID: proMonthlyPriceId(),
      STRIPE_CLOUD_MONTHLY_PRICE_ID: proMonthlyPriceId(),
      STRIPE_MANAGED_CLOUD_OVERAGE_PRICE_ID: overagePriceId(),
      STRIPE_SANDBOX_OVERAGE_PRICE_ID: overagePriceId(),
      STRIPE_REFILL_10H_PRICE_ID: refillPriceId(),
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  return new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`usage-import pass failed (${code}): ${(stderr || stdout).trim()}`));
    });
  });
}

/** Drive the REAL importer once against the profile DB + fake gateway.
 * Idempotent/overlap-safe by construction (dedup on `litellm_request_id`);
 * call it as many times as a case needs (restart-safety = calling it twice
 * with no new spend seeded in between and asserting no new rows/duplicates).
 * Await it: it HTTP-calls the in-process fake (see `serverPass`). */
export function runUsageImportPass(): Promise<void> {
  return serverPass(
    // Multi-line: `async def` cannot follow `;`-joined imports on one logical
    // line (SyntaxError), so imports go on their own newline-separated lines.
    "import asyncio\n" +
      "from proliferate.server.cloud.agent_gateway.usage_import import run_usage_import\n" +
      "from proliferate.db import session_ops as db_session\n" +
      "async def _m():\n" +
      "    async with db_session.open_async_transaction() as db:\n" +
      "        result = await run_usage_import(db)\n" +
      "        print(result)\n" +
      "asyncio.run(_m())\n",
  );
}

/** Synchronously enroll + sync every pending/missing subject against the fake
 * gateway (the real `backfill_enrollments` pass — see
 * `server/cloud/agent_gateway/enrollment.py`). Enrollment is normally
 * fire-and-forget on signup (`signup_hook.py`); driving the backfill pass
 * directly gives deterministic, awaitable setup for tests instead of racing
 * a background task. Mints a real virtual key against the fake for every
 * enrollment it processes. */
export function runEnrollmentBackfillPass(limit = 100): Promise<void> {
  return serverPass(
    // Multi-line: `async def` cannot follow `;`-joined imports on one logical
    // line (SyntaxError), so imports go on their own newline-separated lines.
    "import asyncio\n" +
      "from proliferate.server.cloud.agent_gateway.enrollment import backfill_enrollments\n" +
      "from proliferate.db import session_ops as db_session\n" +
      `async def _m():\n` +
      "    async with db_session.open_async_transaction() as db:\n" +
      `        processed = await backfill_enrollments(db, limit=${limit})\n` +
      "        print(f'processed={processed}')\n" +
      "asyncio.run(_m())\n",
  );
}

// ── Assertion reads (agent_gateway_enrollment / agent_llm_usage_event /
// agent_llm_usage_import_cursor / llm_credit_grant) ──

export interface EnrollmentRow {
  id: string;
  virtualKeyId: string | null;
  syncStatus: string;
  budgetStatus: string;
  billingSubjectId: string;
}

export async function getUserEnrollment(userId: string): Promise<EnrollmentRow | null> {
  return withDb(async (db) => {
    const result = await db.query(
      `SELECT id, virtual_key_id, sync_status, budget_status, billing_subject_id
         FROM agent_gateway_enrollment
        WHERE subject_kind = 'user' AND user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      id: row.id,
      virtualKeyId: row.virtual_key_id,
      syncStatus: row.sync_status,
      budgetStatus: row.budget_status,
      billingSubjectId: row.billing_subject_id,
    };
  });
}

export async function getOrgEnrollment(organizationId: string, userId: string): Promise<EnrollmentRow | null> {
  return withDb(async (db) => {
    const result = await db.query(
      `SELECT id, virtual_key_id, sync_status, budget_status, billing_subject_id
         FROM agent_gateway_enrollment
        WHERE subject_kind = 'organization' AND organization_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [organizationId, userId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      id: row.id,
      virtualKeyId: row.virtual_key_id,
      syncStatus: row.sync_status,
      budgetStatus: row.budget_status,
      billingSubjectId: row.billing_subject_id,
    };
  });
}

export interface UsageEventRow {
  litellmRequestId: string;
  userId: string | null;
  organizationId: string | null;
  billingSubjectId: string | null;
  status: string;
  costUsd: number | null;
}

export async function getUsageEvent(litellmRequestId: string): Promise<UsageEventRow | null> {
  return withDb(async (db) => {
    const result = await db.query(
      `SELECT litellm_request_id, user_id, organization_id, billing_subject_id, status, cost_usd
         FROM agent_llm_usage_event WHERE litellm_request_id = $1`,
      [litellmRequestId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      litellmRequestId: row.litellm_request_id,
      userId: row.user_id,
      organizationId: row.organization_id,
      billingSubjectId: row.billing_subject_id,
      status: row.status,
      costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    };
  });
}

export async function countUsageEvents(): Promise<number> {
  return withDb(async (db) => {
    const result = await db.query(`SELECT count(*)::int AS n FROM agent_llm_usage_event`);
    return result.rows[0].n as number;
  });
}

export async function countUsageEventsWithStatus(status: string): Promise<number> {
  return withDb(async (db) => {
    const result = await db.query(`SELECT count(*)::int AS n FROM agent_llm_usage_event WHERE status = $1`, [
      status,
    ]);
    return result.rows[0].n as number;
  });
}

export interface ImportCursorRow {
  lastSeenOccurredAt: string | null;
  status: string;
}

export async function getUsageImportCursor(): Promise<ImportCursorRow | null> {
  return withDb(async (db) => {
    const result = await db.query(
      `SELECT last_seen_occurred_at, status FROM agent_llm_usage_import_cursor WHERE id = 'default'`,
    );
    if (result.rows.length === 0) {
      return null;
    }
    return { lastSeenOccurredAt: result.rows[0].last_seen_occurred_at, status: result.rows[0].status };
  });
}

/** Seed an `llm_credit_grant` row directly (the credit side of the LLM
 * ledger; the importer's exhaustion check reads
 * `get_remaining_credit_usd` = sum(grants) - sum(imported usage)). Used to
 * put a subject at (or near) zero remaining credit before driving the real
 * importer, so the exhaustion path (`disable_virtual_key` -> the fake's
 * `/key/block`) fires for real. */
export async function seedLlmCreditGrant(opts: {
  billingSubjectId: string;
  userId?: string | null;
  source?: "free_signup" | "topup" | "admin" | "seat_pool";
  amountUsd: number;
}): Promise<string> {
  const id = randomUUID();
  await withDb((db) =>
    db.query(
      `INSERT INTO llm_credit_grant (id, billing_subject_id, user_id, source, amount_usd, created_at, expires_at, source_ref)
       VALUES ($1, $2, $3, $4, $5, now(), NULL, $6)`,
      [id, opts.billingSubjectId, opts.userId ?? null, opts.source ?? "admin", opts.amountUsd, `t2billing-import:${id}`],
    ),
  );
  return id;
}
