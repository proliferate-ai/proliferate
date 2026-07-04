import { useEffect, useRef } from "react";
import {
  useAgentGatewayCapabilities,
  useAuthSelections,
  usePutAuthSelections,
} from "@proliferate/cloud-sdk-react";
import { useRuntimeHealthQuery } from "@anyharness/sdk-react";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { planFirstRunAuthAdoption } from "@/lib/domain/agents/auth-onboarding";

/**
 * First-run adoption of the managed gateway into auth selections (spec §9).
 * Runs once per app run, and only when the user has zero selections, so a fresh
 * profile that detected no native credentials falls back to the gateway.
 * Harnesses with detected native creds are left on the implicit native state.
 *
 * Fire-and-forget: adoption failures are logged and never surfaced — the
 * settings page stays the authoritative place to manage auth.
 */
export function useFirstRunAuthAdoption() {
  const { cloudActive } = useCloudAvailabilityState();
  const capabilitiesQuery = useAgentGatewayCapabilities(cloudActive);
  const selectionsQuery = useAuthSelections(null, cloudActive);
  const {
    agents,
    isLoading: agentsLoading,
    reconcileSnapshot,
    reconcileStatus,
  } = useAgentCatalog();
  const runtimeHealth = useRuntimeHealthQuery({
    pollWhileAgentSeedHydrating: true,
  });
  const putSelections = usePutAuthSelections();
  const attemptedRef = useRef(false);

  const selections = selectionsQuery.data;
  const gatewayEnabled = capabilitiesQuery.data?.gatewayEnabled;
  const putMutate = putSelections.mutate;
  const agentSeedStatus = runtimeHealth.data?.agentSeed?.status;

  // The runtime hydrates the bundled seed then runs an installed-only reconcile
  // at startup; agent credential/install states are only trustworthy once that
  // pass has SETTLED. Deciding from a mid-hydration snapshot permanently misses
  // native creds for harnesses that hydrate after the (one-shot) decision.
  // We must wait for BOTH agentSeed hydration AND reconcile to settle before
  // making the one-shot adoption decision.
  const reconcileActive =
    reconcileStatus === "queued" || reconcileStatus === "running";
  const agentSeedSettled =
    agentSeedStatus !== "hydrating" && agentSeedStatus !== undefined;
  const readinessSettled =
    reconcileSnapshot !== null && !reconcileActive && agentSeedSettled;

  useEffect(() => {
    if (attemptedRef.current || !cloudActive) {
      return;
    }
    // Wait until every input has settled before deciding anything.
    if (selections === undefined || gatewayEnabled === undefined) {
      return;
    }
    if (agentsLoading || agents.length === 0) {
      return;
    }
    if (!readinessSettled) {
      return;
    }

    attemptedRef.current = true;
    const actions = planFirstRunAuthAdoption({
      agents,
      selectionCount: selections.length,
      gatewayEnabled,
    });
    for (const action of actions) {
      putMutate(
        {
          harnessKind: action.harnessKind,
          surface: action.surface,
          body: { sources: [{ sourceKind: "gateway", enabled: true }] },
        },
        {
          onError: (error) => {
            console.warn(
              `[agent-auth] first-run adoption failed for ${action.harnessKind}`,
              error,
            );
          },
        },
      );
    }
  }, [
    agents,
    agentsLoading,
    cloudActive,
    gatewayEnabled,
    readinessSettled,
    selections,
    putMutate,
  ]);
}
