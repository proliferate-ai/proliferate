import type {
  SessionIntentStateShape,
} from "#product/domain/sessions/intents/session-intent-state";
import type {
  AdoptedSessionConfigIntentResolutionPlan,
  ConfigIntentSettlementPlan,
} from "#product/lib/domain/sessions/creation/config-intent-settlement";

export function applyConfigIntentResolutionPlan<T extends SessionIntentStateShape>(
  state: T,
  plan: ConfigIntentSettlementPlan | AdoptedSessionConfigIntentResolutionPlan,
  now = new Date().toISOString(),
): T {
  let changed = false;
  const entriesById = { ...state.entriesById };
  for (const patch of plan.patches) {
    const intent = entriesById[patch.intentId];
    if (
      !intent
      || intent.kind !== "update_config"
      || intent.generation !== patch.generation
      || intent.status !== "queued"
      || intent.materializedSessionId !== null
    ) {
      continue;
    }
    changed = true;
    entriesById[patch.intentId] = {
      ...intent,
      rawConfigId: patch.rawConfigId,
      status: patch.status,
      errorMessage: patch.status === "failed"
        ? "Launch default was not confirmed by authoritative session config."
        : null,
      updatedAt: now,
      reconciledAt: patch.status === "reconciled" ? now : null,
    };
  }
  return changed ? { ...state, entriesById } : state;
}
