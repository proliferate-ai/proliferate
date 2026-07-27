import { create } from "zustand";
import type {
  CloudWorkspaceBillingBlock,
} from "#product/lib/access/cloud/workspace-connection-retry";

interface CloudWorkspaceBillingBlockState {
  blocksByWorkspaceId: Record<string, CloudWorkspaceBillingBlock>;
  setBillingBlock: (
    workspaceId: string,
    block: CloudWorkspaceBillingBlock,
  ) => void;
  clearBillingBlock: (workspaceId: string) => void;
}

export const useCloudWorkspaceBillingBlockStore =
  create<CloudWorkspaceBillingBlockState>((set) => ({
    blocksByWorkspaceId: {},
    setBillingBlock: (workspaceId, block) => set((state) => ({
      blocksByWorkspaceId: {
        ...state.blocksByWorkspaceId,
        [workspaceId]: block,
      },
    })),
    clearBillingBlock: (workspaceId) => set((state) => {
      if (!(workspaceId in state.blocksByWorkspaceId)) {
        return state;
      }
      const blocksByWorkspaceId = { ...state.blocksByWorkspaceId };
      delete blocksByWorkspaceId[workspaceId];
      return { blocksByWorkspaceId };
    }),
  }));
