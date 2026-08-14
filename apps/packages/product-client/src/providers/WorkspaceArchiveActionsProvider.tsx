import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  useWorkspaceArchiveActions,
  type UnarchiveScenarioState,
} from "#product/hooks/workspaces/workflows/use-workspace-archive-actions";
import type { UnarchiveScenarioAnswer } from "#product/lib/domain/workspaces/archived/archive-knob-resolution";
import { useArchivePendingReconciler } from "#product/hooks/workspaces/lifecycle/use-archive-pending-reconciler";

export interface WorkspaceArchiveActionsContextValue {
  archive: (workspaceId: string, name: string, wasSelected: boolean) => void;
  unarchive: (workspaceId: string, name: string, answer?: UnarchiveScenarioAnswer) => void;
  /** Rows hidden with an archive POST in flight (or genuinely unknown,
   * mid-timeout). Both the sidebar and the Archived workspaces page filter
   * their lists against this same set — one shared instance, so the two
   * surfaces never disagree about which workspaces exist. */
  optimisticallyArchivedIds: ReadonlySet<string>;
  scenario: UnarchiveScenarioState | null;
  dismissScenario: () => void;
}

const WorkspaceArchiveActionsContext = createContext<
  WorkspaceArchiveActionsContextValue | undefined
>(undefined);

/**
 * The single shared instance of the archive/unarchive workflow (§3.2, §3.10):
 * the sidebar's hover archive button and the Archived workspaces page's
 * per-row Unarchive both need the SAME optimistic-hide set and the SAME
 * scenario-409 dialog state, because the ADR's "no two disagreeing truths"
 * rule applies across surfaces, not just within one. Mounted once at the
 * authenticated app root — where it lives alongside the pending reconciler,
 * so a workspace archived from the sidebar and confirmed by the poll updates
 * both surfaces from one state, never two independent copies of it.
 */
export function WorkspaceArchiveActionsProvider({ children }: { children: ReactNode }) {
  const {
    archive,
    unarchive,
    optimisticallyArchivedIds,
    pendingDecisionIds,
    confirmArchived,
    reinstateOptimistic,
    scenario,
    dismissScenario,
  } = useWorkspaceArchiveActions();

  // The reconciler watches only UNDECIDED archives (timed-out POSTs), not the
  // full hide set: a settled archive still hiding through its list-refetch
  // window must not be re-confirmable, or T1 would fire twice.
  useArchivePendingReconciler({
    pendingIds: pendingDecisionIds,
    onConfirmedArchived: confirmArchived,
    onReinstated: reinstateOptimistic,
  });

  const value = useMemo<WorkspaceArchiveActionsContextValue>(() => ({
    archive,
    unarchive,
    optimisticallyArchivedIds,
    scenario,
    dismissScenario,
  }), [archive, dismissScenario, optimisticallyArchivedIds, scenario, unarchive]);

  return (
    <WorkspaceArchiveActionsContext.Provider value={value}>
      {children}
    </WorkspaceArchiveActionsContext.Provider>
  );
}

export function useWorkspaceArchiveActionsContext(): WorkspaceArchiveActionsContextValue {
  const value = useContext(WorkspaceArchiveActionsContext);
  if (!value) {
    throw new Error(
      "useWorkspaceArchiveActionsContext must be used inside WorkspaceArchiveActionsProvider",
    );
  }
  return value;
}
