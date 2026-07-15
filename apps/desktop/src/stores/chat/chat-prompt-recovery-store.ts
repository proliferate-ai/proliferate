import { create } from "zustand";
import type {
  PromptOutboxEntry,
} from "@proliferate/product-domain/sessions/intents/session-intent-model";

export interface ChatPromptRecovery {
  id: string;
  workspaceId: string;
  agentKind: string;
  modelId: string;
  modeId: string | null;
  errorMessage: string;
  prompt: PromptOutboxEntry;
}

interface ChatPromptRecoveryState {
  recoveriesByWorkspaceUiKey: Record<string, ChatPromptRecovery[]>;
  addRecoveries: (workspaceUiKey: string, recoveries: readonly ChatPromptRecovery[]) => void;
  removeRecovery: (workspaceUiKey: string, recoveryId: string) => void;
  clear: () => void;
}

export const useChatPromptRecoveryStore = create<ChatPromptRecoveryState>((set) => ({
  recoveriesByWorkspaceUiKey: {},

  addRecoveries: (workspaceUiKey, recoveries) => set((state) => {
    if (recoveries.length === 0) {
      return state;
    }
    const incomingIds = new Set(recoveries.map((entry) => entry.id));
    const current = state.recoveriesByWorkspaceUiKey[workspaceUiKey] ?? [];
    return {
      recoveriesByWorkspaceUiKey: {
        ...state.recoveriesByWorkspaceUiKey,
        [workspaceUiKey]: [
          ...current.filter((entry) => !incomingIds.has(entry.id)),
          ...recoveries.map(cloneRecovery),
        ],
      },
    };
  }),

  removeRecovery: (workspaceUiKey, recoveryId) => set((state) => {
    const current = state.recoveriesByWorkspaceUiKey[workspaceUiKey] ?? [];
    const next = current.filter((entry) => entry.id !== recoveryId);
    if (next.length === current.length) {
      return state;
    }
    const recoveriesByWorkspaceUiKey = { ...state.recoveriesByWorkspaceUiKey };
    if (next.length === 0) {
      delete recoveriesByWorkspaceUiKey[workspaceUiKey];
    } else {
      recoveriesByWorkspaceUiKey[workspaceUiKey] = next;
    }
    return { recoveriesByWorkspaceUiKey };
  }),

  clear: () => set({ recoveriesByWorkspaceUiKey: {} }),
}));

function cloneRecovery(recovery: ChatPromptRecovery): ChatPromptRecovery {
  return {
    ...recovery,
    prompt: {
      ...recovery.prompt,
      blocks: recovery.prompt.blocks.map((block) => ({ ...block })),
      attachmentSnapshots: recovery.prompt.attachmentSnapshots.map((snapshot) => ({ ...snapshot })),
      contentParts: recovery.prompt.contentParts.map((part) => ({ ...part })),
    },
  };
}
