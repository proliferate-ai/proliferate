import { create } from "zustand";
import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import type { LaunchProjectionControlValues } from "@/stores/chat/launch-projection-override-store";

export type PendingWorkspaceQueuedPromptStatus = "pending" | "consuming" | "failed" | "done";

export interface PendingWorkspaceQueuedPrompt {
  id: string;
  attemptId: string;
  status: PendingWorkspaceQueuedPromptStatus;
  workspaceId: string | null;
  sessionId: string | null;
  agentKind: string;
  modelId: string;
  modeId: string | null;
  controlValues: LaunchProjectionControlValues;
  text: string;
  blocks: PromptInputBlock[];
  optimisticContentParts?: ContentPart[];
  promptId: string;
  draftKey: string;
  materializedDraftKey: string | null;
  createdAt: number;
  errorMessage: string | null;
}

interface PendingWorkspaceQueuedPromptState {
  queuedPrompts: Record<string, PendingWorkspaceQueuedPrompt>;
  enqueue: (prompt: PendingWorkspaceQueuedPrompt) => void;
  markMaterialized: (
    attemptId: string,
    materialized: { workspaceId: string; sessionId?: string | null; draftKey?: string | null },
  ) => void;
  markConsuming: (id: string) => boolean;
  markPending: (id: string) => void;
  markFailed: (id: string, errorMessage: string) => void;
  clear: (id: string) => void;
  clearForAttempt: (attemptId: string) => void;
}

export function pendingWorkspaceQueuedPromptId(attemptId: string): string {
  return `pending-workspace:${attemptId}`;
}

export const usePendingWorkspaceQueuedPromptStore =
  create<PendingWorkspaceQueuedPromptState>((set) => ({
    queuedPrompts: {},

    enqueue: (prompt) => set((state) => ({
      queuedPrompts: {
        ...state.queuedPrompts,
        [prompt.id]: prompt,
      },
    })),

    markMaterialized: (attemptId, materialized) => set((state) => {
      let changed = false;
      const queuedPrompts = Object.fromEntries(
        Object.entries(state.queuedPrompts).map(([id, prompt]) => {
          if (prompt.attemptId !== attemptId) {
            return [id, prompt] as const;
          }
          changed = true;
          return [id, {
            ...prompt,
            workspaceId: materialized.workspaceId,
            sessionId: materialized.sessionId ?? prompt.sessionId,
            materializedDraftKey: materialized.draftKey ?? prompt.materializedDraftKey,
          }] as const;
        }),
      );
      return changed ? { queuedPrompts } : state;
    }),

    markConsuming: (id) => {
      let didMark = false;
      set((state) => {
        const prompt = state.queuedPrompts[id];
        if (!prompt || prompt.status !== "pending" || !prompt.workspaceId) {
          return state;
        }
        didMark = true;
        return {
          queuedPrompts: {
            ...state.queuedPrompts,
            [id]: {
              ...prompt,
              status: "consuming",
              errorMessage: null,
            },
          },
        };
      });
      return didMark;
    },

    markPending: (id) => set((state) => {
      const prompt = state.queuedPrompts[id];
      if (!prompt) {
        return state;
      }
      return {
        queuedPrompts: {
          ...state.queuedPrompts,
          [id]: {
            ...prompt,
            status: "pending",
          },
        },
      };
    }),

    markFailed: (id, errorMessage) => set((state) => {
      const prompt = state.queuedPrompts[id];
      if (!prompt) {
        return state;
      }
      return {
        queuedPrompts: {
          ...state.queuedPrompts,
          [id]: {
            ...prompt,
            status: "failed",
            errorMessage,
          },
        },
      };
    }),

    clear: (id) => set((state) => {
      if (!state.queuedPrompts[id]) {
        return state;
      }
      const { [id]: _removed, ...queuedPrompts } = state.queuedPrompts;
      return { queuedPrompts };
    }),

    clearForAttempt: (attemptId) => set((state) => {
      let changed = false;
      const queuedPrompts = Object.fromEntries(
        Object.entries(state.queuedPrompts).filter(([, prompt]) => {
          const keep = prompt.attemptId !== attemptId;
          if (!keep) {
            changed = true;
          }
          return keep;
        }),
      );
      return changed ? { queuedPrompts } : state;
    }),
  }));
