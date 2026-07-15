/**
 * Tier-2-on-runner mechanism: the generic matrix-scenario factory (PR 4,
 * BRIEF §1/§4). `makeTier2MatrixScenario(cfg)` returns a
 * `MatrixScenarioDefinition` (lane `local`, no new lane) that boots ONE
 * `BootedStack` via the shared `bootBillingStack()`, runs every authoritative
 * manifest case against it, returns exactly one `ScenarioCellOutcome` per
 * assigned cell (omitted → runner `missing`), and tears the stack down in a
 * `finally`. Green cells carry `tier2_billing` evidence; per-case billing state
 * is reset so ledger deltas are that case's own.
 *
 * The boot/reset/ledger/evidence plumbing is threaded through a
 * `Tier2HarnessDeps` seam (defaulting to the real shared implementations) so
 * the mechanism is exercised offline in `harness.test.ts` with a fake stack —
 * no Server/Postgres/Stripe. This mirrors the `LocalWorldSmokeDriver` seam.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import type {
  MatrixScenarioDefinition,
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioPlanStep,
  ScenarioRunContext,
} from "../types.js";
import type { PlannedCellV1, ResultReasonCode } from "../../runner/result.js";
import type { Tier2BillingEvidenceV1 } from "../../evidence/schema.js";
import type { BootedStack, StripeBillingEnv } from "../../../../intent/stack/boot.ts";
import { REPO_ROOT } from "../../../../intent/stack/boot.ts";
import type { BillingBootOptions, BillingBootResult } from "../../../../intent/stack/billing-boot.ts";
import { bootBillingStack } from "../../../../intent/stack/billing-boot.ts";
import type { BootWithFakeResult } from "../../../../intent/stack/billing-usage-import.ts";
import {
  bootBillingStackWithLitellmFake,
  clearPublishedGatewayEnv,
} from "../../../../intent/stack/billing-usage-import.ts";
import { resetBillingState } from "../../../../intent/stack/billing-seed.ts";
import {
  buildTier2BillingEvidence,
  createLedgerProbe,
  createPolicyAsserter,
  createStripeIdCollector,
  type BuildTier2EvidenceArgs,
} from "./evidence.js";
import type { LedgerProbe, Tier2CellContext, Tier2CellHandler, Tier2ScenarioConfig } from "./types.js";

/** The single matrix dimension carrying the authoritative manifest case id. */
export const TIER2_CASE_DIMENSION = "case";

/**
 * The seam every side-effecting dependency the harness needs is threaded
 * through: the shared stack boot, the per-case billing reset, the profile-DB
 * ledger probe, the (pure) evidence assembler, and the two ambient resolvers.
 * Defaults wire the real shared implementations; offline tests inject fakes so
 * `runCells`/`runTier2Case` run with no Server, Postgres, or Stripe.
 */
export interface Tier2HarnessDeps {
  bootBillingStack: (options?: BillingBootOptions) => Promise<BillingBootResult>;
  /** Gateway+fake boot, used when `cfg.gatewayFake` (T2-BILL). Starts the
   * management-plane LiteLLM fake, boots gateway-enabled + skipFrontend, and
   * publishes the gateway env into this process; the fake is closed at teardown. */
  bootBillingStackWithLitellmFake: () => Promise<BootWithFakeResult>;
  /** Clears the gateway env `bootBillingStackWithLitellmFake` published so a
   * later plain-booted scenario in the same runner does not inherit it. */
  clearPublishedGatewayEnv: () => void;
  resetBillingState: () => Promise<void>;
  createLedgerProbe: (databaseUrl: string) => LedgerProbe;
  buildEvidence: (args: BuildTier2EvidenceArgs) => Tier2BillingEvidenceV1;
  resolveServerVersion: () => string;
  resolveBillingMode: () => Tier2BillingEvidenceV1["billing_mode"];
}

export const DEFAULT_TIER2_HARNESS_DEPS: Tier2HarnessDeps = {
  bootBillingStack,
  bootBillingStackWithLitellmFake,
  clearPublishedGatewayEnv,
  resetBillingState,
  createLedgerProbe,
  buildEvidence: buildTier2BillingEvidence,
  resolveServerVersion,
  resolveBillingMode: billingModeLiteral,
};

/** Normalized boot for one scenario: plain (`bootBillingStack`) or
 * gateway+fake (`bootBillingStackWithLitellmFake`) per `cfg.gatewayFake`. The
 * `teardown` folds stack teardown + (for the fake path) fake close + gateway-env
 * cleanup, so `runCells` has one teardown regardless of boot mode. */
type NormalizedBoot =
  | { skipped: true; reason: string }
  | { skipped: false; stack: BootedStack; stripe: StripeBillingEnv; teardown: () => Promise<void> };

async function bootForScenario(cfg: Tier2ScenarioConfig, deps: Tier2HarnessDeps): Promise<NormalizedBoot> {
  if (cfg.gatewayFake) {
    const boot = await deps.bootBillingStackWithLitellmFake();
    if (boot.skipped) {
      return { skipped: true, reason: boot.reason };
    }
    return {
      skipped: false,
      stack: boot.stack,
      stripe: boot.stripe,
      teardown: async () => {
        await boot.stack.teardown().catch(() => undefined);
        await boot.fake.close().catch(() => undefined);
        deps.clearPublishedGatewayEnv();
      },
    };
  }
  const boot = await deps.bootBillingStack();
  if (boot.skipped) {
    return { skipped: true, reason: boot.reason };
  }
  return {
    skipped: false,
    stack: boot.stack,
    stripe: boot.stripe,
    teardown: () => boot.stack.teardown().catch(() => undefined),
  };
}

