import {
  resolveToggleState,
  type LiveSessionControlDescriptor,
  type SupportedLiveControlKey,
} from "@/lib/domain/chat/session-controls/session-controls";
import {
  getPendingSessionConfigChange,
  type PendingSessionConfigChanges,
} from "@proliferate/product-domain/sessions/pending-config";
import type { DesktopAgentLaunchControl } from "@/lib/domain/agents/cloud-launch-catalog";

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

  return (agent.launchControls ?? [])
    .flatMap((control) => launchControlToDescriptor({
      agentKind: agent.kind,
      control,
      pendingConfigChanges: input.pendingConfigChanges,
      preferences: input.preferences,
      onSelect: input.onSelect,
    }));
}

function launchControlToDescriptor(input: {
  agentKind: string;
  control: DesktopAgentLaunchControl;
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
  const rawConfigId = input.control.createField === "modeId" ? "mode" : input.control.key;
  const pendingChange = getPendingSessionConfigChange(
    input.pendingConfigChanges,
    rawConfigId,
  );

  const selectedValue = key === "mode"
    ? pendingChange?.value
      || input.preferences.defaultSessionModeByAgentKind[input.agentKind]
      || input.control.defaultValue
      || input.control.values.find((value) => value.isDefault)?.value
      || input.control.values[0]?.value
      || null
    : pendingChange?.value
      || input.preferences.defaultLiveSessionControlValuesByAgentKind[input.agentKind]?.[key]
      || input.control.defaultValue
      || input.control.values.find((value) => value.isDefault)?.value
      || input.control.values[0]?.value
      || null;
  const detail =
    input.control.values.find((value) => value.value === selectedValue)?.label
    ?? selectedValue;

  const descriptorBase = {
    key,
    label: input.control.label,
    detail,
    rawConfigId,
    settable: true,
    pendingState: pendingChange?.status ?? null,
    options: input.control.values.map((value) => ({
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
    values: input.control.values.map((value) => ({
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
