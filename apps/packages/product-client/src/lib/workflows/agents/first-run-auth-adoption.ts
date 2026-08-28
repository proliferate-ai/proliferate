import type { AgentSummary } from "@anyharness/sdk";
import type {
  AuthAdoptionAction,
  FirstRunAuthAdoptionInput,
} from "#product/lib/domain/agents/auth-onboarding";
import {
  diagnosticField,
  type RendererDiagnosticField,
  type RendererDiagnosticInput,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { safeRendererErrorName } from "#product/lib/infra/diagnostics/renderer-diagnostic-values";

export type FirstRunAuthAdoptionFailureStage =
  | "runtime_connection"
  | "selections_query"
  | "capabilities_query"
  | "reconcile_query"
  | "reconcile_job"
  | "agent_catalog_query"
  | "planner_import"
  | "planner"
  | "selection_write";

export type FreshAgentCatalogResult =
  | { kind: "success"; agents: AgentSummary[] }
  | { kind: "failure"; error: unknown };

type FirstRunAuthAdoptionPlanner = (
  input: FirstRunAuthAdoptionInput,
) => AuthAdoptionAction[];

export interface FirstRunAuthAdoptionSettlementDeps {
  /**
   * Record the adopted kinds. No settlement TIMESTAMP rides along: the only
   * thing that ever read one was the deleted ~20s onboarding timer, and the card
   * is state-bound (agent_auth §4 cell 4) — nothing here advances on a clock.
   */
  recordAdoption(harnessKinds: readonly string[]): void;
  recordDiagnostic(input: RendererDiagnosticInput): void;
}

export interface RunFirstRunAuthAdoptionDeps
  extends FirstRunAuthAdoptionSettlementDeps {
  readFreshAgents(): Promise<FreshAgentCatalogResult>;
  loadPlanner(): Promise<FirstRunAuthAdoptionPlanner>;
  writeSelection(
    action: AuthAdoptionAction,
    onError: (error: unknown) => void,
  ): void;
}

export interface FirstRunAuthAdoptionFailure {
  stage: FirstRunAuthAdoptionFailureStage;
  error?: unknown;
  harnessKind?: string;
}

function firstRunAdoptionFailureDiagnostic(
  failure: FirstRunAuthAdoptionFailure,
): RendererDiagnosticInput {
  const fields: Record<string, RendererDiagnosticField> = {
    failure_stage: diagnosticField(failure.stage, "operational"),
  };
  if (failure.error !== undefined && failure.error !== null) {
    fields.error_name = diagnosticField(
      safeRendererErrorName(failure.error),
      "operational",
    );
  }
  if (failure.stage === "selection_write" && failure.harnessKind !== undefined) {
    fields.harness_kind = diagnosticField(failure.harnessKind, "operational");
  }
  return {
    name: "renderer.agent_auth.first_run_adoption_failed",
    severity: "warn",
    kind: "message",
    privacy: "operational",
    fields,
    errorClassification: "first_run_adoption_failed",
  };
}

function recordFirstRunAdoptionFailure(
  failure: FirstRunAuthAdoptionFailure,
  recordDiagnostic: FirstRunAuthAdoptionSettlementDeps["recordDiagnostic"],
): void {
  recordDiagnostic(firstRunAdoptionFailureDiagnostic(failure));
}

/** Settle a terminal pre-plan failure before emitting its best-effort diagnostic. */
export function settleFirstRunAuthAdoptionFailure(
  failure: FirstRunAuthAdoptionFailure,
  deps: FirstRunAuthAdoptionSettlementDeps,
): void {
  deps.recordAdoption([]);
  recordFirstRunAdoptionFailure(failure, deps.recordDiagnostic);
}

/**
 * Run the one-shot post-reconcile adoption sequence against a fresh catalog.
 * React, query ownership, and transport construction stay in the lifecycle hook.
 */
export async function runFirstRunAuthAdoption(
  input: Omit<FirstRunAuthAdoptionInput, "agents">,
  deps: RunFirstRunAuthAdoptionDeps,
): Promise<void> {
  let freshCatalog: FreshAgentCatalogResult;
  try {
    freshCatalog = await deps.readFreshAgents();
  } catch (error) {
    settleFirstRunAuthAdoptionFailure(
      { stage: "agent_catalog_query", error },
      deps,
    );
    return;
  }
  if (freshCatalog.kind === "failure") {
    settleFirstRunAuthAdoptionFailure(
      { stage: "agent_catalog_query", error: freshCatalog.error },
      deps,
    );
    return;
  }

  let planner: FirstRunAuthAdoptionPlanner;
  try {
    planner = await deps.loadPlanner();
  } catch (error) {
    settleFirstRunAuthAdoptionFailure({ stage: "planner_import", error }, deps);
    return;
  }

  let actions: AuthAdoptionAction[];
  try {
    actions = planner({
      agents: freshCatalog.agents,
      selectionCount: input.selectionCount,
      gatewayEnabled: input.gatewayEnabled,
    });
  } catch (error) {
    settleFirstRunAuthAdoptionFailure({ stage: "planner", error }, deps);
    return;
  }

  deps.recordAdoption(actions.map((action) => action.harnessKind));
  for (const action of actions) {
    deps.writeSelection(action, (error) => {
      recordFirstRunAdoptionFailure(
        {
          stage: "selection_write",
          error,
          harnessKind: action.harnessKind,
        },
        deps.recordDiagnostic,
      );
    });
  }
}
