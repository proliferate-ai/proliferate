import { useMemo } from "react";
import { useEffectiveAgentCatalogQuery } from "@anyharness/sdk-react";
import { useShallow } from "zustand/react/shallow";
import { resolveCoworkDefaultSessionModeId } from "@/lib/domain/cowork/session-mode-defaults";
import {
  launchControlToConfiguredSessionControlValues,
  listConfiguredSessionControlValues,
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
  const catalogQuery = useEffectiveAgentCatalogQuery({
    enabled: Boolean(agentKind),
  });

  const catalogModeOptions = useMemo(() => {
    const agent = catalogQuery.data?.agents.find((candidate) => candidate.kind === agentKind);
    const control = agent?.launchControls?.find((candidate) => candidate.key === "mode") ?? null;
    return launchControlToConfiguredSessionControlValues(agentKind, control);
  }, [agentKind, catalogQuery.data?.agents]);

  const modeOptions = useMemo(
    () => catalogModeOptions.length > 0
      ? catalogModeOptions
      : listConfiguredSessionControlValues(agentKind, "mode"),
    [agentKind, catalogModeOptions],
  );
  const effectiveMode = useMemo<ConfiguredSessionControlValue | null>(() => {
    if (modeOptions.length === 0 || !agentKind) {
      return null;
    }

    const override = resolveModeOption(modeOptions, modeOverrideId);
    if (override) {
      return override;
    }

    const preferredModeId = destination === "cowork"
      ? resolveCoworkDefaultSessionModeId(agentKind)
      : defaultSessionModeByAgentKind[agentKind] ?? null;

    return resolveModeOption(modeOptions, preferredModeId)
      ?? modeOptions.find((option) => option.isDefault)
      ?? modeOptions[0]
      ?? null;
  }, [
    agentKind,
    defaultSessionModeByAgentKind,
    destination,
    modeOptions,
    modeOverrideId,
  ]);

  return {
    modeOptions,
    effectiveMode,
    effectiveModeId: effectiveMode?.value ?? null,
  };
}

function resolveModeOption(
  options: ConfiguredSessionControlValue[],
  value: string | null | undefined,
): ConfiguredSessionControlValue | null {
  if (!value) {
    return null;
  }
  return options.find((option) => option.value === value) ?? null;
}
