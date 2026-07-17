import { useMemo } from "react";
import { useAgentLaunchOptionsQuery } from "@anyharness/sdk-react";
import { useShallow } from "zustand/react/shallow";
import { useCloudAgentCatalog } from "#product/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents,
  type DesktopAgentLaunchAgent,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import { resolveUnattendedModeId } from "#product/lib/domain/agents/unattended-mode";
import {
  inferSessionControlPresentation,
  launchControlToConfiguredSessionControlValues,
  listConfiguredSessionControlValues,
} from "#product/lib/domain/chat/session-controls/session-mode-control";
import type {
  ConfiguredSessionControlValue,
} from "#product/lib/domain/chat/session-controls/presentation";
import type {
  HomeNextDestination,
  HomeNextModelSelection,
  HomeNextRepoLaunchKind,
} from "#product/lib/domain/home/home-next-launch";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

interface UseHomeNextModeSelectionArgs {
  destination: HomeNextDestination;
  modelSelection: HomeNextModelSelection | null;
  modeOverrideId: string | null;
  repoLaunchKind: HomeNextRepoLaunchKind;
}

const EMPTY_AGENTS: DesktopAgentLaunchAgent[] = [];

export function useHomeNextModeSelection({
  destination,
  modelSelection,
  modeOverrideId,
  repoLaunchKind,
}: UseHomeNextModeSelectionArgs) {
  const defaultSessionModeByAgentKind = useUserPreferencesStore(
    useShallow((state) => state.defaultSessionModeByAgentKind),
  );
  const agentKind = modelSelection?.kind ?? null;
  const catalogQuery = useCloudAgentCatalog(Boolean(agentKind));
  const runtimeLaunchOptions = useAgentLaunchOptionsQuery();
  const usesLocalRuntime = destination === "cowork" || repoLaunchKind !== "cloud";
  const launchAgents = useMemo(
    () => usesLocalRuntime
      ? mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
        catalogQuery.data?.agents ?? EMPTY_AGENTS,
        runtimeLaunchOptions.data?.agents ?? null,
      )
      : catalogQuery.data?.agents ?? EMPTY_AGENTS,
    [catalogQuery.data?.agents, runtimeLaunchOptions.data?.agents, usesLocalRuntime],
  );

  const modelId = modelSelection?.modelId ?? null;
  const unattendedModeId = useMemo(
    () => resolveUnattendedModeId({
      agent: launchAgents.find((candidate) => candidate.kind === agentKind),
      modelId,
    }),
    [agentKind, launchAgents, modelId],
  );
  const catalogModeOptions = useMemo(() => {
    const agent = launchAgents.find((candidate) => candidate.kind === agentKind);
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
  }, [agentKind, launchAgents, modelId]);

  const modeOptions = useMemo(
    () => withUnattendedModeOption(
      catalogModeOptions.length > 0
      ? catalogModeOptions
      : listConfiguredSessionControlValues(agentKind, "mode"),
      destination === "cowork" ? unattendedModeId : undefined,
    ),
    [agentKind, catalogModeOptions, destination, unattendedModeId],
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
      ? unattendedModeId
      : defaultSessionModeByAgentKind[agentKind] ?? null;

    if (destination === "cowork" && !preferredModeId) {
      return null;
    }

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
    unattendedModeId,
  ]);

  return {
    modeOptions,
    effectiveMode,
    effectiveModeId: effectiveMode?.value ?? null,
  };
}

function withUnattendedModeOption(
  options: ConfiguredSessionControlValue[],
  unattendedModeId: string | undefined,
): ConfiguredSessionControlValue[] {
  if (
    !unattendedModeId
    || options.some((option) => option.value === unattendedModeId)
  ) {
    return options;
  }
  const label = humanizeModeId(unattendedModeId);
  return [
    ...options,
    {
      value: unattendedModeId,
      label,
      shortLabel: label,
      description: null,
      icon: inferSessionControlPresentation(unattendedModeId).icon,
    },
  ];
}

function humanizeModeId(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
