import { create } from "zustand";

interface RepoSetupModalState {
  modal: {
    workspaceId: string;
    sourceRoot: string;
    repoName: string;
  } | null;
  open: (state: { workspaceId: string; sourceRoot: string; repoName: string }) => void;
  close: () => void;
}

export const useRepoSetupModalStore = create<RepoSetupModalState>((set) => ({
  modal: null,
  open: (state) => set({ modal: state }),
  close: () => set({ modal: null }),
}));
