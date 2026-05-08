import { useCallback } from "react";
import { useSessionActions } from "@/hooks/sessions/facade/use-session-actions";
import type { SupportedLiveControlKey } from "@/lib/domain/chat/session-controls/session-controls";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export function useChatLaunchControlActions({
  activeLaunchAgentKind,
}: {
  activeLaunchAgentKind: string | null;
}) {
  const { setActiveSessionConfigOption } = useSessionActions();

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
