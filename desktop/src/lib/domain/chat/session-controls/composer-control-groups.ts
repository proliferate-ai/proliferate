import {
  resolveReasoningEffortPresentation,
} from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";
import {
  resolveConfiguredSessionControlValue,
} from "@/lib/domain/chat/session-controls/session-mode-control";
import {
  resolveSessionToggleControlStateIndicator,
} from "@/lib/domain/chat/session-controls/session-toggle-control";
import type {
  LiveSessionControlDescriptor,
  SupportedLiveControlKey,
} from "@/lib/domain/chat/session-controls/session-controls";
import type { ConfiguredSessionControlKey } from "@/lib/domain/chat/session-controls/presentation";

export type ComposerModeControlDescriptor = LiveSessionControlDescriptor & {
  key: ConfiguredSessionControlKey;
};

export interface ComposerSessionControlGroups {
  modeControl: ComposerModeControlDescriptor | null;
  modelConfigControls: LiveSessionControlDescriptor[];
}

const PRIMARY_MODE_KEYS: SupportedLiveControlKey[] = ["collaboration_mode", "mode"];

export function buildComposerSessionControlGroups(
  controls: LiveSessionControlDescriptor[],
): ComposerSessionControlGroups {
  const uniqueControls = uniqueSessionControls(controls);
  const modeControl = resolveComposerModeControl(uniqueControls);

  return {
    modeControl,
    modelConfigControls: uniqueControls.filter((control) => control !== modeControl),
  };
}

export function summarizeComposerModelConfigControls(
  agentKind: string | null,
  controls: LiveSessionControlDescriptor[],
): string | null {
  const labels = controls.flatMap((control) => {
    const selectedOption = control.options.find((option) => option.selected) ?? null;

    if (control.key === "effort") {
      const presentation = resolveReasoningEffortPresentation(
        selectedOption?.value ?? null,
        selectedOption?.label,
      );
      return presentation.shortLabel ? [presentation.shortLabel] : [];
    }

    if (control.key === "fast_mode" || control.key === "reasoning") {
      if (!control.isEnabled) {
        return [];
      }
      return [resolveSessionToggleControlStateIndicator(control.key, true).label];
    }

    if (control.key === "mode" || control.key === "collaboration_mode") {
      const presentation = resolveConfiguredSessionControlValue(
        agentKind,
        control.key,
        selectedOption?.value ?? null,
      );
      return [presentation?.shortLabel ?? selectedOption?.label ?? control.detail].filter(
        (label): label is string => Boolean(label),
      );
    }

    return [selectedOption?.label ?? control.detail].filter(
      (label): label is string => Boolean(label),
    );
  });

  return labels.length > 0 ? labels.slice(0, 3).join(" · ") : null;
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
  for (const key of PRIMARY_MODE_KEYS) {
    const control = controls.find((candidate) => candidate.key === key);
    if (control && hasPlanningModeChoice(control)) {
      return control as ComposerModeControlDescriptor;
    }
  }

  return null;
}

function hasPlanningModeChoice(control: LiveSessionControlDescriptor): boolean {
  const normalizedOptions = control.options.map((option) =>
    `${option.value} ${option.label}`.toLowerCase()
  );
  return control.options.length >= 2
    && normalizedOptions.some((option) => option.includes("plan"));
}
