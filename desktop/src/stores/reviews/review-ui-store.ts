import { create } from "zustand";
import type { ReviewKind } from "@anyharness/sdk";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/prompt-content";

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
  autoSendFeedback: boolean;
  reviewers: StartingReviewReviewer[];
  startedAt: number;
}

interface ReviewUiState {
  setup: ReviewSetupState | null;
  critiqueTarget: ReviewCritiqueTarget | null;
  startingReview: StartingReviewState | null;
  dismissedTerminalRunIds: string[];
  openSetup: (target: ReviewSetupTarget, anchorRect?: ReviewSetupAnchorRect | null) => void;
  closeSetup: () => void;
  beginStartingReview: (startingReview: StartingReviewState) => void;
  clearStartingReview: () => void;
  openCritique: (target: ReviewCritiqueTarget) => void;
  closeCritique: () => void;
  dismissTerminalRun: (runId: string) => void;
}

const DISMISSED_TERMINAL_RUN_LIMIT = 50;

export const useReviewUiStore = create<ReviewUiState>((set) => ({
  setup: null,
  critiqueTarget: null,
  startingReview: null,
  dismissedTerminalRunIds: [],
  openSetup: (target, anchorRect = null) => set({ setup: { target, anchorRect } }),
  closeSetup: () => set({ setup: null }),
  beginStartingReview: (startingReview) => set({ startingReview }),
  clearStartingReview: () => set({ startingReview: null }),
  openCritique: (target) => set({ critiqueTarget: target }),
  closeCritique: () => set({ critiqueTarget: null }),
  // Dismissal is intentionally app-lifetime-only; terminal review cards can
  // reappear after reload because the authoritative run state stays on the server.
  dismissTerminalRun: (runId) =>
    set((state) => ({
      dismissedTerminalRunIds: [
        runId,
        ...state.dismissedTerminalRunIds.filter((id) => id !== runId),
      ].slice(0, DISMISSED_TERMINAL_RUN_LIMIT),
    })),
}));
