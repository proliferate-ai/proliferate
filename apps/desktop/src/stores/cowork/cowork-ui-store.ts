import { create } from "zustand";

interface CoworkUiState {
  artifactPanelOpenByWorkspaceId: Record<string, true>;
  selectedArtifactIdByWorkspaceId: Record<string, string>;
  setArtifactPanelOpen: (workspaceId: string, open: boolean) => void;
  setSelectedArtifactId: (workspaceId: string, artifactId: string | null) => void;
}

export const useCoworkUiStore = create<CoworkUiState>((set) => ({
  artifactPanelOpenByWorkspaceId: {},
  selectedArtifactIdByWorkspaceId: {},

  setArtifactPanelOpen: (workspaceId, open) => {
    set((current) => {
      const isOpen = current.artifactPanelOpenByWorkspaceId[workspaceId] === true;
      if (open === isOpen) {
        return current;
      }

      if (open) {
        return {
          artifactPanelOpenByWorkspaceId: {
            ...current.artifactPanelOpenByWorkspaceId,
            [workspaceId]: true,
          },
        };
      }

      const next = { ...current.artifactPanelOpenByWorkspaceId };
      delete next[workspaceId];
      return { artifactPanelOpenByWorkspaceId: next };
    });
  },

  setSelectedArtifactId: (workspaceId, artifactId) => {
    set((current) => {
      const existing = current.selectedArtifactIdByWorkspaceId[workspaceId] ?? null;
      if (existing === artifactId) {
        return current;
      }

      if (artifactId) {
        return {
          selectedArtifactIdByWorkspaceId: {
            ...current.selectedArtifactIdByWorkspaceId,
            [workspaceId]: artifactId,
          },
        };
      }

      const next = { ...current.selectedArtifactIdByWorkspaceId };
      delete next[workspaceId];
      return { selectedArtifactIdByWorkspaceId: next };
    });
  },
}));
