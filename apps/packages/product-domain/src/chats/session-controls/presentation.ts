export type ConfiguredSessionControlKey = "mode" | "collaboration_mode";

export type SupportedLiveControlKey =
  | ConfiguredSessionControlKey
  | "reasoning"
  | "effort"
  | "fast_mode";

export type SessionControlIconKey =
  | "branch"
  | "build"
  | "chat"
  | "claude"
  | "edit"
  | "gemini"
  | "openai"
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
  icon: SessionControlIconKey;
  isDefault?: boolean;
}

export interface SessionControlPresentation {
  icon: SessionControlIconKey | null;
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
        icon: "chat",
        isDefault: true,
      },
      {
        value: "acceptEdits",
        label: "Accept Edits",
        shortLabel: "Edits",
        description: "Auto-approve file edits.",
        icon: "edit",
      },
      {
        value: "auto",
        label: "Auto",
        shortLabel: "Auto",
        description: "Use a model classifier to approve or deny permission prompts.",
        icon: "sparkles",
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan without execution.",
        icon: "plan",
      },
      {
        value: "dontAsk",
        label: "Don't Ask",
        shortLabel: "Don't Ask",
        description: "Auto-approve most actions.",
        icon: "shieldCheck",
      },
      {
        value: "bypassPermissions",
        label: "Bypass",
        shortLabel: "Bypass",
        description: "Skip permission checks.",
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
        icon: "read",
        isDefault: true,
      },
      {
        value: "auto",
        label: "Auto",
        shortLabel: "Auto",
        description: "Auto-approve standard edits.",
        icon: "edit",
      },
      {
        value: "full-access",
        label: "Full Access",
        shortLabel: "Full Access",
        description: "Allow unrestricted changes.",
        icon: "zap",
      },
    ],
    collaboration_mode: [
      {
        value: "default",
        label: "Default",
        shortLabel: "Default",
        description: "Standard collaboration behavior.",
        icon: "chat",
        isDefault: true,
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan before applying changes.",
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
        icon: "edit",
        isDefault: true,
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan before applying changes.",
        icon: "plan",
      },
      {
        value: "ask",
        label: "Ask",
        shortLabel: "Ask",
        description: "Answer without making changes.",
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
        icon: "chat",
        isDefault: true,
      },
      {
        value: "autoEdit",
        label: "Auto Edit",
        shortLabel: "Auto Edit",
        description: "Auto-approve edits.",
        icon: "edit",
      },
      {
        value: "yolo",
        label: "YOLO",
        shortLabel: "YOLO",
        description: "Skip permission checks.",
        icon: "zap",
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan without execution.",
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
        icon: "opencodeBuild",
        isDefault: true,
      },
      {
        value: "plan",
        label: "Plan",
        shortLabel: "Plan",
        description: "Plan before applying changes.",
        icon: "opencodePlan",
      },
    ],
  },
};

const FALLBACK_PRESENTATION: SessionControlPresentation = {
  icon: null,
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
      shortLabel: configured.shortLabel ?? null,
    }
    : FALLBACK_PRESENTATION;
}

export function inferSessionControlPresentation(value: string): {
  icon: SessionControlIconKey;
} {
  const normalized = value.toLowerCase();
  if (normalized.includes("plan")) {
    return { icon: "plan" };
  }
  if (
    normalized.includes("yolo")
    || normalized.includes("bypass")
    || normalized.includes("full")
  ) {
    return { icon: "zap" };
  }
  if (
    normalized.includes("auto")
    || normalized.includes("agent")
    || normalized.includes("build")
    || normalized.includes("edit")
  ) {
    return { icon: "edit" };
  }
  if (normalized.includes("ask") || normalized.includes("read")) {
    return { icon: "read" };
  }
  return { icon: "read" };
}
