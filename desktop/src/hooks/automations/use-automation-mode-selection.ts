import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  resolveAutomationModeSelection,
  type AutomationModeOverride,
} from "@/lib/domain/automations/mode-selection";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

interface UseAutomationModeSelectionArgs {
  agentKind: string | null;
  savedModeId: string | null;
  override: AutomationModeOverride | null;
  useSavedMode: boolean;
}

export function useAutomationModeSelection({
  agentKind,
  savedModeId,
  override,
  useSavedMode,
}: UseAutomationModeSelectionArgs) {
  const defaultSessionModeByAgentKind = useUserPreferencesStore(
    useShallow((state) => state.defaultSessionModeByAgentKind),
  );

  return useMemo(
    () => resolveAutomationModeSelection({
      agentKind,
      savedModeId,
      override,
      useSavedMode,
      preferences: {
        defaultSessionModeByAgentKind,
      },
    }),
    [agentKind, defaultSessionModeByAgentKind, override, savedModeId, useSavedMode],
  );
}
