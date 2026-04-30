import type { ConfiguredSessionControlValue } from "@/config/session-control-presentations";
import {
  listConfiguredSessionControlValues,
  resolveConfiguredSessionControlValue,
} from "@/lib/domain/chat/session-mode-control";

export interface AutomationModePreferences {
  defaultSessionModeByAgentKind: Record<string, string>;
}

export interface AutomationModeOverride {
  modeId: string | null;
}

export type AutomationModeResolution =
  | {
    state: "selected";
    source: "saved" | "override";
    value: ConfiguredSessionControlValue;
    submission: { modeId: string; canSubmit: true };
  }
  | {
    state: "default";
    source: "create" | "savedNull" | "overrideNull";
    value: ConfiguredSessionControlValue | null;
    submission: { modeId: string | null; canSubmit: true };
  }
  | {
    state: "savedUnavailable";
    savedModeId: string;
    submission: { modeId: string; canSubmit: true };
  }
  | {
    state: "none";
    submission: { modeId: null; canSubmit: true };
  };

export function resolveAutomationModeSelection({
  agentKind,
  savedModeId,
  override,
  useSavedMode,
  preferences,
}: {
  agentKind: string | null;
  savedModeId: string | null;
  override: AutomationModeOverride | null;
  useSavedMode: boolean;
  preferences: AutomationModePreferences;
}): {
  options: ConfiguredSessionControlValue[];
  resolution: AutomationModeResolution;
} {
  const options = listConfiguredSessionControlValues(agentKind, "mode");

  if (!agentKind) {
    return {
      options,
      resolution: { state: "none", submission: { modeId: null, canSubmit: true } },
    };
  }

  if (override) {
    if (!override.modeId) {
      return {
        options,
        resolution: {
          state: "default",
          source: "overrideNull",
          value: defaultModeValue(options, preferences.defaultSessionModeByAgentKind[agentKind]),
          submission: { modeId: null, canSubmit: true },
        },
      };
    }

    const overrideValue = resolveConfiguredSessionControlValue(agentKind, "mode", override.modeId);
    return overrideValue
      ? {
        options,
        resolution: {
          state: "selected",
          source: "override",
          value: overrideValue,
          submission: { modeId: overrideValue.value, canSubmit: true },
        },
      }
      : {
        options,
        resolution: {
          state: "savedUnavailable",
          savedModeId: override.modeId,
          submission: { modeId: override.modeId, canSubmit: true },
        },
      };
  }

  if (useSavedMode) {
    if (!savedModeId) {
      return {
        options,
        resolution: {
          state: "default",
          source: "savedNull",
          value: defaultModeValue(options, preferences.defaultSessionModeByAgentKind[agentKind]),
          submission: { modeId: null, canSubmit: true },
        },
      };
    }

    const savedValue = resolveConfiguredSessionControlValue(agentKind, "mode", savedModeId);
    return savedValue
      ? {
        options,
        resolution: {
          state: "selected",
          source: "saved",
          value: savedValue,
          submission: { modeId: savedValue.value, canSubmit: true },
        },
      }
      : {
        options,
        resolution: {
          state: "savedUnavailable",
          savedModeId,
          submission: { modeId: savedModeId, canSubmit: true },
        },
      };
  }

  const value = defaultModeValue(options, preferences.defaultSessionModeByAgentKind[agentKind]);
  return value
    ? {
      options,
      resolution: {
        state: "default",
        source: "create",
        value,
        submission: { modeId: value.value, canSubmit: true },
      },
    }
    : {
      options,
      resolution: { state: "none", submission: { modeId: null, canSubmit: true } },
    };
}

function defaultModeValue(
  options: ConfiguredSessionControlValue[],
  preferredModeId: string | null | undefined,
): ConfiguredSessionControlValue | null {
  return options.find((candidate) => candidate.value === preferredModeId)
    ?? options.find((candidate) => candidate.isDefault)
    ?? options[0]
    ?? null;
}
