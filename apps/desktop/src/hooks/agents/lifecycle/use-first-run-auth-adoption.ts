import { useEffect, useRef } from "react";
import {
  useAgentGatewayCapabilities,
  useRouteSelections,
  useUpsertRouteSelection,
} from "@proliferate/cloud-sdk-react";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { planFirstRunAuthAdoption } from "@/lib/domain/agents/auth-onboarding";

/**
 * First-run adoption of local native credentials into route selections
 * (spec §9). Runs once per app run, and only when the user has zero route
 * selections, so a fresh profile picks up whatever the local AnyHarness
 * credential scan detected (or falls back to the managed gateway).
 *
 * Fire-and-forget: adoption failures are logged and never surfaced — the
 * settings page stays the authoritative place to manage routes.
 */
export function useFirstRunAuthAdoption() {
  const { cloudActive } = useCloudAvailabilityState();
  const capabilitiesQuery = useAgentGatewayCapabilities(cloudActive);
  const selectionsQuery = useRouteSelections(cloudActive);
  const {
    agents,
    isLoading: agentsLoading,
    reconcileSnapshot,
    reconcileStatus,
  } = useAgentCatalog();
  const upsertSelection = useUpsertRouteSelection();
  const attemptedRef = useRef(false);

  const selections = selectionsQuery.data?.selections;
  const gatewayEnabled = capabilitiesQuery.data?.gatewayEnabled;
  const upsertMutate = upsertSelection.mutate;

  // The runtime hydrates the bundled seed then runs an installed-only reconcile
  // at startup; agent credential/install states are only trustworthy once that
  // pass has SETTLED. Deciding from a mid-hydration snapshot permanently misses
  // native creds for harnesses that hydrate after the (one-shot) decision.
  const reconcileActive =
    reconcileStatus === "queued" || reconcileStatus === "running";
  const readinessSettled = reconcileSnapshot !== null && !reconcileActive;

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
      upsertMutate(
        {
          harnessKind: action.harnessKind,
          surface: action.surface,
          body: { route: action.route },
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
    upsertMutate,
  ]);
}
