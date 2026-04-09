import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export type SetupRequirementKind = "open-target" | "chat-defaults";

export interface SetupRequirement {
  kind: SetupRequirementKind;
}

export function useSetupRequirements() {
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    hydrated: state._hydrated,
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelId: state.defaultChatModelId,
    defaultOpenInTargetId: state.defaultOpenInTargetId,
  })));

  const requirements = useMemo<SetupRequirement[]>(() => {
    if (!preferences.hydrated) {
      return [];
    }

    const next: SetupRequirement[] = [];

    if (!preferences.defaultOpenInTargetId) {
      next.push({ kind: "open-target" });
    }

    if (!preferences.defaultChatAgentKind || !preferences.defaultChatModelId) {
      next.push({ kind: "chat-defaults" });
    }

    return next;
  }, [
    preferences.defaultChatAgentKind,
    preferences.defaultChatModelId,
    preferences.defaultOpenInTargetId,
    preferences.hydrated,
  ]);

  return {
    isHydrated: preferences.hydrated,
    requirements,
    currentRequirement: requirements[0] ?? null,
    requiresSetup: preferences.hydrated && requirements.length > 0,
  };
}
