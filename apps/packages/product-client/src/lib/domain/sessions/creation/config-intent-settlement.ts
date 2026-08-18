import type {
  NormalizedSessionControl,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import type {
  DesktopAgentLaunchControl,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import type {
  SessionIntent,
} from "#product/domain/sessions/intents/session-intent-model";

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

export function resolvePreMaterializationConfigIntentControlKeys(input: {
  snapshot: PreMaterializationConfigIntentSnapshot;
  launchControls: readonly Pick<DesktopAgentLaunchControl, "key" | "apply">[];
}): PreMaterializationConfigIntentSnapshot {
  const controlKeyByRawConfigId = new Map<string, string>();
  for (const control of input.launchControls) {
    const rawConfigId = control.apply.liveConfigId?.trim();
    if (rawConfigId) {
      controlKeyByRawConfigId.set(rawConfigId, control.key);
    }
  }
  return input.snapshot.map((entry) => {
    const rawConfigId = entry.rawConfigId?.trim();
    const controlKey = rawConfigId
      ? controlKeyByRawConfigId.get(rawConfigId)
      : undefined;
    return controlKey && controlKey !== entry.controlKey
      ? { ...entry, controlKey }
      : entry;
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

export function rawConfigValuesFromIntentSnapshot(
  snapshot: PreMaterializationConfigIntentSnapshot,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const entry of snapshot) {
    const rawConfigId = entry.rawConfigId?.trim();
    if (rawConfigId) {
      values[rawConfigId] = entry.value;
    }
  }
  return values;
}

export function planCreationConfigIntentSettlement(input: {
  snapshot: PreMaterializationConfigIntentSnapshot;
  liveConfig: SessionLiveConfigSnapshot | null;
}): ConfigIntentSettlementPlan {
  const liveConfig = input.liveConfig;
  if (!liveConfig) {
    return { patches: [] };
  }
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
  for (const entries of entriesByControlKey.values()) {
    const latest = entries[entries.length - 1];
    if (!latest) {
      continue;
    }
    const control = findNormalizedControl(liveConfig, latest);
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
  const liveConfig = input.liveConfig;
  if (!liveConfig) {
    return { patches: [] };
  }
  return {
    patches: input.snapshot.flatMap((entry) => {
      const control = findNormalizedControl(liveConfig, entry);
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

function findNormalizedControl(
  liveConfig: SessionLiveConfigSnapshot,
  identity: Pick<PreMaterializationConfigIntentSnapshotEntry, "controlKey" | "rawConfigId">,
): NormalizedSessionControl | null {
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
  const rawConfigId = identity.rawConfigId?.trim() || null;
  return controls.find((control) => control?.key === identity.controlKey)
    ?? (rawConfigId
      ? controls.find((control) => control?.rawConfigId === rawConfigId)
      : null)
    ?? null;
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