export function makeTier2MatrixScenario(
  cfg: Tier2ScenarioConfig,
  deps: Tier2HarnessDeps = DEFAULT_TIER2_HARNESS_DEPS,
): MatrixScenarioDefinition {
  const caseIds = Object.keys(cfg.cases);
  return {
    id: cfg.id,
    kind: "matrix",
    title: cfg.title,
    registryFlowRef: cfg.registryFlowRef,
    lanes: ["local"],
    requiredEnv: cfg.requiredEnv,
    expandCells: (): ScenarioCellSpec[] =>
      caseIds.map((caseId) => ({ dimensions: { [TIER2_CASE_DIMENSION]: caseId } })),
    planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] => {
      const caseId = cell.dimensions[TIER2_CASE_DIMENSION] ?? "?";
      return [
        { description: `[${cell.cell_id}] boot the shared Tier-2 billing stack once (real Server + Stripe test mode)` },
        { description: `[${cell.cell_id}] reset billing state, snapshot ledger baseline for case ${caseId}` },
        { description: `[${cell.cell_id}] run case ${caseId} against the booted stack` },
        { description: `[${cell.cell_id}] on green, record asserted ruled values + ledger deltas + safe Stripe ids` },
        { description: `[${cell.cell_id}] tear the shared stack down` },
      ];
    },
    runCells: async (_ctx: ScenarioRunContext, cells): Promise<ScenarioCellOutcome[]> => {
      const boot = await bootForScenario(cfg, deps);
      if (boot.skipped) {
        // Stripe unresolved (or boot declined): every assigned cell is BLOCKED
        // with a bounded reason — never green, never skip-as-success. A strict
        // run fails closed on this.
        return cells.map((cell) => ({
          cellId: cell.cell_id,
          status: "blocked",
          reason: {
            code: "scenario_blocked",
            message: `Tier-2 billing stack not booted: ${boot.reason}`,
          },
        }));
      }
      const outcomes: ScenarioCellOutcome[] = [];
      try {
        for (const cell of cells) {
          outcomes.push(await runTier2Case(cfg, cell, boot.stack, boot.stripe, deps));
        }
      } finally {
        await boot.teardown();
      }
      return outcomes;
    },
  };
}

/**
 * Runs one manifest case against the shared stack and maps it to exactly one
 * outcome. Exported for the offline harness test (mirrors
 * `runLocalWorldSmokeCell`): a fake `BootedStack` + `deps` drive it with no
 * external process. Any handler throw is caught and normalized to `failed`;
 * evidence is attached only on green.
 */
export async function runTier2Case(
  cfg: Tier2ScenarioConfig,
  cell: PlannedCellV1,
  stack: BootedStack,
  stripe: StripeBillingEnv,
  deps: Tier2HarnessDeps = DEFAULT_TIER2_HARNESS_DEPS,
): Promise<ScenarioCellOutcome> {
  const caseId = cell.dimensions[TIER2_CASE_DIMENSION] ?? "";
  const handler: Tier2CellHandler | undefined = cfg.cases[caseId];
  if (!handler) {
    return {
      cellId: cell.cell_id,
      status: "failed",
      reason: { code: "scenario_failure", message: `no handler registered for Tier-2 case "${caseId}"` },
    };
  }

  const policy = createPolicyAsserter();
  const ids = createStripeIdCollector();
  const ledger = deps.createLedgerProbe(stack.databaseUrl);
  const ctx: Tier2CellContext = {
    stack,
    stripe,
    policy,
    ids,
    ledger,
    reset: () => deps.resetBillingState(),
  };

  try {
    await ctx.reset();
    await ledger.begin();
    const result = await handler(ctx);
    if (result.status !== "green") {
      return {
        cellId: cell.cell_id,
        status: result.status,
        reason: { code: reasonCodeFor(result.status), message: result.reason ?? `case ${caseId} ${result.status}` },
      };
    }
    const evidence = deps.buildEvidence({
      manifestId: caseId,
      serverVersion: deps.resolveServerVersion(),
      billingMode: deps.resolveBillingMode(),
      policy,
      ids,
      ledger: await ledger.delta(),
    });
    return { cellId: cell.cell_id, status: "green", evidence };
  } catch (error) {
    return {
      cellId: cell.cell_id,
      status: "failed",
      reason: { code: "scenario_failure", message: describe(error) },
    };
  }
}

function reasonCodeFor(status: "failed" | "blocked" | "expected_fail"): ResultReasonCode {
  switch (status) {
    case "blocked":
      return "scenario_blocked";
    case "expected_fail":
      return "known_gap";
    default:
      return "scenario_failure";
  }
}

function billingModeLiteral(): Tier2BillingEvidenceV1["billing_mode"] {
  const mode = process.env.TIER2_BILLING_MODE;
  return mode === "observe" || mode === "off" ? mode : "enforce";
}

/** The Server-under-test version (repo VERSION file); a safe token for evidence. */
export function resolveServerVersion(): string {
  return readFileSync(path.join(REPO_ROOT, "VERSION"), "utf8").trim();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
