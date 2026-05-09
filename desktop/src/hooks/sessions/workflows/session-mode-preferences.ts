import type { Workspace } from "@anyharness/sdk";
import { withUpdatedDefaultSessionModeByAgentKind } from "@/lib/domain/chat/session-controls/session-mode-control";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

interface PersistDefaultSessionModePreferenceInput {
  agentKind: string | null | undefined;
  liveConfigRawConfigId: string | null | undefined;
  rawConfigId: string;
  modeId: string | null | undefined;
  workspaceSurface: Workspace["surface"] | null | undefined;
}

export function shouldPersistDefaultSessionModePreference(
  workspaceSurface: Workspace["surface"] | null | undefined,
): boolean {
  return workspaceSurface === "standard";
}

export function persistDefaultSessionModePreference(
  input: PersistDefaultSessionModePreferenceInput,
): void {
  if (!shouldPersistDefaultSessionModePreference(input.workspaceSurface)) {
    return;
  }

  const { agentKind, liveConfigRawConfigId, rawConfigId, modeId } = input;
  if (!agentKind || !liveConfigRawConfigId || liveConfigRawConfigId !== rawConfigId) {
    return;
  }

  const preferenceState = useUserPreferencesStore.getState();
  const nextDefaults = withUpdatedDefaultSessionModeByAgentKind(
    preferenceState.defaultSessionModeByAgentKind,
    agentKind,
    modeId,
  );

  if (nextDefaults !== preferenceState.defaultSessionModeByAgentKind) {
    preferenceState.set("defaultSessionModeByAgentKind", nextDefaults);
  }
}
