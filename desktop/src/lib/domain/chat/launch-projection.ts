import type {
  ModelRegistry,
  SessionDefaultControl,
  SessionDefaultControlValue,
  WorkspaceSessionLaunchAgent,
} from "@anyharness/sdk";
import type {
  DefaultLiveSessionControlKey,
  DefaultLiveSessionControlValuesByAgentKind,
} from "@/lib/domain/preferences/user-preferences";
import type { LaunchProjectionControlValues } from "@/stores/chat/launch-projection-override-store";

export type LaunchProjectionSourceKind =
  | "pending-session"
  | "pending-workspace"
  | "configured-default";

export interface LaunchProjectionSelection {
  kind: string;
  modelId: string;
}

export interface LaunchProjectionControl {
  key: DefaultLiveSessionControlKey;
  label: string;
  values: SessionDefaultControlValue[];
  selectedValue: SessionDefaultControlValue;
}

export interface LaunchProjection {
  sourceKind: LaunchProjectionSourceKind;
  scopeId: string;
  agentKind: string;
  modelId: string;
  modeId: string | null;
  controlValues: LaunchProjectionControlValues;
  projectedControls: LaunchProjectionControl[];
}

export interface BuildLaunchProjectionInput {
  sourceKind: LaunchProjectionSourceKind;
  scopeId: string;
  selection: LaunchProjectionSelection | null;
  modeId?: string | null;
  launchAgents: WorkspaceSessionLaunchAgent[];
  modelRegistries: ModelRegistry[];
  storedDefaults: DefaultLiveSessionControlValuesByAgentKind;
  override?: {
    agentKind?: string | null;
    modelId?: string | null;
    modeId?: string | null;
    controlValues?: LaunchProjectionControlValues;
  } | null;
}

const SUPPORTED_PROJECTED_CONTROL_KEYS = new Set<DefaultLiveSessionControlKey>([
  "reasoning",
  "effort",
  "fast_mode",
]);

export function buildLaunchProjection({
  sourceKind,
  scopeId,
  selection,
  modeId,
  launchAgents,
  modelRegistries,
  storedDefaults,
  override,
}: BuildLaunchProjectionInput): LaunchProjection | null {
  const agentKind = override?.agentKind?.trim() || selection?.kind || null;
  if (!agentKind) {
    return null;
  }

  const modelId = override?.modelId?.trim() || selection?.modelId || null;
  if (!modelId) {
    return null;
  }

  const controls = resolveSessionDefaultControls({
    agentKind,
    modelId,
    launchAgents,
    modelRegistries,
  });
  const projectedControls = buildProjectedControls({
    controls,
    storedDefaults: storedDefaults[agentKind] ?? {},
    overrides: override?.controlValues ?? {},
  });
  const controlValues = Object.fromEntries(
    projectedControls.map((control) => [control.key, control.selectedValue.value]),
  ) as LaunchProjectionControlValues;

  return {
    sourceKind,
    scopeId,
    agentKind,
    modelId,
    modeId: override?.modeId !== undefined ? override.modeId : modeId ?? null,
    controlValues,
    projectedControls,
  };
}

function resolveSessionDefaultControls({
  agentKind,
  modelId,
  launchAgents,
  modelRegistries,
}: {
  agentKind: string;
  modelId: string;
  launchAgents: WorkspaceSessionLaunchAgent[];
  modelRegistries: ModelRegistry[];
}): SessionDefaultControl[] {
  const launchModel = launchAgents
    .find((agent) => agent.kind === agentKind)
    ?.models.find((model) => model.id === modelId);
  if ((launchModel?.sessionDefaultControls ?? []).length > 0) {
    return launchModel?.sessionDefaultControls ?? [];
  }

  const registryModel = modelRegistries
    .find((registry) => registry.kind === agentKind)
    ?.models.find((model) =>
      model.id === modelId || (model.aliases ?? []).includes(modelId)
    );
  return registryModel?.sessionDefaultControls ?? [];
}

function buildProjectedControls({
  controls,
  storedDefaults,
  overrides,
}: {
  controls: readonly SessionDefaultControl[];
  storedDefaults: Partial<Record<DefaultLiveSessionControlKey, string>>;
  overrides: LaunchProjectionControlValues;
}): LaunchProjectionControl[] {
  return controls.flatMap((control) => {
    if (!isProjectedControlKey(control.key) || control.values.length === 0) {
      return [];
    }

    const selectedValue = resolveProjectedControlValue({
      control,
      overrideValue: overrides[control.key],
      storedValue: storedDefaults[control.key],
    });
    if (!selectedValue) {
      return [];
    }

    return [{
      key: control.key,
      label: control.label,
      values: control.values,
      selectedValue,
    }];
  });
}

function resolveProjectedControlValue({
  control,
  overrideValue,
  storedValue,
}: {
  control: SessionDefaultControl;
  overrideValue?: string;
  storedValue?: string;
}): SessionDefaultControlValue | null {
  const override = findControlValue(control, overrideValue);
  if (override) {
    return override;
  }

  const stored = findControlValue(control, storedValue);
  if (stored) {
    return stored;
  }

  const defaultValue = findControlValue(control, control.defaultValue ?? undefined);
  if (defaultValue) {
    return defaultValue;
  }

  return control.values.find((value) => value.isDefault)
    ?? control.values[0]
    ?? null;
}

function findControlValue(
  control: SessionDefaultControl,
  value: string | null | undefined,
): SessionDefaultControlValue | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return control.values.find((candidate) => candidate.value === trimmed) ?? null;
}

function isProjectedControlKey(value: string): value is DefaultLiveSessionControlKey {
  return SUPPORTED_PROJECTED_CONTROL_KEYS.has(value as DefaultLiveSessionControlKey);
}
