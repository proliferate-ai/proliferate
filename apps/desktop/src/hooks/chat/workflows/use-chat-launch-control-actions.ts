import { useCallback } from "react";
import { useSessionConfigActions } from "#product/hooks/sessions/workflows/use-session-config-actions";
import type { SupportedLiveControlKey } from "#product/lib/domain/chat/session-controls/session-controls";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

export function useChatLaunchControlActions({
  activeLaunchAgentKind,
}: {
  activeLaunchAgentKind: string | null;
}) {
  const { setActiveSessionConfigOption } = useSessionConfigActions();

  // Active sessions try live config first; default launch controls write
  // preferences directly. Failed live updates fall back to persisted defaults.
  return useCallback((
    agentKind: string,
    controlKey: SupportedLiveControlKey,
    rawConfigId: string,
    value: string,
  ) => {
    if (!activeLaunchAgentKind) {
      updateDefaultLaunchControlPreference(agentKind, controlKey, value);
      return;
    }

    void setActiveSessionConfigOption(rawConfigId, value).catch(() => {
      updateDefaultLaunchControlPreference(activeLaunchAgentKind, rawConfigId, value);
    });
  }, [activeLaunchAgentKind, setActiveSessionConfigOption]);
}

function updateDefaultLaunchControlPreference(
  agentKind: string,
  rawConfigId: string,
  value: string,
): void {
  const state = useUserPreferencesStore.getState();
  if (rawConfigId === "mode") {
    state.set("defaultSessionModeByAgentKind", {
      ...state.defaultSessionModeByAgentKind,
      [agentKind]: value,
    });
    return;
  }

  state.set("defaultLiveSessionControlValuesByAgentKind", {
    ...state.defaultLiveSessionControlValuesByAgentKind,
    [agentKind]: {
      ...state.defaultLiveSessionControlValuesByAgentKind[agentKind],
      [rawConfigId]: value,
    },
  });
}
