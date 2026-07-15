import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCloudAgentCatalog } from "#product/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { resolveCoworkDefaultSessionModeId } from "#product/lib/domain/cowork/session-mode-defaults";
import {
  launchControlToConfiguredSessionControlValues,
  listConfiguredSessionControlValues,
} from "#product/lib/domain/chat/session-controls/session-mode-control";
import type {
  ConfiguredSessionControlValue,
} from "#product/lib/domain/chat/session-controls/presentation";
import type {
  HomeNextDestination,
  HomeNextModelSelection,
} from "#product/lib/domain/home/home-next-launch";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

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
  const catalogQuery = useCloudAgentCatalog(Boolean(agentKind));

  const modelId = modelSelection?.modelId ?? null;
  const catalogModeOptions = useMemo(() => {
    const agent = catalogQuery.data?.agents.find((candidate) => candidate.kind === agentKind);
    const control = agent?.launchControls?.find((candidate) => candidate.key === "mode") ?? null;
    const options = launchControlToConfiguredSessionControlValues(agentKind, control);
    // Scope to the modes the SELECTED model actually supports. The agent-level
    // `mode` vocabulary is a superset (e.g. it includes `auto`), but gateway /
    // bedrock models reject modes outside their per-model vocabulary at session
    // creation. Without this, the composer would default to (and offer) a mode
    // the model can't use — e.g. `auto` for a gateway Claude model.
    const model = agent?.models.find((candidate) =>
      candidate.id === modelId || (candidate.aliases ?? []).includes(modelId ?? ""));
    const modeValues = model?.modeValues ?? null;
    if (!modeValues || modeValues.length === 0) {
      return options;
    }
    const supported = options.filter((option) => modeValues.includes(option.value));
    return supported.length > 0 ? supported : options;
  }, [agentKind, catalogQuery.data?.agents, modelId]);

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
