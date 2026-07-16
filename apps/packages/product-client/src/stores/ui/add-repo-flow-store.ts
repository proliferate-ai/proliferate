import { create } from "zustand";

export type AddRepoFlowStoreStep =
  | { kind: "entry" }
  | { kind: "cloud" }
  | { kind: "clone" };

/** What the unified flow produced, for callers that select the new repo. */
export type AddRepoFlowCompletion =
  | { kind: "local"; sourceRoot: string }
  | { kind: "cloud"; repoId: string };

interface AddRepoFlowState {
  open: boolean;
  step: AddRepoFlowStoreStep;
  onCompleted: ((completion: AddRepoFlowCompletion) => void) | null;
  openFlow: (options?: {
    onCompleted?: (completion: AddRepoFlowCompletion) => void;
  }) => void;
  setStep: (step: AddRepoFlowStoreStep) => void;
  /** Hide the picker while the connected repository-readiness host owns it. */
  handoffToCloud: () => void;
  close: () => void;
}

const ENTRY_STEP: AddRepoFlowStoreStep = { kind: "entry" };

export const useAddRepoFlowStore = create<AddRepoFlowState>((set) => ({
  open: false,
  step: ENTRY_STEP,
  onCompleted: null,
  openFlow: (options) => set({
    open: true,
    step: ENTRY_STEP,
    onCompleted: options?.onCompleted ?? null,
  }),
  setStep: (step) => set({ step }),
  handoffToCloud: () => set({ open: false }),
  close: () => set({ open: false, step: ENTRY_STEP, onCompleted: null }),
}));
