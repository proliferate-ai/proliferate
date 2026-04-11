import { create } from "zustand";

interface PendingCoworkThreadState {
  tempId: string;
}

interface AppSurfaceState {
  selectedArtifactIdByWorkspace: Record<string, string | null>;
  pendingCoworkThread: PendingCoworkThreadState | null;
  setSelectedArtifactId: (workspaceId: string, artifactId: string | null) => void;
  setPendingCoworkThread: (state: PendingCoworkThreadState | null) => void;
}

export const useAppSurfaceStore = create<AppSurfaceState>((set) => ({
  selectedArtifactIdByWorkspace: {},
  pendingCoworkThread: null,
  setSelectedArtifactId: (workspaceId, artifactId) =>
    set((state) => ({
      selectedArtifactIdByWorkspace: {
        ...state.selectedArtifactIdByWorkspace,
        [workspaceId]: artifactId,
      },
    })),
  setPendingCoworkThread: (pendingCoworkThread) => set({ pendingCoworkThread }),
}));
