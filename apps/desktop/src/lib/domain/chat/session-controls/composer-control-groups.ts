import type {
  LiveSessionControlDescriptor,
  SupportedLiveControlKey,
} from "@/lib/domain/chat/session-controls/session-controls";
import type { ConfiguredSessionControlKey } from "@/lib/domain/chat/session-controls/presentation";
import type { WorkspaceSurface } from "@anyharness/sdk";

export type ComposerModeControlDescriptor = LiveSessionControlDescriptor & {
  key: ConfiguredSessionControlKey;
};

export interface ComposerSessionControlGroups {
  modeControl: ComposerModeControlDescriptor | null;
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
  const reasoningEffortControl = resolveReasoningEffortControl(uniqueControls);
  const fastModeControl = uniqueControls.find((control) =>
    control.key === "fast_mode" && control.kind === "toggle"
  ) ?? null;
  const promotedControls = new Set<LiveSessionControlDescriptor>([
    ...(modeControl ? [modeControl] : []),
    ...(reasoningEffortControl ? [reasoningEffortControl] : []),
    ...(fastModeControl ? [fastModeControl] : []),
  ]);

  return {
    modeControl,
    reasoningEffortControl,
    fastModeControl,
    overflowControls: uniqueControls.filter((control) => !promotedControls.has(control)),
  };
}

export function filterComposerSessionControlsForSurface(
  controls: LiveSessionControlDescriptor[],
  surface: WorkspaceSurface | null | undefined,
): LiveSessionControlDescriptor[] {
  if (surface !== "cowork") {
    return controls;
  }

  // Cowork owns its access policy, so the raw approval preset remains hidden.
  // Working mode (`collaboration_mode`) and independent tuning dimensions such
  // as reasoning and fast mode still belong in the composer.
  return controls.filter((control) => control.key !== "mode");
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
): ComposerModeControlDescriptor | null {
  const collaborationMode = controls.find((control) =>
    control.key === "collaboration_mode" && control.options.length >= 2
  );
  if (collaborationMode) {
    return collaborationMode as ComposerModeControlDescriptor;
  }

  const legacyMode = controls.find((control) => control.key === "mode");
  if (legacyMode && hasWorkingModeChoice(legacyMode)) {
    return legacyMode as ComposerModeControlDescriptor;
  }

  return null;
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
