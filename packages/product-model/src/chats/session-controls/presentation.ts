export type ConfiguredSessionControlKey = "mode" | "collaboration_mode";

export type SupportedLiveControlKey =
  | ConfiguredSessionControlKey
  | "reasoning"
  | "effort"
  | "fast_mode";

export type SessionControlTone =
  | "neutral"
  | "accent"
  | "primary"
  | "warning"
  | "destructive"
  | "success"
  | "info";

export type SessionControlIconKey =
  | "build"
  | "chat"
  | "claude"
  | "edit"
  | "opencodeBuild"
  | "opencodePlan"
  | "plan"
  | "read"
  | "shieldCheck"
  | "sparkles"
  | "zap";

export interface ConfiguredSessionControlValue {
  value: string;
  label: string;
  shortLabel?: string | null;
  description?: string | null;
  tone: SessionControlTone;
  icon: SessionControlIconKey;
  isDefault?: boolean;
}

export interface SessionControlPresentation {
  icon: SessionControlIconKey | null;
  tone: SessionControlTone;
  shortLabel?: string | null;
}

type ConfiguredSessionControlsByKey = Partial<
  Record<ConfiguredSessionControlKey, ConfiguredSessionControlValue[]>
>;

export interface AgentLaunchControlValue {
  value: string;
  label: string;
  description?: string | null;
  isDefault?: boolean | null;
}

export interface AgentLaunchControlLike {
  key: string;
  values: readonly AgentLaunchControlValue[];
}

export const SESSION_CONTROL_LABELS: Record<SupportedLiveControlKey, string> = {
  collaboration_mode: "Mode",
  mode: "Permissions",
  reasoning: "Reasoning",
  effort: "Reasoning effort",
  fast_mode: "Fast mode",
};

export const SESSION_CONTROL_PRESENTATIONS: Record<string, ConfiguredSessionControlsByKey> = {
  claude: {
    mode: [
      {
        value: "default",
        label: "Default",
        shortLabel: "Default",
        description: "Ask before each action.",
        tone: "info",
        icon: "chat",
        isDefault: true,
      },
      {
        value: "acceptEdits",
        label: "Accept Edits",
        shortLabel: "Edits",
        description: "Auto-approve file edits.",
        tone: "success",
        icon: "edit",
      },
      {
        value: "auto",
        label: "Auto",
        shortLabel: "Auto",
        description: "Use a model classifier to approve or deny permission prompts.",
        tone: "success",
        icon: "sparkles",
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan without execution.",
        tone: "accent",
        icon: "plan",
      },
      {
        value: "dontAsk",
        label: "Don't Ask",
        shortLabel: "Don't Ask",
        description: "Auto-approve most actions.",
        tone: "warning",
        icon: "shieldCheck",
      },
      {
        value: "bypassPermissions",
        label: "Bypass",
        shortLabel: "Bypass",
        description: "Skip permission checks.",
        tone: "destructive",
        icon: "zap",
      },
    ],
  },
  codex: {
    mode: [
      {
        value: "read-only",
        label: "Read Only",
        shortLabel: "Read Only",
        description: "Inspect and plan without editing.",
        tone: "info",
        icon: "read",
        isDefault: true,
      },
      {
        value: "auto",
        label: "Auto",
        shortLabel: "Auto",
        description: "Auto-approve standard edits.",
        tone: "success",
        icon: "edit",
      },
      {
        value: "full-access",
        label: "Full Access",
        shortLabel: "Full Access",
        description: "Allow unrestricted changes.",
        tone: "destructive",
        icon: "zap",
      },
    ],
    collaboration_mode: [
      {
        value: "default",
        label: "Default",
        shortLabel: "Default",
        description: "Standard collaboration behavior.",
        tone: "info",
        icon: "chat",
        isDefault: true,
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan before applying changes.",
        tone: "accent",
        icon: "plan",
      },
    ],
  },
  cursor: {
    mode: [
      {
        value: "agent",
        label: "Agent",
        shortLabel: "Agent",
        description: "Full agent capabilities.",
        tone: "success",
        icon: "edit",
        isDefault: true,
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan before applying changes.",
        tone: "accent",
        icon: "plan",
      },
      {
        value: "ask",
        label: "Ask",
        shortLabel: "Ask",
        description: "Answer without making changes.",
        tone: "info",
        icon: "chat",
      },
    ],
  },
  gemini: {
    mode: [
      {
        value: "default",
        label: "Default",
        shortLabel: "Default",
        description: "Ask before each action.",
        tone: "info",
        icon: "chat",
        isDefault: true,
      },
      {
        value: "autoEdit",
        label: "Auto Edit",
        shortLabel: "Auto Edit",
        description: "Auto-approve edits.",
        tone: "success",
        icon: "edit",
      },
      {
        value: "yolo",
        label: "YOLO",
        shortLabel: "YOLO",
        description: "Skip permission checks.",
        tone: "destructive",
        icon: "zap",
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan without execution.",
        tone: "accent",
        icon: "plan",
      },
    ],
  },
  opencode: {
    mode: [
      {
        value: "build",
        label: "Build",
        shortLabel: "Build",
        description: "Default build mode.",
        tone: "success",
        icon: "opencodeBuild",
        isDefault: true,
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan before applying changes.",
        tone: "accent",
        icon: "opencodePlan",
      },
    ],
  },
};

const FALLBACK_PRESENTATION: SessionControlPresentation = {
  icon: null,
  tone: "neutral",
  shortLabel: null,
};

const EMPTY_CONFIGURED_VALUES: ConfiguredSessionControlValue[] = [];

export function isConfiguredSessionControlKey(
  key: string | null | undefined,
): key is ConfiguredSessionControlKey {
  return key === "mode" || key === "collaboration_mode";
}

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
  control: AgentLaunchControlLike | null | undefined,
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
      label: presentation?.label ?? value.label,
      shortLabel: presentation?.shortLabel ?? value.label,
      description: value.description ?? presentation?.description ?? null,
      tone: presentation?.tone ?? inferred.tone,
      icon: presentation?.icon ?? inferred.icon,
      isDefault: Boolean(value.isDefault),
    };
  });
}

export function resolveSessionControlPresentation(
  agentKind: string | null | undefined,
  controlKey: ConfiguredSessionControlKey,
  value: string | null | undefined,
): SessionControlPresentation {
  const configured = resolveConfiguredSessionControlValue(agentKind, controlKey, value);
  return configured
    ? {
      icon: configured.icon,
      tone: configured.tone,
      shortLabel: configured.shortLabel ?? null,
    }
    : FALLBACK_PRESENTATION;
}

export function inferSessionControlPresentation(value: string): {
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
