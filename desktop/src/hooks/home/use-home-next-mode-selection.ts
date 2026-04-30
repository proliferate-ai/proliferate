import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { resolveCoworkDefaultSessionModeId } from "@/lib/domain/cowork/session-mode-defaults";
import {
  listConfiguredSessionControlValues,
  resolveConfiguredSessionControlValue,
  resolveEffectiveConfiguredSessionControlValue,
} from "@/lib/domain/chat/session-mode-control";
import type {
  ConfiguredSessionControlValue,
} from "@/config/session-control-presentations";
import type {
  HomeNextDestination,
  HomeNextModelSelection,
} from "@/lib/domain/home/home-next-launch";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

interface UseHomeNextModeSelectionArgs {
  destination: HomeNextDestination;
  modelSelection: HomeNextModelSelection | null;
  modeOverrideId: string | null;
}

export function useHomeNextModeSelection({
  destination,
  modelSelection,
  modeOverrideId,
}: UseHomeNextModeSelectionArgs) {
  const defaultSessionModeByAgentKind = useUserPreferencesStore(
    useShallow((state) => state.defaultSessionModeByAgentKind),
  );
  const agentKind = modelSelection?.kind ?? null;

  const modeOptions = useMemo(
    () => listConfiguredSessionControlValues(agentKind, "mode"),
    [agentKind],
  );
  const effectiveMode = useMemo<ConfiguredSessionControlValue | null>(() => {
    if (modeOptions.length === 0 || !agentKind) {
      return null;
    }

    const override = resolveConfiguredSessionControlValue(agentKind, "mode", modeOverrideId);
    if (override) {
      return override;
    }

    const preferredModeId = destination === "cowork"
      ? resolveCoworkDefaultSessionModeId(agentKind)
      : defaultSessionModeByAgentKind[agentKind] ?? null;

    return resolveEffectiveConfiguredSessionControlValue(
      agentKind,
      "mode",
      preferredModeId,
    );
  }, [
    agentKind,
    defaultSessionModeByAgentKind,
    destination,
    modeOptions.length,
    modeOverrideId,
  ]);

  return {
    modeOptions,
    effectiveMode,
    effectiveModeId: effectiveMode?.value ?? null,
  };
}
