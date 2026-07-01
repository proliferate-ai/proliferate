import { create } from "zustand";

export type AddRepoFlowStoreStep =
  | { kind: "entry" }
  | { kind: "confirm-local"; path: string };

interface AddRepoFlowState {
  open: boolean;
  step: AddRepoFlowStoreStep;
  cloudPickerOpen: boolean;
  openFlow: () => void;
  setStep: (step: AddRepoFlowStoreStep) => void;
  openCloudPicker: () => void;
  closeCloudPicker: () => void;
  close: () => void;
}

const ENTRY_STEP: AddRepoFlowStoreStep = { kind: "entry" };

export const useAddRepoFlowStore = create<AddRepoFlowState>((set) => ({
  open: false,
  step: ENTRY_STEP,
  cloudPickerOpen: false,
  openFlow: () => set({ open: true, step: ENTRY_STEP, cloudPickerOpen: false }),
  setStep: (step) => set({ step }),
  openCloudPicker: () => set({ open: false, cloudPickerOpen: true }),
  closeCloudPicker: () => set({ cloudPickerOpen: false }),
  close: () => set({ open: false, step: ENTRY_STEP, cloudPickerOpen: false }),
}));
