import { create } from "zustand";
import type { ReviewKind } from "@anyharness/sdk";
import type { PromptPlanAttachmentDescriptor } from "@proliferate/product-model/chats/composer/prompt-plan-attachments";

export type ReviewSetupTarget =
  | { kind: "plan"; plan: PromptPlanAttachmentDescriptor }
  | { kind: "code"; parentSessionId: string };

export interface ReviewSetupAnchorRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface ReviewSetupState {
  target: ReviewSetupTarget;
  anchorRect: ReviewSetupAnchorRect | null;
}

export interface ReviewCritiqueTarget {
  reviewRunId: string;
  assignmentId: string;
  personaLabel: string;
}

export interface StartingReviewReviewer {
  id: string;
  label: string;
  agentKind: string;
  modelId: string;
}

export interface StartingReviewState {
  parentSessionId: string;
  kind: ReviewKind;
  maxRounds: number;
  autoIterate: boolean;
  reviewers: StartingReviewReviewer[];
  startedAt: number;
}

export interface StartingReviewToken {
  kind: ReviewKind;
  startedAt: number;
}

interface ReviewUiState {
  setup: ReviewSetupState | null;
  critiqueTarget: ReviewCritiqueTarget | null;
  startingReview: StartingReviewState | null;
  dismissedTerminalNoticeRunIds: string[];
  openSetup: (target: ReviewSetupTarget, anchorRect?: ReviewSetupAnchorRect | null) => void;
  closeSetup: () => void;
  beginStartingReview: (startingReview: StartingReviewState) => void;
  clearStartingReview: () => void;
  clearStartingReviewForToken: (token: StartingReviewToken) => boolean;
  patchStartingReviewParentSession: (
    token: StartingReviewToken,
    parentSessionId: string,
  ) => boolean;
  openCritique: (target: ReviewCritiqueTarget) => void;
  closeCritique: () => void;
  dismissTerminalNotice: (runId: string) => void;
}

const DISMISSED_TERMINAL_NOTICE_RUN_LIMIT = 50;

export const useReviewUiStore = create<ReviewUiState>((set) => ({
  setup: null,
  critiqueTarget: null,
  startingReview: null,
  dismissedTerminalNoticeRunIds: [],
  openSetup: (target, anchorRect = null) => set({ setup: { target, anchorRect } }),
  closeSetup: () => set({ setup: null }),
  beginStartingReview: (startingReview) => set({ startingReview }),
  clearStartingReview: () => set({ startingReview: null }),
  clearStartingReviewForToken: (token) => {
    let cleared = false;
    set((state) => {
      if (!matchesStartingReviewToken(state.startingReview, token)) {
        return state;
      }
      cleared = true;
      return { startingReview: null };
    });
    return cleared;
  },
  patchStartingReviewParentSession: (token, parentSessionId) => {
    let patched = false;
    set((state) => {
      if (!matchesStartingReviewToken(state.startingReview, token)) {
        return state;
      }
      patched = true;
      return {
        startingReview: {
          ...state.startingReview,
          parentSessionId,
        },
      };
    });
    return patched;
  },
  openCritique: (target) => set({ critiqueTarget: target }),
  closeCritique: () => set({ critiqueTarget: null }),
  // Dismissal is intentionally app-lifetime-only; terminal review notices can
  // reappear after reload because the authoritative run state stays on the server.
  dismissTerminalNotice: (runId) =>
    set((state) => ({
      dismissedTerminalNoticeRunIds: [
        runId,
        ...state.dismissedTerminalNoticeRunIds.filter((id) => id !== runId),
      ].slice(0, DISMISSED_TERMINAL_NOTICE_RUN_LIMIT),
    })),
}));

function matchesStartingReviewToken(
  startingReview: StartingReviewState | null,
  token: StartingReviewToken,
): startingReview is StartingReviewState {
  return !!startingReview
    && startingReview.kind === token.kind
    && startingReview.startedAt === token.startedAt;
}
