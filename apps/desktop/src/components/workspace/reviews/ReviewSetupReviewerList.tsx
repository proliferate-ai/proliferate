import type { AgentModelGroup } from "@/lib/domain/agents/model-options";
import {
  nextReviewReviewerId,
  reviewerMatchesReviewPersonaTemplate,
  reviewerPersonalityLabel,
  resolveReviewExecutionModeIdForAgent,
  type ReviewPersonaTemplate,
  type ReviewSetupDraft,
} from "@/lib/domain/reviews/review-config";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import {
  Brain,
  Pencil,
  Plus,
  X,
} from "@/components/ui/icons";
import { ReviewModelSettingsMenu } from "./ReviewSetupHarnessControls";

interface ReviewSetupReviewerListProps {
  draft: ReviewSetupDraft;
  modelGroups: AgentModelGroup[];
  personalityTemplates: ReviewPersonaTemplate[];
  modelsLoading: boolean;
  onDraftChange: (draft: ReviewSetupDraft) => void;
  onRemoveReviewer: (index: number) => void;
  onManagePersonalities: () => void;
  canAddReviewer: boolean;
  isSubmitting: boolean;
  onAddReviewer: () => void;
}

export function ReviewSetupReviewerList({
  draft,
  modelGroups,
  personalityTemplates,
  modelsLoading,
  onDraftChange,
  onRemoveReviewer,
  onManagePersonalities,
  canAddReviewer,
  isSubmitting,
  onAddReviewer,
}: ReviewSetupReviewerListProps) {
  const hasInvalidReviewer = draft.reviewers.some((reviewer) => (
    !reviewerHasRequiredFields(reviewer)
  ));

  return (
    <section className="min-w-0">
      <div className="overflow-hidden rounded-lg border border-border/70">
        {draft.reviewers.map((reviewer, index) => {
          return (
            <div
              key={reviewer.id}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-2 py-2 ${
                index > 0 ? "border-t border-border/60" : ""
              }`}
            >
              <div className="min-w-0 space-y-1">
                <ReviewPersonalitySettingsMenu
                  reviewer={reviewer}
                  reviewerIndex={index}
                  reviewers={draft.reviewers}
                  templates={personalityTemplates}
                  onSelect={(template) => {
                    onDraftChange(updateReviewer(draft, index, {
                      id: nextReviewReviewerId(template.id, draft.reviewers, index),
                      label: template.label,
                      prompt: template.prompt,
                    }));
                  }}
                  onManagePersonalities={onManagePersonalities}
                />
                <ReviewModelSettingsMenu
                  reviewer={reviewer}
                  modelGroups={modelGroups}
                  modelsLoading={modelsLoading}
                  className="h-7 w-full min-w-0 bg-transparent px-2 text-xs font-normal text-muted-foreground hover:bg-foreground/5 data-[state=open]:bg-foreground/5"
                  onSelect={(group, model) => {
                    onDraftChange(updateReviewer(draft, index, {
                      agentKind: group.kind,
                      modelId: model.modelId,
                      modeId: resolveReviewExecutionModeIdForAgent(group.kind, reviewer.modeId),
                    }));
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${reviewer.label || `reviewer ${index + 1}`}`}
                onClick={() => onRemoveReviewer(index)}
                className="size-7 px-0 text-muted-foreground"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canAddReviewer || isSubmitting}
          onClick={onAddReviewer}
          className="h-9 w-full justify-start gap-2 rounded-none border-t border-border/60 px-3 text-sm text-muted-foreground hover:bg-muted/40"
        >
          <Plus className="size-3.5" />
          Add reviewer
        </Button>
      </div>
      {hasInvalidReviewer && (
        <div className="mt-2 truncate text-xs text-destructive">
          Choose a personality and model for each reviewer.
        </div>
      )}
    </section>
  );
}

function ReviewPersonalitySettingsMenu({
  reviewer,
  reviewerIndex,
  reviewers,
  templates,
  onSelect,
  onManagePersonalities,
}: {
  reviewer: ReviewSetupDraft["reviewers"][number];
  reviewerIndex: number;
  reviewers: ReviewSetupDraft["reviewers"];
  templates: ReviewPersonaTemplate[];
  onSelect: (template: ReviewPersonaTemplate) => void;
  onManagePersonalities: () => void;
}) {
  return (
    <SettingsMenu
      label={reviewerPersonalityLabel(templates, reviewer) || `Reviewer ${reviewerIndex + 1}`}
      leading={<Brain className="size-4 text-muted-foreground" />}
      className="w-full min-w-0"
      menuClassName="w-80"
      groups={[
        {
          id: "personalities",
          options: templates.map((template) => ({
            id: template.id,
            label: template.label,
            detail: template.prompt,
            icon: <Brain className="size-3.5" />,
            selected: reviewerMatchesReviewPersonaTemplate(
              reviewer,
              template,
              reviewers,
              reviewerIndex,
            ),
            onSelect: () => onSelect(template),
          })),
        },
        {
          id: "manage",
          options: [{
            id: "manage-personalities",
            label: "Create or edit personalities",
            detail: "Opens Settings → Review",
            icon: <Pencil className="size-3.5" />,
            onSelect: onManagePersonalities,
          }],
        },
      ]}
    />
  );
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

function updateReviewer(
  draft: ReviewSetupDraft,
  index: number,
  patch: Partial<ReviewSetupDraft["reviewers"][number]>,
): ReviewSetupDraft {
  return {
    ...draft,
    reviewers: draft.reviewers.map((reviewer, reviewerIndex) => (
      reviewerIndex === index ? { ...reviewer, ...patch } : reviewer
    )),
  };
}
