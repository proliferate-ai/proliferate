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

// Target-observed launch ids and live-session control keys are two spellings
// of the same axis: codex observes `reasoning_effort` / `fast-mode` at launch
// and reports `effort` / `fast_mode` once live. The composer groups controls by
// this key, so an unmapped launch id silently demotes the effort stepper and
// fast-mode toggle into generic overflow chips, and the composer presentation
// flips the moment a session goes live. Only the display key is normalized:
// `rawConfigId` keeps the observed id, which is what every apply path sends.
const LAUNCH_CONTROL_KEY_ALIASES: Record<string, SupportedLiveControlKey> = {
  collaboration_mode: "collaboration_mode",
  effort: "effort",
  fast_mode: "fast_mode",
  mode: "mode",
  reasoning: "reasoning",
  reasoning_effort: "effort",
};

function normalizeLaunchControlKey(
  key: string,
): SupportedLiveControlKey | null {
  const canonical = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!canonical) {
    return null;
  }
  const alias = LAUNCH_CONTROL_KEY_ALIASES[canonical];
  if (alias) {
    return alias;
  }
  // The observed id is executable truth. The type predates arbitrary ACP
  // controls, but dropping an unknown id here would turn a rendering helper
  // into an availability filter. Preserve it until the view-model types are
  // generalized in their owning package.
  return key as SupportedLiveControlKey;
}
