import type {
  LiveSessionControlDescriptor,
  SupportedLiveControlKey,
} from "#product/lib/domain/chat/session-controls/session-controls";
import type { ConfiguredSessionControlKey } from "#product/lib/domain/chat/session-controls/presentation";

export type ComposerConfiguredControlDescriptor = LiveSessionControlDescriptor & {
  key: ConfiguredSessionControlKey;
};

export interface ComposerSessionControlGroups {
  modeControl: ComposerConfiguredControlDescriptor | null;
  accessControl: ComposerConfiguredControlDescriptor | null;
  reasoningEffortControl: LiveSessionControlDescriptor | null;
  fastModeControl: LiveSessionControlDescriptor | null;
  overflowControls: LiveSessionControlDescriptor[];
}

const WORKING_MODE_MARKERS = new Set([
  "agent",
  "ask",
  "build",
  "bypass",
  "chat",
  "plan",
]);

export function buildComposerSessionControlGroups(
  controls: LiveSessionControlDescriptor[],
): ComposerSessionControlGroups {
  const uniqueControls = uniqueSessionControls(controls);
  const modeControl = resolveComposerModeControl(uniqueControls);
  const accessControl = resolveComposerAccessControl(uniqueControls, modeControl);
  const reasoningEffortControl = resolveReasoningEffortControl(uniqueControls);
  const fastModeControl = uniqueControls.find((control) =>
    control.key === "fast_mode" && control.kind === "toggle"
  ) ?? null;
  const promotedControls = new Set<LiveSessionControlDescriptor>([
    ...(modeControl ? [modeControl] : []),
    ...(accessControl ? [accessControl] : []),
    ...(reasoningEffortControl ? [reasoningEffortControl] : []),
    ...(fastModeControl ? [fastModeControl] : []),
  ]);

  return {
    modeControl,
    accessControl,
    reasoningEffortControl,
    fastModeControl,
    overflowControls: uniqueControls.filter((control) => !promotedControls.has(control)),
  };
}

export function uniqueSessionControls(
  controls: LiveSessionControlDescriptor[],
): LiveSessionControlDescriptor[] {
  const controlsByKey = new Map<string, LiveSessionControlDescriptor>();
  const orderedKeys: string[] = [];

  for (const control of controls) {
    if (!controlsByKey.has(control.key)) {
      orderedKeys.push(control.key);
    }
    controlsByKey.set(control.key, control);
  }

  return orderedKeys
    .map((key) => controlsByKey.get(key))
    .filter((control): control is LiveSessionControlDescriptor => control !== undefined);
}

function resolveComposerModeControl(
  controls: LiveSessionControlDescriptor[],
): ComposerConfiguredControlDescriptor | null {
  const collaborationMode = controls.find((control) =>
    control.key === "collaboration_mode"
  );
  if (collaborationMode) {
    return collaborationMode as ComposerConfiguredControlDescriptor;
  }

  const legacyMode = controls.find((control) => control.key === "mode");
  if (legacyMode && hasWorkingModeChoice(legacyMode)) {
    return legacyMode as ComposerConfiguredControlDescriptor;
  }

  return null;
}

function resolveComposerAccessControl(
  controls: LiveSessionControlDescriptor[],
  modeControl: ComposerConfiguredControlDescriptor | null,
): ComposerConfiguredControlDescriptor | null {
  const accessControl = controls.find((control) =>
    control.key === "mode" && control !== modeControl
  );
  return accessControl
    ? accessControl as ComposerConfiguredControlDescriptor
    : null;
}

function resolveReasoningEffortControl(
  controls: LiveSessionControlDescriptor[],
): LiveSessionControlDescriptor | null {
  return controls.find((control) => isOrderedReasoningLevelControl(control, "effort"))
    ?? controls.find((control) => isOrderedReasoningLevelControl(control, "reasoning"))
    ?? null;
}

function isOrderedReasoningLevelControl(
  control: LiveSessionControlDescriptor,
  key: SupportedLiveControlKey,
): boolean {
  return control.key === key && control.options.length >= 2;
}

function hasWorkingModeChoice(control: LiveSessionControlDescriptor): boolean {
  return control.options.length >= 2
    && control.options.some((option) =>
      optionTokens(`${option.value} ${option.label}`).some((token) =>
        WORKING_MODE_MARKERS.has(token)
      )
    );
}

function optionTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
