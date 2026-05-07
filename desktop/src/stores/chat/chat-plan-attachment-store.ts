import { create } from "zustand";
import { PLAN_ATTACHMENT_LIMIT } from "@/config/plans";
import type { PromptPlanAttachmentPointer } from "@/lib/domain/chat/composer/prompt-content";

interface ChatPlanAttachmentState {
  attachmentsByWorkspaceId: Record<string, PromptPlanAttachmentPointer[]>;
  addPlanAttachment: (workspaceId: string, plan: PromptPlanAttachmentPointer) => void;
  removePlanAttachment: (workspaceId: string, id: string) => void;
  clearPlanAttachments: (workspaceId: string) => void;
}

export const useChatPlanAttachmentStore = create<ChatPlanAttachmentState>((set) => ({
  attachmentsByWorkspaceId: {},

  addPlanAttachment: (workspaceId, plan) => set((state) => {
    const current = state.attachmentsByWorkspaceId[workspaceId] ?? [];
    const withoutDuplicate = current.filter((candidate) => candidate.id !== plan.id);
    if (withoutDuplicate.length >= PLAN_ATTACHMENT_LIMIT) {
      return state;
    }
    const next = [...withoutDuplicate, plan];
    return {
      attachmentsByWorkspaceId: {
        ...state.attachmentsByWorkspaceId,
        [workspaceId]: next,
      },
    };
  }),

  removePlanAttachment: (workspaceId, id) => set((state) => {
    const current = state.attachmentsByWorkspaceId[workspaceId] ?? [];
    const next = current.filter((candidate) => candidate.id !== id);
    if (next.length === current.length) {
      return state;
    }
    const attachmentsByWorkspaceId = { ...state.attachmentsByWorkspaceId };
    if (next.length === 0) {
      delete attachmentsByWorkspaceId[workspaceId];
    } else {
      attachmentsByWorkspaceId[workspaceId] = next;
    }
    return { attachmentsByWorkspaceId };
  }),

  clearPlanAttachments: (workspaceId) => set((state) => {
    if (!(workspaceId in state.attachmentsByWorkspaceId)) {
      return state;
    }
    const attachmentsByWorkspaceId = { ...state.attachmentsByWorkspaceId };
    delete attachmentsByWorkspaceId[workspaceId];
    return { attachmentsByWorkspaceId };
  }),
}));
