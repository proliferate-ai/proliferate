import { create } from "zustand";
import type {
  ChatLaunchIntent,
  ChatLaunchIntentFailure,
} from "@/lib/domain/chat/launch-intent";

interface ChatLaunchIntentState {
  activeIntent: ChatLaunchIntent | null;
  begin: (intent: ChatLaunchIntent) => void;
  clearIfActive: (intentId: string) => void;
  failIfActive: (
    intentId: string,
    failure: Omit<ChatLaunchIntentFailure, "failedAt">,
  ) => void;
  markMaterializedIfActive: (
    intentId: string,
    materialized: {
      clientSessionId?: string | null;
      workspaceId?: string | null;
      sessionId?: string | null;
    },
  ) => void;
  markSendAttemptedIfActive: (intentId: string) => void;
}

export const useChatLaunchIntentStore = create<ChatLaunchIntentState>((set) => ({
  activeIntent: null,

  begin: (intent) => set({
    activeIntent: intent,
  }),

  clearIfActive: (intentId) => set((state) => {
    if (state.activeIntent?.id !== intentId) {
      return state;
    }

    return {
      activeIntent: null,
    };
  }),

  failIfActive: (intentId, failure) => set((state) => {
    if (state.activeIntent?.id !== intentId) {
      return state;
    }

    return {
      activeIntent: {
        ...state.activeIntent,
        failure: {
          ...failure,
          failedAt: Date.now(),
        },
      },
    };
  }),

  markMaterializedIfActive: (intentId, materialized) => set((state) => {
    if (state.activeIntent?.id !== intentId) {
      return state;
    }

    return {
      activeIntent: {
        ...state.activeIntent,
        clientSessionId:
          materialized.clientSessionId !== undefined
            ? materialized.clientSessionId
            : state.activeIntent.clientSessionId,
        materializedWorkspaceId:
          materialized.workspaceId !== undefined
            ? materialized.workspaceId
            : state.activeIntent.materializedWorkspaceId,
        materializedSessionId:
          materialized.sessionId !== undefined
            ? materialized.sessionId
            : state.activeIntent.materializedSessionId,
      },
    };
  }),

  markSendAttemptedIfActive: (intentId) => set((state) => {
    if (state.activeIntent?.id !== intentId) {
      return state;
    }

    return {
      activeIntent: {
        ...state.activeIntent,
        sendAttemptedAt: state.activeIntent.sendAttemptedAt ?? Date.now(),
      },
    };
  }),
}));
