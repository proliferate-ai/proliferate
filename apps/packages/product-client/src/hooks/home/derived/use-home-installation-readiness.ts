import { useMemo } from "react";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import {
  resolveHomeReadinessCardModel,
  type HomeInstallProgressComponent,
  type HomeReadinessCardModel,
} from "#product/lib/domain/home/home-screen";

const EMPTY_COMPONENTS: readonly HomeInstallProgressComponent[] = [];

/**
 * Sources the Home readiness card from the live reconcile job snapshot
 * rather than the general agents list (D-R1/D-R2 fix). That list is a stale
 * sample taken before an install starts and refetched only after it ends —
 * disjoint from the entire install window on a fresh machine — and its own
 * per-agent "installing" flag can only ever point at whichever single agent
 * the runtime currently has active. The reconcile snapshot's per-component
 * progress is the one live source that knows every agent in the job
 * throughout; it is the same snapshot HarnessUpdateToastPresenter already
 * polls via useAgentReconcileStatusQuery, so the two surfaces never disagree
 * about which job is running.
 *
 * Liveness is passed alongside the components rather than inferred from them
 * (D-R10): a frozen snapshot keeps its last phases indefinitely, so the job
 * status and whether the poll is still able to refresh are what say the card
 * is describing something happening now.
 */
export function useHomeInstallationReadiness(
  gateKind: "launchable" | "selection_required" | "blocked",
): HomeReadinessCardModel | null {
  const { reconcileSnapshot, reconcileIsError } = useAgentCatalog();
  const progressComponents = reconcileSnapshot?.progress?.components ?? EMPTY_COMPONENTS;
  const jobStatus = reconcileSnapshot?.status ?? null;

  return useMemo(
    () => resolveHomeReadinessCardModel({
      gateKind,
      jobStatus,
      // A retained snapshot the poll can no longer refresh is not evidence of
      // anything current, whatever status it froze at (D-R10).
      snapshotIsStale: reconcileIsError,
      progressComponents,
    }),
    [gateKind, jobStatus, progressComponents, reconcileIsError],
  );
}
