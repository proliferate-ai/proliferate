import { create } from "zustand";
import type {
  ChatLaunchIntent,
  ChatLaunchIntentFailure,
} from "#product/lib/domain/chat/launch/launch-intent";
import {
  EMPTY_CHAT_LAUNCH_INTENT_REGISTRY,
  patchLaunchIntent,
  removeLaunchIntent,
  upsertLaunchIntent,
} from "#product/lib/domain/chat/launch/launch-intent-registry";

interface ChatLaunchIntentState {
  intentsById: Record<string, ChatLaunchIntent>;
  intentOrder: string[];
  begin: (intent: ChatLaunchIntent) => void;
  clear: (intentId: string) => void;
  fail: (
    intentId: string,
    failure: Omit<ChatLaunchIntentFailure, "failedAt">,
  ) => void;
  markMaterialized: (
    intentId: string,
    materialized: {
      clientSessionId?: string | null;
      workspaceId?: string | null;
      sessionId?: string | null;
      attemptId?: string | null;
    },
  ) => void;
  markSendAttempted: (intentId: string) => void;
}

/**
 * Launch intents keyed by id. Every mutator targets one intent by id and a
 * missing id is a no-op, so a second Home submit can neither clobber the first
 * intent nor turn its later mutations into silent no-ops (PRO-230).
 */
export const useChatLaunchIntentStore = create<ChatLaunchIntentState>((set) => ({
  intentsById: EMPTY_CHAT_LAUNCH_INTENT_REGISTRY.intentsById,
  intentOrder: EMPTY_CHAT_LAUNCH_INTENT_REGISTRY.intentOrder,

  begin: (intent) => set((state) => upsertLaunchIntent(state, intent)),

  clear: (intentId) => set((state) => removeLaunchIntent(state, intentId)),

  fail: (intentId, failure) => set((state) =>
    patchLaunchIntent(state, intentId, {
      failure: {
        ...failure,
        failedAt: Date.now(),
      },
    })
  ),

  markMaterialized: (intentId, materialized) => set((state) => {
    const intent = state.intentsById[intentId];
    if (!intent) {
      return state;
    }
    return patchLaunchIntent(state, intentId, {
      clientSessionId:
        materialized.clientSessionId !== undefined
          ? materialized.clientSessionId
          : intent.clientSessionId,
      materializedWorkspaceId:
        materialized.workspaceId !== undefined
          ? materialized.workspaceId
          : intent.materializedWorkspaceId,
      materializedSessionId:
        materialized.sessionId !== undefined
          ? materialized.sessionId
          : intent.materializedSessionId,
      attemptId:
        materialized.attemptId !== undefined
          ? materialized.attemptId
          : intent.attemptId,
    });
  }),

  markSendAttempted: (intentId) => set((state) => {
    const intent = state.intentsById[intentId];
    if (!intent) {
      return state;
    }
    return patchLaunchIntent(state, intentId, {
      sendAttemptedAt: intent.sendAttemptedAt ?? Date.now(),
    });
  }),
}));
