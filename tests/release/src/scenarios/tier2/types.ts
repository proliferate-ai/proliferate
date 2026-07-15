/**
 * Tier-2-on-runner mechanism: shared interfaces (PR 4, BRIEF §1/§4).
 *
 * A Tier-2 domain is a single `MatrixScenarioDefinition` on `runtime_lane:
 * "local"` (no new lane). Its `runCells` boots one `BootedStack` (real Server +
 * Postgres + Redis + real Stripe test mode; AnyHarness/runtime skipped), runs
 * each authoritative manifest case against that one stack, and returns exactly
 * one `ScenarioCellOutcome` per assigned cell — green outcomes carry
 * `tier2_billing` evidence. The generic wiring is `makeTier2MatrixScenario`
 * (`./harness.ts`); a domain supplies only `Tier2ScenarioConfig`.
 *
 * These modules import the ONE shared stack/billing implementation directly
 * from `tests/intent` (BRIEF §0 — cross-package relative import, no relocation).
 */

import type { BootedStack, StripeBillingEnv } from "../../../../intent/stack/boot.ts";
import type { Tier2BillingEvidenceV1 } from "../../evidence/schema.js";

/** A ruled-value assertion recorder: proves the value against the running
 * product AND records it into the cell's `asserted_policy` evidence. */
export interface PolicyAsserter {
  record(values: Tier2BillingEvidenceV1["asserted_policy"]): void;
  snapshot(): Tier2BillingEvidenceV1["asserted_policy"];
}

/** Collects safe Stripe test-mode ids created during a case (for evidence).
 * Sorting/uniqueness/bounding is applied at `buildTier2BillingEvidence`. */
export interface StripeIdCollector {
  addTestClock(id: string): void;
  addObject(id: string): void;
  testClockIds(): string[];
  objectIds(): string[];
}

/** Before/after billing-ledger row-count snapshotter; `delta()` returns the
 * per-case deltas recorded into evidence. Reads the profile DB via the shared
 * `withDb` helper. */
export interface LedgerProbe {
  /** Capture the baseline counts (call after `reset()`, before the case body). */
  begin(): Promise<void>;
  /** Compute deltas against the baseline (call at green). */
  delta(): Promise<Tier2BillingEvidenceV1["ledger"]>;
}

/** Everything a single manifest-case handler needs against the one booted stack. */
export interface Tier2CellContext {
  stack: BootedStack;
  stripe: StripeBillingEnv;
  policy: PolicyAsserter;
  ids: StripeIdCollector;
  ledger: LedgerProbe;
  /** Wipe billing state so this case's ledger deltas are its own. */
  reset(): Promise<void>;
}

export interface Tier2CaseResult {
  status: "green" | "failed" | "blocked" | "expected_fail";
  /** Bounded, evidence-safe reason for a non-green outcome. */
  reason?: string;
}

export type Tier2CellHandler = (ctx: Tier2CellContext) => Promise<Tier2CaseResult>;

export interface Tier2ScenarioConfig {
  /** Scenario id, also the green-evidence gate key: "T2-BILL" | "T2-AUTH-ORG". */
  id: string;
  title: string;
  registryFlowRef: string;
  /** Env-manifest names every case needs (the TIER2_BILLING_* set). */
  requiredEnv: readonly string[];
  /** Financial cases need an sk_test_ Stripe key; unresolved → blocked (never green). */
  requireStripe: boolean;
  /** When true, the ONE shared boot enables the agent gateway and wires the
   * management-plane LiteLLM fake (`bootBillingStackWithLitellmFake`) instead of
   * the plain `bootBillingStack`. T2-BILL needs it: the $5/seat managed-LLM pool
   * grant, LLM exhaustion / auto-top-up, the real `run_usage_import`, and the
   * enrollment/virtual-key path all read `settings.agent_gateway_enabled=true`
   * and talk to the LiteLLM admin plane. The fake is closed at teardown and the
   * published gateway env cleared. Default false (T2-AUTH-ORG boots plain). */
  gatewayFake?: boolean;
  /** Authoritative manifest case id -> handler (e.g. "T2-BILL-2" -> fn). */
  cases: Record<string, Tier2CellHandler>;
}
