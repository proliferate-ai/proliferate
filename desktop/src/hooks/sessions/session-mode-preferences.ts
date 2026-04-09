import { withUpdatedDefaultSessionModeByAgentKind } from "@/lib/domain/chat/session-mode-control";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export function persistDefaultSessionModePreference(
  agentKind: string | null | undefined,
  liveConfigRawConfigId: string | null | undefined,
  rawConfigId: string,
  modeId: string | null | undefined,
): void {
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
