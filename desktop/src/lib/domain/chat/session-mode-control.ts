import {
  SESSION_CONTROL_PRESENTATIONS,
  type ConfiguredSessionControlKey,
  type ConfiguredSessionControlValue,
  type SessionControlIconKey,
  type SessionControlTone,
} from "@/config/session-control-presentations";
import type { WorkspaceSessionLaunchControl } from "@anyharness/sdk";

export type SessionModeTone = SessionControlTone;
export type SessionModeIconKey = SessionControlIconKey;

export interface SessionModePresentation {
  icon: SessionModeIconKey | null;
  tone: SessionModeTone;
  shortLabel?: string | null;
}

const FALLBACK_PRESENTATION: SessionModePresentation = {
  icon: null,
  tone: "neutral",
  shortLabel: null,
};

const EMPTY_CONFIGURED_VALUES: ConfiguredSessionControlValue[] = [];

export function listConfiguredSessionControlValues(
  agentKind: string | null | undefined,
  controlKey: ConfiguredSessionControlKey,
): ConfiguredSessionControlValue[] {
  if (!agentKind) {
    return EMPTY_CONFIGURED_VALUES;
  }

  return SESSION_CONTROL_PRESENTATIONS[agentKind]?.[controlKey] ?? EMPTY_CONFIGURED_VALUES;
}

export function resolveConfiguredSessionControlValue(
  agentKind: string | null | undefined,
  controlKey: ConfiguredSessionControlKey,
  value: string | null | undefined,
): ConfiguredSessionControlValue | null {
  if (!value) {
    return null;
  }

  return listConfiguredSessionControlValues(agentKind, controlKey).find(
    (candidate) => candidate.value === value,
  ) ?? null;
}

export function resolveEffectiveConfiguredSessionControlValue(
  agentKind: string | null | undefined,
  controlKey: ConfiguredSessionControlKey,
  preferredValue: string | null | undefined,
): ConfiguredSessionControlValue | null {
  const exactMatch = resolveConfiguredSessionControlValue(agentKind, controlKey, preferredValue);
  if (exactMatch) {
    return exactMatch;
  }

  const configuredValues = listConfiguredSessionControlValues(agentKind, controlKey);
  return configuredValues.find((candidate) => candidate.isDefault)
    ?? configuredValues[0]
    ?? null;
}

export function launchControlToConfiguredSessionControlValues(
  agentKind: string | null | undefined,
  control: WorkspaceSessionLaunchControl | null | undefined,
): ConfiguredSessionControlValue[] {
  if (!agentKind || !control || !isConfiguredSessionControlKey(control.key)) {
    return EMPTY_CONFIGURED_VALUES;
  }

  const presentations = listConfiguredSessionControlValues(agentKind, control.key);
  return control.values.map((value) => {
    const presentation = presentations.find((candidate) => candidate.value === value.value);
    const inferred = inferSessionControlPresentation(value.value);
    return {
      value: value.value,
      label: value.label,
      shortLabel: presentation?.shortLabel ?? value.label,
      description: value.description ?? presentation?.description ?? null,
      tone: presentation?.tone ?? inferred.tone,
      icon: presentation?.icon ?? inferred.icon,
      isDefault: value.isDefault,
    };
  });
}

export function withUpdatedDefaultSessionModeByAgentKind(
  defaultsByAgentKind: Record<string, string>,
  agentKind: string,
  modeId: string | null | undefined,
): Record<string, string> {
  const trimmedAgentKind = agentKind.trim();
  const trimmedModeId = modeId?.trim() ?? "";
  if (!trimmedAgentKind || !trimmedModeId) {
    return defaultsByAgentKind;
  }

  if (defaultsByAgentKind[trimmedAgentKind] === trimmedModeId) {
    return defaultsByAgentKind;
  }

  return {
    ...defaultsByAgentKind,
    [trimmedAgentKind]: trimmedModeId,
  };
}

export function resolveSessionControlPresentation(
  agentKind: string | null | undefined,
  controlKey: ConfiguredSessionControlKey,
  value: string | null | undefined,
): SessionModePresentation {
  const configured = resolveConfiguredSessionControlValue(agentKind, controlKey, value);
  return configured
    ? {
      icon: configured.icon,
      tone: configured.tone,
      shortLabel: configured.shortLabel ?? null,
    }
    : FALLBACK_PRESENTATION;
}

export function getPreviousSessionModeValue(
  options: Array<{ value: string }>,
  currentValue: string | null,
): string | null {
  if (options.length < 2) {
    return null;
  }

  const currentIndex = options.findIndex((option) => option.value === currentValue);
  if (currentIndex <= 0) {
    return options[options.length - 1]?.value ?? null;
  }

  return options[currentIndex - 1]?.value ?? null;
}

function isConfiguredSessionControlKey(
  key: WorkspaceSessionLaunchControl["key"],
): key is ConfiguredSessionControlKey {
  return key === "mode" || key === "collaboration_mode";
}

function inferSessionControlPresentation(value: string): {
  tone: SessionControlTone;
  icon: SessionControlIconKey;
} {
  const normalized = value.toLowerCase();
  if (normalized.includes("plan")) {
    return { tone: "accent", icon: "plan" };
  }
  if (
    normalized.includes("yolo")
    || normalized.includes("bypass")
    || normalized.includes("full")
  ) {
    return { tone: "destructive", icon: "zap" };
  }
  if (
    normalized.includes("auto")
    || normalized.includes("agent")
    || normalized.includes("build")
    || normalized.includes("edit")
  ) {
    return { tone: "success", icon: "edit" };
  }
  if (normalized.includes("ask") || normalized.includes("read")) {
    return { tone: "info", icon: "read" };
  }
  return { tone: "neutral", icon: "read" };
}
