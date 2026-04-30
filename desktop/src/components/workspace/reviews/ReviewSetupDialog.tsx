import { useEffect, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { AgentModelGroup } from "@/lib/domain/agents/model-options";
import {
  createReviewSetupReviewerDraft,
  MAX_REVIEWERS_PER_RUN,
  type ReviewPersonaTemplate,
  type ReviewSessionDefaults,
  type ReviewSetupDraft,
} from "@/lib/domain/reviews/review-config";
import { Button } from "@/components/ui/Button";
import { FixedPositionLayer } from "@/components/ui/layout/FixedPositionLayer";
import type { ReviewSetupAnchorRect } from "@/stores/reviews/review-ui-store";
import { ReviewSetupLoopControls } from "./ReviewSetupLoopControls";
import { ReviewSetupReviewerList } from "./ReviewSetupReviewerList";

interface ReviewSetupDialogProps {
  open: boolean;
  title: string;
  draft: ReviewSetupDraft | null;
  sessionDefaults: ReviewSessionDefaults | null;
  modelGroups: AgentModelGroup[];
  personalityTemplates: ReviewPersonaTemplate[];
  anchorRect: ReviewSetupAnchorRect | null;
  modelsLoading: boolean;
  validationError: string | null;
  isSubmitting: boolean;
  onDraftChange: (draft: ReviewSetupDraft) => void;
  onSubmit: () => void;
  onClose: () => void;
  onManagePersonalities: () => void;
}

export function ReviewSetupDialog({
  open,
  title,
  draft,
  sessionDefaults,
  modelGroups,
  personalityTemplates,
  anchorRect,
  modelsLoading,
  validationError,
  isSubmitting,
  onDraftChange,
  onSubmit,
  onClose,
  onManagePersonalities,
}: ReviewSetupDialogProps) {
  const reviewerCount = draft?.reviewers.length ?? 0;
  const hasInvalidReviewer = draft?.reviewers.some((reviewer) => (
    !reviewerHasRequiredFields(reviewer)
  )) ?? false;
  const maxRounds = draft?.maxRounds ?? 1;
  const estimatedSessions = reviewerCount * maxRounds;
  const isSubmitDisabled = !draft || reviewerCount === 0 || hasInvalidReviewer;
  const templates = draft ? personalityTemplates : [];
  const popoverLayout = resolvePopoverLayout(anchorRect);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, onClose, open]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitDisabled || isSubmitting) {
      return;
    }
    onSubmit();
  };

  const handleAddReviewer = () => {
    if (!draft || !sessionDefaults || draft.reviewers.length >= MAX_REVIEWERS_PER_RUN) {
      return;
    }
    const reviewer = createReviewSetupReviewerDraft({
      kind: draft.kind,
      sessionDefaults,
      existingReviewers: draft.reviewers,
      personalityTemplates: templates,
    });
    if (!reviewer) {
      return;
    }
    onDraftChange({
      ...draft,
      reviewers: [...draft.reviewers, reviewer],
    });
  };

  const handleRemoveReviewer = (index: number) => {
    if (!draft) {
      return;
    }
    const nextReviewers = draft.reviewers.filter((_, reviewerIndex) => reviewerIndex !== index);
    onDraftChange({ ...draft, reviewers: nextReviewers });
  };

  if (!open) {
    return null;
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 bg-transparent"
        onClick={isSubmitting ? undefined : onClose}
      />
      <FixedPositionLayer
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed z-50 w-[min(31rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-floating"
        position={popoverLayout.position}
        onClick={(event) => event.stopPropagation()}
      >
        {!draft ? (
          <div className="p-3">
            <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
              Select a live parent session before starting a review.
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-col"
            style={{ maxHeight: popoverLayout.maxHeight }}
          >
            <ReviewSetupLoopControls
              draft={draft}
              reviewerCount={reviewerCount}
              estimatedSessions={estimatedSessions}
              onDraftChange={onDraftChange}
            />

            {validationError && (
              <div className="mx-3 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {validationError}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <ReviewSetupReviewerList
                draft={draft}
                modelGroups={modelGroups}
                personalityTemplates={templates}
                modelsLoading={modelsLoading}
                canAddReviewer={!!sessionDefaults && draft.reviewers.length < MAX_REVIEWERS_PER_RUN}
                onAddReviewer={handleAddReviewer}
                onDraftChange={onDraftChange}
                onRemoveReviewer={handleRemoveReviewer}
                onManagePersonalities={onManagePersonalities}
              />
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 px-3 py-3">
              <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={isSubmitDisabled}>
                Start review
              </Button>
            </div>
          </form>
        )}
      </FixedPositionLayer>
    </>,
    document.body,
  );
}

interface ReviewSetupPopoverLayout {
  position: Partial<Pick<CSSProperties, "top" | "right" | "bottom" | "left">>;
  maxHeight: number;
}

function resolvePopoverLayout(anchorRect: ReviewSetupAnchorRect | null): ReviewSetupPopoverLayout {
  if (typeof window === "undefined") {
    return {
      position: { top: 0, left: 0 },
      maxHeight: 608,
    };
  }
  const viewportMargin = 8;
  const anchorOffset = 8;
  const width = Math.min(496, window.innerWidth - viewportMargin * 2);
  const desiredHeight = Math.min(608, window.innerHeight - viewportMargin * 2);
  if (!anchorRect) {
    return {
      position: {
        top: Math.max(viewportMargin, (window.innerHeight - desiredHeight) / 2),
        left: Math.max(viewportMargin, (window.innerWidth - width) / 2),
      },
      maxHeight: desiredHeight,
    };
  }

  const preferredLeft = anchorRect.right - width;
  const left = Math.min(
    Math.max(viewportMargin, preferredLeft),
    Math.max(viewportMargin, window.innerWidth - width - viewportMargin),
  );
  const roomAbove = anchorRect.top - viewportMargin - anchorOffset;
  const roomBelow = window.innerHeight - anchorRect.bottom - viewportMargin - anchorOffset;
  const shouldOpenAbove = roomBelow < desiredHeight && roomAbove > 0;

  if (shouldOpenAbove) {
    return {
      position: {
        bottom: Math.max(viewportMargin, window.innerHeight - anchorRect.top + anchorOffset),
        left,
      },
      maxHeight: Math.max(0, roomAbove),
    };
  }

  const top = Math.max(viewportMargin, anchorRect.bottom + anchorOffset);
  return {
    position: { top, left },
    maxHeight: Math.max(0, roomBelow),
  };
}

function reviewerHasRequiredFields(
  reviewer: ReviewSetupDraft["reviewers"][number],
): boolean {
  return !!reviewer.label.trim()
    && !!reviewer.prompt.trim()
    && !!reviewer.agentKind.trim()
    && !!reviewer.modelId.trim()
    && !!reviewer.modeId.trim();
}
