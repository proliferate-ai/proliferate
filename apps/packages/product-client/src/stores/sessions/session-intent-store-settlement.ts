import {
  applyConfigIntentResolutionPlan,
} from "#product/lib/domain/sessions/creation/config-intent-settlement-state";
import type {
  AdoptedSessionConfigIntentResolutionPlan,
  ConfigIntentSettlementPlan,
} from "#product/lib/domain/sessions/creation/config-intent-settlement";
import {
  useSessionIntentStore,
} from "#product/stores/sessions/session-intent-store";

export function applyConfigIntentSettlement(
  plan: ConfigIntentSettlementPlan,
): void {
  applyConfigIntentResolution(plan);
}

export function applyAdoptedSessionConfigIntentResolution(
  plan: AdoptedSessionConfigIntentResolutionPlan,
): void {
  applyConfigIntentResolution(plan);
}

function applyConfigIntentResolution(
  plan: ConfigIntentSettlementPlan | AdoptedSessionConfigIntentResolutionPlan,
): void {
  if (plan.patches.length === 0) {
    return;
  }
  useSessionIntentStore.getState().settleConfig(
    (state) => applyConfigIntentResolutionPlan(state, plan),
  );
}
