import {
  resolveToggleState,
  type LiveSessionControlDescriptor,
  type SupportedLiveControlKey,
} from "#product/lib/domain/chat/session-controls/session-controls";
import {
  getPendingSessionConfigChange,
  type PendingSessionConfigChanges,
} from "#product/domain/sessions/pending-config";
import type {
  DesktopAgentLaunchControl,
} from "#product/lib/domain/agents/cloud-launch-catalog";

export interface BuildLaunchControlDescriptorsInput {
  selection: { kind: string; modelId: string } | null;
  launchAgents: Array<{
    kind: string;
    launchControls?: DesktopAgentLaunchControl[];
    models: Array<{ id: string }>;
  }>;
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
      onSelect: input.onSelect,
    }));
}

function launchControlToDescriptor(input: {
  agentKind: string;
  control: DesktopAgentLaunchControl;
  pendingConfigChanges: PendingSessionConfigChanges | null;
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
  const rawConfigId = input.control.apply.liveConfigId?.trim();
  if (!rawConfigId) {
    return [];
  }
  const controlValues = input.control.values;
  const pendingChange = getPendingSessionConfigChange(
    input.pendingConfigChanges,
    rawConfigId,
  ) ?? getPendingSessionConfigChange(
    input.pendingConfigChanges,
    key,
  );

  const supports = (value: string | null | undefined): boolean =>
    !!value && controlValues.some((candidate) => candidate.value === value);
  const selectedValue =
    (supports(pendingChange?.value) ? pendingChange?.value : null)
    || (supports(input.control.defaultValue) ? input.control.defaultValue : null)
    || controlValues.find((value) => value.isDefault)?.value
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
  // Post-cutover the projection carries RAW observed control ids (codex
  // `reasoning_effort`, `fast-mode`). The descriptor `key` is presentation
  // identity only — composer promotion (effort stepper, fast-mode toggle) and
  // preference round-trips match on the normalized spelling, while the wire
  // truth stays `rawConfigId`. Map the known raw shapes; an unknown id is
  // preserved because dropping it here would turn a rendering helper into an
  // availability filter.
  switch (key.toLowerCase().replace(/-/g, "_")) {
    case "effort":
    case "reasoning_effort":
      return "effort";
    case "fast_mode":
      return "fast_mode";
    case "collaboration_mode":
      return "collaboration_mode";
    case "mode":
      return "mode";
    case "reasoning":
      return "reasoning";
    default:
      return key as SupportedLiveControlKey;
  }
}
