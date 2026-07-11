import { create } from "zustand";

/**
 * The post-launch "run pill" (spec run-from-chat R2: stay put + a pill that
 * tracks the launched run). Launching a workflow from any of the three doors
 * does NOT navigate; it drops a pill here that links into the run view. The
 * real tab-group affordance (PR F (c)) is phase 2 — a route link suffices now.
 */
export interface WorkflowRunPill {
  runId: string;
  workflowId: string;
  workflowName: string;
}

interface WorkflowRunPillStore {
  pills: WorkflowRunPill[];
  show: (pill: WorkflowRunPill) => void;
  dismiss: (runId: string) => void;
}

export const useWorkflowRunPillStore = create<WorkflowRunPillStore>((set) => ({
  pills: [],
  show: (pill) =>
    set((state) => ({
      // Newest first; dedupe by run so a re-launch doesn't stack the same pill.
      pills: [pill, ...state.pills.filter((existing) => existing.runId !== pill.runId)],
    })),
  dismiss: (runId) =>
    set((state) => ({ pills: state.pills.filter((pill) => pill.runId !== runId) })),
}));
