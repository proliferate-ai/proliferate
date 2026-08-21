import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type {
  AgentAuthProbePhase,
  HarnessLaunchOptionsState,
} from "@anyharness/sdk";
import { useRefreshHarnessLaunchOptionsMutation } from "@anyharness/sdk-react";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import {
  useHomeTargetAgentLaunchOptions,
  useHomeTargetOtherAgentsLaunchOptions,
} from "#product/hooks/home/derived/use-home-target-agent-launch-options";
import {
  projectHarnessLaunchOptions,
  type DesktopLaunchModelRegistry as ModelRegistry,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import {
  resolveHomeModelGate,
  type HomeModelGateObservation,
} from "#product/lib/domain/home/home-model-gate";
import {
  buildHomeNextModelGroups,
  resolveEffectiveHomeModelSelection,
  resolveHomeNextModelInfo,
  type HomeLaunchTarget,
  type HomeNextModelSelection,
} from "#product/lib/domain/home/home-next-launch";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];

interface UseHomeNextModelSelectionArgs {
  modelSelectionOverride: HomeNextModelSelection | null;
  launchTarget: HomeLaunchTarget | null;
}

export function useHomeNextModelSelection({
  modelSelectionOverride,
  launchTarget,
}: UseHomeNextModelSelectionArgs) {
  const {
    agents,
    readyAgents,
    isLoading: agentsLoading,
    isError: agentsError,
    error: agentsQueryError,
    isReconciling,
    installingAgents,
  } = useAgentCatalog();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
  })));
  const requestedHarnessKind = modelSelectionOverride?.kind
    || preferences.defaultChatAgentKind
    || (launchTarget?.kind === "cloud" ? null : readyAgents[0]?.kind)
    || null;
  const targetLaunchOptions = useHomeTargetAgentLaunchOptions({
    harnessKind: requestedHarnessKind,
    launchTarget,
  });
  // Every OTHER ready harness on the same target stays pickable too; the
  // requested kind's query keeps driving loading/error/availability. Additive
  // best-effort: an unresolved kind is absent until its observation arrives.
  const otherReadyHarnessKinds = useMemo(
    () => readyAgents
      .map((agent) => agent.kind)
      .filter((kind) => kind !== requestedHarnessKind),
    [readyAgents, requestedHarnessKind],
  );
  const otherLaunchOptions = useHomeTargetOtherAgentsLaunchOptions({
    harnessKinds: otherReadyHarnessKinds,
    launchTarget,
  });
  const modelRegistries = useMemo(
    () => {
      const registries = [
        targetLaunchOptions.data,
        ...otherLaunchOptions.map((entry) => entry.data),
      ]
        .flatMap((response) => {
          const agent = response ? projectHarnessLaunchOptions(response) : null;
          return agent ? [{
            kind: agent.kind,
            displayName: agent.displayName,
            defaultModelId: agent.defaultModelId,
            models: agent.models,
          }] : [];
        });
      return registries.length > 0 ? registries : EMPTY_MODEL_REGISTRIES;
    },
    [otherLaunchOptions, targetLaunchOptions.data],
  );
  const readyAgentsForLaunch = useMemo(() => modelRegistries.map((registry) => ({
    kind: registry.kind,
    displayName: registry.displayName,
    readiness: "ready" as const,
  })), [modelRegistries]);

  const unselectedGroups = useMemo(
    () => buildHomeNextModelGroups(readyAgentsForLaunch, modelRegistries, null),
    [readyAgentsForLaunch, modelRegistries],
  );
  const effectiveModelSelection = useMemo(
    () => resolveEffectiveHomeModelSelection(
      unselectedGroups,
      modelSelectionOverride,
      preferences,
    ),
    [modelSelectionOverride, preferences, unselectedGroups],
  );
  const modelGroups = useMemo(
    () => buildHomeNextModelGroups(
      readyAgentsForLaunch,
      modelRegistries,
      effectiveModelSelection,
    ),
    [effectiveModelSelection, readyAgentsForLaunch, modelRegistries],
  );
  const selectedModel = useMemo(
    () => resolveHomeNextModelInfo(
      modelGroups,
      modelRegistries,
      effectiveModelSelection,
    ),
    [effectiveModelSelection, modelGroups, modelRegistries],
  );

  // One observation row per launch-option read the target actually performed.
  // The requested kind is folded in from its own query; the fan-out kinds come
  // from the list query, whose per-kind flags are what keep `querying` and
  // `transport_error` apart. Cloud responses carry no `probePhase` — a cloud
  // target's probe engine is not this client's to report on.
  const observations = useMemo<HomeModelGateObservation[]>(() => {
    const rows: HomeModelGateObservation[] = [];
    if (requestedHarnessKind) {
      rows.push({
        harnessKind: requestedHarnessKind,
        state: launchOptionsState(targetLaunchOptions.data),
        probePhase: launchOptionsProbePhase(targetLaunchOptions.data),
        isPending: targetLaunchOptions.isLoading,
        isError: targetLaunchOptions.isError,
      });
    }
    for (const entry of otherLaunchOptions) {
      rows.push({
        harnessKind: entry.harnessKind,
        state: launchOptionsState(entry.data),
        probePhase: launchOptionsProbePhase(entry.data),
        isPending: entry.isPending,
        isError: entry.isError,
      });
    }
    return rows;
  }, [
    otherLaunchOptions,
    requestedHarnessKind,
    targetLaunchOptions.data,
    targetLaunchOptions.isError,
    targetLaunchOptions.isLoading,
  ]);

  const isCloudTarget = launchTarget?.kind === "cloud";
  const agentReadiness = useMemo(
    // A cloud launch runs against the sandbox's agents, so the desktop
    // catalog's readiness says nothing about it and must not block it.
    () => (isCloudTarget ? [] : agents.map((agent) => agent.readiness)),
    [agents, isCloudTarget],
  );
  const offeredModelCount = useMemo(
    () => modelGroups.reduce((count, group) => count + group.models.length, 0),
    [modelGroups],
  );
  const modelGate = useMemo(() => resolveHomeModelGate({
    hasLaunchTarget: launchTarget !== null,
    isTargetUnobserved: targetLaunchOptions.isTargetUnobserved,
    // Both halves are required: a persisted default naming a model this target
    // never observed resolves to nothing, and the gate must then keep offering
    // the rows it does have rather than silently substituting one of them.
    hasExactSelection: effectiveModelSelection !== null && selectedModel !== null,
    offeredModelCount,
    observations,
    agentReadiness,
    isInstalling: !isCloudTarget && (isReconciling || installingAgents.length > 0),
    isCatalogLoading: !isCloudTarget && agentsLoading,
    hasCatalogError: !isCloudTarget && agentsError,
  }), [
    agentReadiness,
    agentsError,
    agentsLoading,
    effectiveModelSelection,
    installingAgents.length,
    isCloudTarget,
    isReconciling,
    launchTarget,
    observations,
    offeredModelCount,
    selectedModel,
    targetLaunchOptions.isTargetUnobserved,
  ]);

  const refreshLaunchOptions = useRefreshHarnessLaunchOptionsMutation();
  const refetchTargetLaunchOptions = targetLaunchOptions.refetch;
  const refreshMutate = refreshLaunchOptions.mutate;
  /**
   * The cure behind every blocked notice's action (ruling 5: a state must
   * never disable the control that would cure it).
   *
   * A harness that failed without an observation needs a NEW probe — refetching
   * would just re-read the recorded failure — while a request that never landed
   * needs the request again.
   */
  const retryModelObservation = useCallback(() => {
    const failedKinds = observations
      .filter((observation) => observation.state === "failed_without_observation")
      .map((observation) => observation.harnessKind);
    if (!isCloudTarget && failedKinds.length > 0) {
      for (const harnessKind of failedKinds) {
        refreshMutate(harnessKind);
      }
      return;
    }
    refetchTargetLaunchOptions();
  }, [isCloudTarget, observations, refetchTargetLaunchOptions, refreshMutate]);

  return {
    modelGroups,
    modelRegistries,
    effectiveModelSelection,
    selectedModel,
    /** True only while the AGENT CATALOG's own HTTP read is in flight. Never
     * an install and never a probe — the trigger label depends on the
     * difference. */
    isCatalogLoading: !isCloudTarget && agentsLoading,
    /** The catalog knows of at least one agent. Independent of whether any of
     * them has reported models yet. */
    hasKnownAgents: isCloudTarget ? modelGroups.length > 0 : agents.length > 0,
    error: (isCloudTarget ? null : agentsQueryError) ?? targetLaunchOptions.error,
    modelGate,
    retryModelObservation,
  };
}

function launchOptionsState(
  response: { state: string } | null | undefined,
): HarnessLaunchOptionsState | null {
  return (response?.state as HarnessLaunchOptionsState | undefined) ?? null;
}

function launchOptionsProbePhase(
  response: object | null | undefined,
): AgentAuthProbePhase | null {
  // The cloud response type has no `probePhase` at all: a cloud sandbox's
  // probe scheduler is not this client's to report on, so it reads as absent
  // rather than as a settled `idle`.
  if (!response || !("probePhase" in response)) {
    return null;
  }
  return (response as { probePhase?: AgentAuthProbePhase | null }).probePhase ?? null;
}
