import {
  resolveToggleState,
  type LiveSessionControlDescriptor,
  type SupportedLiveControlKey,
} from "#product/lib/domain/chat/session-controls/session-controls";
import {
  getPendingSessionConfigChange,
  type PendingSessionConfigChanges,
} from "@proliferate/product-domain/sessions/pending-config";
import type {
  DesktopAgentLaunchControl,
  DesktopModelTuningControlValues,
} from "#product/lib/domain/agents/cloud-launch-catalog";

export interface LaunchControlPreferences {
  defaultSessionModeByAgentKind: Record<string, string>;
  defaultLiveSessionControlValuesByAgentKind: Record<string, Partial<Record<string, string>>>;
}

export interface BuildLaunchControlDescriptorsInput {
  selection: { kind: string; modelId: string } | null;
  launchAgents: Array<{
    kind: string;
    launchControls?: DesktopAgentLaunchControl[];
    models: Array<{
      id: string;
      aliases?: string[];
      modeValues?: string[] | null;
      tuningControlValues?: DesktopModelTuningControlValues | null;
    }>;
  }>;
  preferences: LaunchControlPreferences;
  pendingConfigChanges: PendingSessionConfigChanges | null;
  onSelect: (
    agentKind: string,
    controlKey: SupportedLiveControlKey,
    rawConfigId: string,
    value: string,
  ) => void;
}

export function buildLaunchControlDescriptors(
  input: BuildLaunchControlDescriptorsInput,
): LiveSessionControlDescriptor[] {
  if (!input.selection) {
    return [];
  }

  const agent = input.launchAgents.find((candidate) => candidate.kind === input.selection?.kind);
  if (!agent) {
    return [];
  }

  const selectedModelId = input.selection.modelId;
  const selectedModel = agent.models.find((candidate) =>
    candidate.id === selectedModelId || (candidate.aliases ?? []).includes(selectedModelId));
  const selectedModelModeValues = selectedModel?.modeValues ?? null;
  const selectedModelTuningControlValues = selectedModel?.tuningControlValues ?? null;

  return (agent.launchControls ?? [])
    .flatMap((control) => launchControlToDescriptor({
      agentKind: agent.kind,
      control,
      modelModeValues: selectedModelModeValues,
      modelTuningControlValues: selectedModelTuningControlValues,
      pendingConfigChanges: input.pendingConfigChanges,
      preferences: input.preferences,
      onSelect: input.onSelect,
    }));
}

const MODEL_SCOPED_TUNING_KEYS = new Set<SupportedLiveControlKey>([
  "reasoning",
  "effort",
  "fast_mode",
]);

function launchControlToDescriptor(input: {
  agentKind: string;
  control: DesktopAgentLaunchControl;
  modelModeValues?: string[] | null;
  modelTuningControlValues?: DesktopModelTuningControlValues | null;
  pendingConfigChanges: PendingSessionConfigChanges | null;
  preferences: LaunchControlPreferences;
  onSelect: (
    agentKind: string,
    controlKey: SupportedLiveControlKey,
    rawConfigId: string,
    value: string,
  ) => void;
}): LiveSessionControlDescriptor[] {
  const key = normalizeLaunchControlKey(input.control.key);
  if (!key || input.control.values.length === 0) {
    return [];
  }
  // Tuning controls (effort/reasoning/fast_mode) are gated by the selected
  // model's own controls matrix: a model without a matrix entry does not
  // support the control at all (sonnet has no fast_mode), so the agent-level
  // launch control must not render for it.
  const modelTuningValues = MODEL_SCOPED_TUNING_KEYS.has(key) && input.modelTuningControlValues
    ? input.modelTuningControlValues[key as keyof DesktopModelTuningControlValues] ?? null
    : null;
  if (
    MODEL_SCOPED_TUNING_KEYS.has(key)
    && input.modelTuningControlValues
    && (!modelTuningValues || modelTuningValues.length === 0)
  ) {
    return [];
  }
  const rawConfigId = input.control.createField === "modeId" ? "mode" : input.control.key;
  // Scope control values to what the selected model actually supports (the
  // agent-level vocabulary is a superset — e.g. gateway/bedrock models reject
  // `auto`; sonnet's effort caps at `max` while opus adds `xhigh`). Fall back
  // to the full list if scoping would empty it.
  const modelScopedValues = key === "mode" ? input.modelModeValues : modelTuningValues;
  const controlValues = modelScopedValues && modelScopedValues.length > 0
    ? (() => {
      const scoped = input.control.values.filter(
        (value) => modelScopedValues.includes(value.value),
      );
      return scoped.length > 0 ? scoped : input.control.values;
    })()
    : input.control.values;
  const pendingChange = getPendingSessionConfigChange(
    input.pendingConfigChanges,
    rawConfigId,
  );

  // Only honour a stored/default preference if the selected model still
  // supports it, so a persisted `auto` mode or `xhigh` effort doesn't survive
  // onto a model whose scoped vocabulary rejects it.
  const supports = (value: string | null | undefined): boolean =>
    !!value && controlValues.some((candidate) => candidate.value === value);
  const preferredValue = key === "mode"
    ? input.preferences.defaultSessionModeByAgentKind[input.agentKind]
    : input.preferences.defaultLiveSessionControlValuesByAgentKind[input.agentKind]?.[key];
  const selectedValue =
    (supports(pendingChange?.value) ? pendingChange?.value : null)
    || (supports(preferredValue) ? preferredValue : null)
    || (supports(input.control.defaultValue) ? input.control.defaultValue : null)
    || controlValues.find((value) => value.isDefault)?.value
    || controlValues[0]?.value
    || null;
  const detail =
    controlValues.find((value) => value.value === selectedValue)?.label
    ?? selectedValue;

  const descriptorBase = {
    key,
    label: input.control.label,
    detail,
    rawConfigId,
    settable: true,
    pendingState: pendingChange?.status ?? null,
    options: controlValues.map((value) => ({
      value: value.value,
      label: value.label,
      description: value.description,
      selected: value.value === selectedValue,
    })),
    onSelect: (value) => {
      input.onSelect(input.agentKind, key, rawConfigId, value);
    },
  } satisfies Omit<
    LiveSessionControlDescriptor,
    "kind" | "enabledValue" | "disabledValue" | "isEnabled"
  >;

  const toggleState = resolveToggleState({
    key,
    rawConfigId,
    label: input.control.label,
    currentValue: selectedValue,
    settable: true,
    values: controlValues.map((value) => ({
      value: value.value,
      label: value.label,
      description: value.description,
    })),
  }, selectedValue);

  if (toggleState) {
    return [{
      ...descriptorBase,
      kind: "toggle",
      enabledValue: toggleState.enabledValue,
      disabledValue: toggleState.disabledValue,
      isEnabled: toggleState.isEnabled,
    }];
  }

  return [{
    ...descriptorBase,
    kind: "select",
  }];
}

function normalizeLaunchControlKey(
  key: string,
): SupportedLiveControlKey | null {
  if (key === "access_mode") {
    return "mode";
  }
  if (
    key === "mode"
    || key === "collaboration_mode"
    || key === "reasoning"
    || key === "effort"
    || key === "fast_mode"
  ) {
    return key;
  }
  return null;
}
