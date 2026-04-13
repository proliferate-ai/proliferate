import type { WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import type { CloudWorkspaceMobilityPreflightResponse } from "@/lib/integrations/cloud/client";
import { create } from "zustand";

export type WorkspaceMobilityDirection = "local_to_cloud" | "cloud_to_local";

export interface WorkspaceMobilityConfirmSnapshot {
  logicalWorkspaceId: string;
  direction: WorkspaceMobilityDirection;
  sourceWorkspaceId: string;
  mobilityWorkspaceId: string;
  sourcePreflight: WorkspaceMobilityPreflightResponse;
  cloudPreflight: CloudWorkspaceMobilityPreflightResponse;
}

interface WorkspaceMobilityUiState {
  confirmSnapshotByLogicalWorkspaceId: Record<string, WorkspaceMobilityConfirmSnapshot>;
  activePromptRequestIdByLogicalWorkspaceId: Record<string, number>;
  showMcpNoticeByLogicalWorkspaceId: Record<string, boolean>;
  dismissedMcpNoticeByLogicalWorkspaceId: Record<string, boolean>;
  setConfirmSnapshot: (snapshot: WorkspaceMobilityConfirmSnapshot) => void;
  clearConfirmSnapshot: (logicalWorkspaceId: string) => void;
  setActivePromptRequestId: (logicalWorkspaceId: string, requestId: number) => void;
  clearActivePromptRequestId: (logicalWorkspaceId: string) => void;
  showMcpNotice: (logicalWorkspaceId: string) => void;
  clearMcpNoticeVisibility: (logicalWorkspaceId: string) => void;
  dismissMcpNotice: (logicalWorkspaceId: string) => void;
  clearMcpNotice: (logicalWorkspaceId: string) => void;
}

export const useWorkspaceMobilityUiStore = create<WorkspaceMobilityUiState>((set) => ({
  confirmSnapshotByLogicalWorkspaceId: {},
  activePromptRequestIdByLogicalWorkspaceId: {},
  showMcpNoticeByLogicalWorkspaceId: {},
  dismissedMcpNoticeByLogicalWorkspaceId: {},

  setConfirmSnapshot: (snapshot) => set((state) => ({
    confirmSnapshotByLogicalWorkspaceId: {
      ...state.confirmSnapshotByLogicalWorkspaceId,
      [snapshot.logicalWorkspaceId]: snapshot,
    },
  })),

  clearConfirmSnapshot: (logicalWorkspaceId) => set((state) => {
    if (!(logicalWorkspaceId in state.confirmSnapshotByLogicalWorkspaceId)) {
      return state;
    }

    const next = { ...state.confirmSnapshotByLogicalWorkspaceId };
    delete next[logicalWorkspaceId];
    return { confirmSnapshotByLogicalWorkspaceId: next };
  }),

  setActivePromptRequestId: (logicalWorkspaceId, requestId) => set((state) => ({
    activePromptRequestIdByLogicalWorkspaceId: {
      ...state.activePromptRequestIdByLogicalWorkspaceId,
      [logicalWorkspaceId]: requestId,
    },
  })),

  clearActivePromptRequestId: (logicalWorkspaceId) => set((state) => {
    if (!(logicalWorkspaceId in state.activePromptRequestIdByLogicalWorkspaceId)) {
      return state;
    }

    const next = { ...state.activePromptRequestIdByLogicalWorkspaceId };
    delete next[logicalWorkspaceId];
    return { activePromptRequestIdByLogicalWorkspaceId: next };
  }),

  showMcpNotice: (logicalWorkspaceId) => set((state) => ({
    showMcpNoticeByLogicalWorkspaceId: {
      ...state.showMcpNoticeByLogicalWorkspaceId,
      [logicalWorkspaceId]: true,
    },
    dismissedMcpNoticeByLogicalWorkspaceId: {
      ...state.dismissedMcpNoticeByLogicalWorkspaceId,
      [logicalWorkspaceId]: false,
    },
  })),

  clearMcpNoticeVisibility: (logicalWorkspaceId) => set((state) => {
    if (!(logicalWorkspaceId in state.showMcpNoticeByLogicalWorkspaceId)) {
      return state;
    }

    const next = { ...state.showMcpNoticeByLogicalWorkspaceId };
    delete next[logicalWorkspaceId];
    return { showMcpNoticeByLogicalWorkspaceId: next };
  }),

  dismissMcpNotice: (logicalWorkspaceId) => set((state) => ({
    showMcpNoticeByLogicalWorkspaceId: {
      ...state.showMcpNoticeByLogicalWorkspaceId,
      [logicalWorkspaceId]: false,
    },
    dismissedMcpNoticeByLogicalWorkspaceId: {
      ...state.dismissedMcpNoticeByLogicalWorkspaceId,
      [logicalWorkspaceId]: true,
    },
  })),

  clearMcpNotice: (logicalWorkspaceId) => set((state) => {
    const hasDismissed = logicalWorkspaceId in state.dismissedMcpNoticeByLogicalWorkspaceId;
    const hasVisible = logicalWorkspaceId in state.showMcpNoticeByLogicalWorkspaceId;
    if (!hasDismissed && !hasVisible) {
      return state;
    }

    const dismissed = { ...state.dismissedMcpNoticeByLogicalWorkspaceId };
    const visible = { ...state.showMcpNoticeByLogicalWorkspaceId };
    delete dismissed[logicalWorkspaceId];
    delete visible[logicalWorkspaceId];
    return {
      dismissedMcpNoticeByLogicalWorkspaceId: dismissed,
      showMcpNoticeByLogicalWorkspaceId: visible,
    };
  }),
}));
