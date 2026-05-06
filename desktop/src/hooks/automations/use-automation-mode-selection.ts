import { useMemo } from "react";
import { useEffectiveAgentCatalogQuery } from "@anyharness/sdk-react";
import { useShallow } from "zustand/react/shallow";
import {
  resolveAutomationModeSelection,
  type AutomationModeOverride,
} from "@/lib/domain/automations/mode-selection";
import { launchControlToConfiguredSessionControlValues } from "@/lib/domain/chat/session-mode-control";
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
  const catalogQuery = useEffectiveAgentCatalogQuery({
    enabled: Boolean(agentKind),
  });

  const catalogModeOptions = useMemo(() => {
    const agent = catalogQuery.data?.agents.find((candidate) => candidate.kind === agentKind);
    const control = agent?.launchControls?.find((candidate) => candidate.key === "mode") ?? null;
    return launchControlToConfiguredSessionControlValues(agentKind, control);
  }, [agentKind, catalogQuery.data?.agents]);

  return useMemo(
    () => resolveAutomationModeSelection({
      agentKind,
      savedModeId,
      override,
      useSavedMode,
      preferences: {
        defaultSessionModeByAgentKind,
      },
      optionsOverride: catalogModeOptions.length > 0 ? catalogModeOptions : null,
    }),
    [
      agentKind,
      catalogModeOptions,
      defaultSessionModeByAgentKind,
      override,
      savedModeId,
      useSavedMode,
    ],
  );
}
