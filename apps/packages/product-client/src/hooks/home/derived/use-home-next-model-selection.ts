import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type {
  AgentAuthProbePhase,
  HarnessLaunchOptionsState,
} from "@anyharness/sdk";
import { useRefreshHarnessLaunchOptionsMutation } from "@anyharness/sdk-react";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { useRefetchAgentLaunchOptionsKind } from "#product/hooks/access/anyharness/agents/use-refetch-agent-launch-options-kind";
import {
  useHomeTargetAgentLaunchOptions,
  useHomeTargetOtherAgentsLaunchOptions,
} from "#product/hooks/home/derived/use-home-target-agent-launch-options";
import {
  projectHarnessLaunchOptions,
  type DesktopLaunchModelRegistry as ModelRegistry,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import {
  homeModelGateNeedsNewProbe,
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

interface RefreshAttempt {
  attempted: number;
  settled: number;
  refused: number;
}

const IDLE_REFRESH_ATTEMPT: RefreshAttempt = { attempted: 0, settled: 0, refused: 0 };

function isRefreshInFlight(attempt: RefreshAttempt): boolean {
  return attempt.attempted > 0 && attempt.settled < attempt.attempted;
}

/** Refused only when NOTHING got through: one kind succeeding means the
 * refresh did something, whatever another kind answered. */
function isRefreshRefused(attempt: RefreshAttempt): boolean {
  return attempt.attempted > 0
    && attempt.settled === attempt.attempted
    && attempt.refused === attempt.attempted;
}

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
    refetch: refetchAgents,
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
  // The agent catalog is a different query from every launch-option read, so
  // its failure is a different thing to repair.
  const hasCatalogError = !isCloudTarget && agentsError;
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
    hasCatalogError,
  }), [
    agentReadiness,
    agentsLoading,
    hasCatalogError,
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

  /**
   * The outcome of the probes THIS notice's action started.
   *
   * Counted here rather than read off the mutation, because one `useMutation`
   * observer tracks only its most recent call: fire two kinds, have one
   * refused and one succeed, and `isError` reports whichever finished last.
   * The user would be told the refresh was refused because of start order.
   */
  const [refreshAttempt, setRefreshAttempt] = useState(IDLE_REFRESH_ATTEMPT);
  // A refusal belongs to the target it was refused on. Switching targets must
  // not carry "Couldn't refresh your models." to a target nothing was ever
  // asked of — and on cloud nothing can clear it, since cloud never probes.
  const launchTargetKind = launchTarget?.kind ?? null;
  useEffect(() => {
    setRefreshAttempt(IDLE_REFRESH_ATTEMPT);
  }, [launchTargetKind]);
  const refreshLaunchOptions = useRefreshHarnessLaunchOptionsMutation();
  const refetchTargetLaunchOptions = targetLaunchOptions.refetch;
  const refetchLaunchOptionsKind = useRefetchAgentLaunchOptionsKind();
  const refreshMutate = refreshLaunchOptions.mutate;
  /**
   * The cure behind every blocked notice's action (ruling 5: a state must
   * never disable the control that would cure it).
   *
   * Four different things can be broken, and each needs its own repair aimed
   * at the query that actually failed — a Retry that re-asks something which
   * was never the problem leaves the notice on screen forever:
   *
   *  - A gate that says nothing has looked yet needs a NEW probe, for EVERY
   *    kind it knows about. Keyed on the gate rather than re-derived from the
   *    observations: `observation_idle` is reached from a settled-unobserved
   *    harness AND from the residual, and a retry that re-tested only the
   *    first arm's predicate promised a Refresh to a backed-off harness, a
   *    non-owner runtime and a zero-model `last_good_after_failure` and then
   *    delivered a re-read of the row that already said so.
   *  - A harness that failed without an observation needs a new probe too;
   *    refetching would just re-read the recorded failure.
   *  - A read that failed at the transport layer needs THAT read again: the
   *    requested kind through its own query, a fanned-out kind through its
   *    shared cache key.
   *  - The agent catalog's own read is a third query entirely, and it is the
   *    one `hasCatalogError` reports. Nothing else here touches it.
   *
   * Cloud is deliberately none of the above: a cloud response carries no
   * `probePhase`, so a cloud target always lands in the residual, where
   * re-asking the sandbox and its launch options genuinely IS the cure.
   */
  const retryModelObservation = useCallback(() => {
    let repaired = false;
    const awaitsFirstProbe = !isCloudTarget && homeModelGateNeedsNewProbe(modelGate);
    if (awaitsFirstProbe && observations.length === 0) {
      // No kind to probe: the requested kind is null, which also means the
      // single-kind query is DISABLED and refetching it is a no-op. The only
      // thing that can produce a kind is the catalog.
      void refetchAgents();
      return;
    }
    const probeKinds: string[] = [];
    for (const observation of observations) {
      if (
        !isCloudTarget
        && (awaitsFirstProbe || observation.state === "failed_without_observation")
      ) {
        probeKinds.push(observation.harnessKind);
        continue;
      }
      if (!observation.isError) {
        continue;
      }
      if (observation.harnessKind === requestedHarnessKind) {
        refetchTargetLaunchOptions();
      } else {
        refetchLaunchOptionsKind(observation.harnessKind);
      }
      repaired = true;
    }
    if (probeKinds.length > 0) {
      setRefreshAttempt({ attempted: probeKinds.length, settled: 0, refused: 0 });
      for (const harnessKind of probeKinds) {
        refreshMutate(harnessKind, {
          onError: () => setRefreshAttempt((attempt) => ({
            ...attempt,
            settled: attempt.settled + 1,
            refused: attempt.refused + 1,
          })),
          onSuccess: () => setRefreshAttempt((attempt) => ({
            ...attempt,
            settled: attempt.settled + 1,
          })),
        });
      }
      repaired = true;
    }
    if (hasCatalogError) {
      void refetchAgents();
      repaired = true;
    }
    // Nothing named itself: the cloud "Check again", whose whole story is that
    // the target has not answered at all, so re-asking the target IS the cure.
    if (!repaired) {
      refetchTargetLaunchOptions();
    }
  }, [
    hasCatalogError,
    isCloudTarget,
    modelGate,
    observations,
    refetchAgents,
    refetchLaunchOptionsKind,
    refetchTargetLaunchOptions,
    refreshMutate,
    requestedHarnessKind,
  ]);

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
     * them has reported models yet.
     *
     * A cloud sandbox's agents are not in the desktop catalog, so their
     * existence has to come from the sandbox's own answer — the presence of a
     * response, not the rows in it. Reading it off `modelGroups.length` said
     * "No agents" for an `observed_empty` sandbox, which is exactly the state
     * ruling 3 keeps the picker ENABLED for, and which is false: the agents
     * are there, they reported nothing. */
    hasKnownAgents: isCloudTarget
      ? targetLaunchOptions.data !== undefined
      : agents.length > 0,
    error: (isCloudTarget ? null : agentsQueryError) ?? targetLaunchOptions.error,
    modelGate,
    retryModelObservation,
    /** A probe this notice started is still running. Serialized, up to 45s per
     * kind, and the launch-options query does not poll a settled row — so
     * without this the settled sentence is rendered over live work. */
    retryPending: !isCloudTarget && isRefreshInFlight(refreshAttempt),
    /** EVERY kind attempted was refused. A rejection writes no durable state,
     * so nothing else on screen would ever change. Scoped to local: cloud
     * never calls the mutation, so nothing there could clear it. */
    retryRejected: !isCloudTarget && isRefreshRefused(refreshAttempt),
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
