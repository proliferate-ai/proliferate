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
      updateDefaultLaunchControlPreference(agentKind, rawConfigId, value);
      return;
    }

    void setActiveSessionConfigOption(rawConfigId, value, { controlKey }).catch(() => {
      updateDefaultLaunchControlPreference(activeLaunchAgentKind, rawConfigId, value);
    });
  }, [activeLaunchAgentKind, setActiveSessionConfigOption]);
}

// Persisted launch defaults are keyed by the RAW target-observed control id
// (the create seam exact-validates keys against the harness observation), so
// this must receive `rawConfigId`, never the normalized control key.
function updateDefaultLaunchControlPreference(
  agentKind: string,
  rawConfigId: string,
  value: string,
): void {
  const state = useUserPreferencesStore.getState();
  state.set("defaultLiveSessionControlValuesByAgentKind", {
    ...state.defaultLiveSessionControlValuesByAgentKind,
    [agentKind]: {
      ...state.defaultLiveSessionControlValuesByAgentKind[agentKind],
      [rawConfigId]: value,
    },
  });
}
