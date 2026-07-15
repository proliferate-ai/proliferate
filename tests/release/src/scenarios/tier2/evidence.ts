/**
 * Tier-2 billing evidence construction (PR 4, BRIEF §2/§4).
 *
 * Pure/bounded builders for `Tier2BillingEvidenceV1`: the in-memory policy
 * recorder + Stripe-id collector, the profile-DB ledger-delta probe, and the
 * final assembler that sorts/dedups/bounds the id arrays. Secret-free by
 * construction. `buildTier2BillingEvidence`'s output is what the report
 * validator (`validateTier2BillingEvidence`, workstream D) later checks.
 */

import type { Tier2BillingEvidenceV1 } from "../../evidence/schema.js";
import type { LedgerProbe, PolicyAsserter, StripeIdCollector } from "./types.js";
import { withDb } from "../../../../intent/stack/billing-env.ts";

const MAX_TIER2_TEST_CLOCK_IDS = 20;
const MAX_TIER2_OBJECT_IDS = 50;

export function createPolicyAsserter(): PolicyAsserter {
  let recorded: Tier2BillingEvidenceV1["asserted_policy"] = {};
  return {
    record(values) {
      recorded = { ...recorded, ...values };
    },
    snapshot() {
      return { ...recorded };
    },
  };
}

export function createStripeIdCollector(): StripeIdCollector {
  const clocks = new Set<string>();
  const objects = new Set<string>();
  return {
    addTestClock: (id) => {
      if (id) clocks.add(id);
    },
    addObject: (id) => {
      if (id) objects.add(id);
    },
    testClockIds: () => [...clocks],
    objectIds: () => [...objects],
  };
}

/** The six billing tables whose per-case row-count deltas the evidence records.
 * Deltas are inserts within a reset window, so each is always `>= 0`. */
const LEDGER_TABLES = {
  grants_delta: "billing_grant",
  seat_adjustments_delta: "billing_seat_adjustment",
  usage_exports_delta: "billing_usage_export",
  llm_events_delta: "agent_llm_usage_event",
  webhook_receipts_delta: "webhook_event_receipt",
  holds_delta: "billing_hold",
} as const;

export type LedgerCounts = Record<keyof typeof LEDGER_TABLES, number>;

/** How the probe reads the six ledger row counts; injectable so the
 * delta/clamp logic is exercised offline with a fake counter (no Postgres). */
export type LedgerRowCounter = (databaseUrl: string) => Promise<LedgerCounts>;

async function countLedgerRows(_databaseUrl: string): Promise<LedgerCounts> {
  return withDb(async (db) => {
    const counts = {} as LedgerCounts;
    for (const [field, table] of Object.entries(LEDGER_TABLES) as [keyof typeof LEDGER_TABLES, string][]) {
      const result = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
      counts[field] = result.rows[0].n as number;
    }
    return counts;
  });
}

/**
 * Profile-DB ledger-delta probe. `databaseUrl` is the booted profile DB (from
 * `BootedStack.databaseUrl`). `withDb` maps the scheme/host exactly as the
 * billing harness does.
 */
export function createLedgerProbe(
  databaseUrl: string,
  countRows: LedgerRowCounter = countLedgerRows,
): LedgerProbe {
  let baseline: LedgerCounts | null = null;
  return {
    async begin() {
      baseline = await countRows(databaseUrl);
    },
    async delta() {
      if (baseline === null) {
        throw new Error("createLedgerProbe: delta() called before begin().");
      }
      const now = await countRows(databaseUrl);
      const out = {} as Tier2BillingEvidenceV1["ledger"];
      for (const field of Object.keys(LEDGER_TABLES) as (keyof typeof LEDGER_TABLES)[]) {
        out[field] = Math.max(now[field] - baseline[field], 0);
      }
      return out;
    },
  };
}

function sortedBoundedUnique(ids: readonly string[], cap: number, label: string): string[] {
  const unique = [...new Set(ids)].sort();
  if (unique.length > cap) {
    throw new Error(`buildTier2BillingEvidence: ${label} exceeds the bounded cap of ${cap} (got ${unique.length}).`);
  }
  return unique;
}

export interface BuildTier2EvidenceArgs {
  manifestId: string;
  serverVersion: string;
  billingMode: Tier2BillingEvidenceV1["billing_mode"];
  policy: PolicyAsserter;
  ids: StripeIdCollector;
  ledger: Tier2BillingEvidenceV1["ledger"];
}

/** Assembles the bounded, secret-free `tier2_billing` evidence for a green cell. */
export function buildTier2BillingEvidence(args: BuildTier2EvidenceArgs): Tier2BillingEvidenceV1 {
  return {
    kind: "tier2_billing",
    manifest_id: args.manifestId,
    server_version: args.serverVersion,
    billing_mode: args.billingMode,
    asserted_policy: args.policy.snapshot(),
    stripe: {
      test_clock_ids: sortedBoundedUnique(args.ids.testClockIds(), MAX_TIER2_TEST_CLOCK_IDS, "stripe.test_clock_ids"),
      object_ids: sortedBoundedUnique(args.ids.objectIds(), MAX_TIER2_OBJECT_IDS, "stripe.object_ids"),
    },
    ledger: args.ledger,
  };
}
