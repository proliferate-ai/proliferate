import type {
  NormalizedSessionControl,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import type {
  SessionIntent,
} from "#product/domain/sessions/intents/session-intent-model";
import type {
  SessionIntentStateShape,
} from "#product/domain/sessions/intents/session-intent-state";

export interface PreMaterializationConfigIntentSnapshotEntry {
  intentId: string;
  generation: number;
  controlKey: string;
  rawConfigId: string | null;
  value: string;
  order: number;
}

export type PreMaterializationConfigIntentSnapshot =
  PreMaterializationConfigIntentSnapshotEntry[];

export interface ConfigIntentSettlementPatch {
  intentId: string;
  generation: number;
  rawConfigId: string | null;
  status: "reconciled" | "stale" | "failed";
}

export interface ConfigIntentSettlementPlan {
  patches: ConfigIntentSettlementPatch[];
}

export interface AdoptedSessionConfigIntentResolutionPatch {
  intentId: string;
  generation: number;
  rawConfigId: string | null;
  status: "queued" | "stale";
}

export interface AdoptedSessionConfigIntentResolutionPlan {
  patches: AdoptedSessionConfigIntentResolutionPatch[];
}

export function snapshotPreMaterializationConfigIntents(
  intents: readonly SessionIntent[],
): PreMaterializationConfigIntentSnapshot {
  return intents.flatMap((intent, order) => {
    if (
      intent.kind !== "update_config"
      || intent.status !== "queued"
      || intent.materializedSessionId !== null
    ) {
      return [];
    }
    return [{
      intentId: intent.intentId,
      generation: intent.generation,
      controlKey: intent.controlKey,
      rawConfigId: intent.rawConfigId,
      value: intent.value,
      order,
    }];
  });
}

export function configValuesFromIntentSnapshot(
  snapshot: PreMaterializationConfigIntentSnapshot,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const entry of snapshot) {
    values[entry.controlKey] = entry.value;
  }
  return values;
}

export function planCreationConfigIntentSettlement(input: {
  snapshot: PreMaterializationConfigIntentSnapshot;
  liveConfig: SessionLiveConfigSnapshot | null;
}): ConfigIntentSettlementPlan {
  const entriesByControlKey = new Map<
    string,
    PreMaterializationConfigIntentSnapshotEntry[]
  >();
  for (const entry of input.snapshot) {
    const entries = entriesByControlKey.get(entry.controlKey) ?? [];
    entries.push(entry);
    entriesByControlKey.set(entry.controlKey, entries);
  }

  const patches: Array<ConfigIntentSettlementPatch & { order: number }> = [];
  for (const [controlKey, entries] of entriesByControlKey) {
    const latest = entries[entries.length - 1];
    if (!latest) {
      continue;
    }
    const control = findNormalizedControlBySemanticKey(input.liveConfig, controlKey);
    const rawConfigId = control?.rawConfigId?.trim() || null;
    const applicable = isApplicableControlValue(control, latest.value);
    for (const entry of entries) {
      patches.push({
        intentId: entry.intentId,
        generation: entry.generation,
        rawConfigId,
        status: !applicable
          ? "stale"
          : entry.intentId !== latest.intentId
            ? "stale"
            : control.currentValue === latest.value
              ? "reconciled"
              : "failed",
        order: entry.order,
      });
    }
  }

  patches.sort((left, right) => left.order - right.order);
  return {
    patches: patches.map(({ order: _order, ...patch }) => patch),
  };
}

export function planAdoptedSessionConfigIntentResolution(input: {
  snapshot: PreMaterializationConfigIntentSnapshot;
  liveConfig: SessionLiveConfigSnapshot | null;
}): AdoptedSessionConfigIntentResolutionPlan {
  return {
    patches: input.snapshot.flatMap((entry) => {
      const control = findNormalizedControlBySemanticKey(
        input.liveConfig,
        entry.controlKey,
      );
      const rawConfigId = control?.rawConfigId?.trim() || null;
      return [{
        intentId: entry.intentId,
        generation: entry.generation,
        rawConfigId,
        status: isApplicableControlValue(control, entry.value)
          ? "queued" as const
          : "stale" as const,
      }];
    }),
  };
}

export function applyConfigIntentSettlementPlan(
  state: SessionIntentStateShape,
  plan: ConfigIntentSettlementPlan,
  now = new Date().toISOString(),
): SessionIntentStateShape {
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

export function applyAdoptedSessionConfigIntentResolutionPlan(
  state: SessionIntentStateShape,
  plan: AdoptedSessionConfigIntentResolutionPlan,
  now = new Date().toISOString(),
): SessionIntentStateShape {
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
      errorMessage: null,
      updatedAt: now,
    };
  }
  return changed ? { ...state, entriesById } : state;
}

function findNormalizedControlBySemanticKey(
  liveConfig: SessionLiveConfigSnapshot | null,
  controlKey: string,
): NormalizedSessionControl | null {
  if (!liveConfig) {
    return null;
  }
  const normalized = liveConfig.normalizedControls;
  const controls: Array<NormalizedSessionControl | null | undefined> = [
    normalized.model,
    normalized.collaborationMode,
    normalized.mode,
    normalized.reasoning,
    normalized.effort,
    normalized.fastMode,
    ...normalized.extras,
  ];
  return controls.find((control) => control?.key === controlKey) ?? null;
}

function isApplicableControlValue(
  control: NormalizedSessionControl | null,
  value: string,
): control is NormalizedSessionControl {
  return Boolean(
    control?.settable
    && control.rawConfigId.trim()
    && control.values.some((candidate) => candidate.value === value),
  );
}
