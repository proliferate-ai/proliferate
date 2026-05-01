import type { AgentModelGroup } from "@/lib/domain/agents/model-options";
import {
  findReviewPersonaTemplateForReviewer,
  nextReviewReviewerId,
  resolveReviewExecutionModeIdForAgent,
  type ReviewPersonaTemplate,
  type ReviewSetupDraft,
} from "@/lib/domain/reviews/review-config";
import { Button } from "@/components/ui/Button";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import {
  Brain,
  CircleAlert,
  Pencil,
  Plus,
  X,
} from "@/components/ui/icons";
import {
  ReviewModelSettingsMenu,
  reviewerModelLabel,
} from "./ReviewSetupHarnessControls";

interface ReviewSetupReviewerListProps {
  draft: ReviewSetupDraft;
  modelGroups: AgentModelGroup[];
  personalityTemplates: ReviewPersonaTemplate[];
  modelsLoading: boolean;
  canAddReviewer: boolean;
  onAddReviewer: () => void;
  onDraftChange: (draft: ReviewSetupDraft) => void;
  onRemoveReviewer: (index: number) => void;
  onManagePersonalities: () => void;
}

export function ReviewSetupReviewerList({
  draft,
  modelGroups,
  personalityTemplates,
  modelsLoading,
  canAddReviewer,
  onAddReviewer,
  onDraftChange,
  onRemoveReviewer,
  onManagePersonalities,
}: ReviewSetupReviewerListProps) {
  return (
    <section className="min-w-0">
      <div className="flex shrink-0 items-center justify-between gap-2 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Brain className="size-3.5 text-muted-foreground" />
            Reviewers
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canAddReviewer}
          onClick={onAddReviewer}
          className="h-7 px-2"
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
      <div className="divide-y divide-border/50 border-y border-border/50">
        {draft.reviewers.map((reviewer, index) => {
          const isValid = reviewerHasRequiredFields(reviewer);
          const modelLabel = reviewerModelLabel(modelGroups, reviewer);
          return (
            <div
              key={reviewer.id}
              className="group/reviewer py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    Reviewer {index + 1}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {modelLabel}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!isValid && (
                    <CircleAlert className="size-3.5 text-destructive" />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${reviewer.label || `reviewer ${index + 1}`}`}
                    className="opacity-0 transition-opacity group-hover/reviewer:opacity-100"
                    onClick={() => onRemoveReviewer(index)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
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
                  onSelect={(group, model) => {
                    onDraftChange(updateReviewer(draft, index, {
                      agentKind: group.kind,
                      modelId: model.modelId,
                      modeId: resolveReviewExecutionModeIdForAgent(group.kind, reviewer.modeId),
                    }));
                  }}
                />
              </div>

              {!isValid && (
                <div className="mt-2 text-xs text-destructive">
                  Choose a personality and model before starting.
                </div>
              )}
            </div>
          );
        })}
      </div>
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
      label={personalityLabel(templates, reviewer) || `Reviewer ${reviewerIndex + 1}`}
      leading={<Brain className="size-4 text-muted-foreground" />}
      className="w-full"
      menuClassName="w-80"
      groups={[
        {
          id: "personalities",
          options: templates.map((template) => ({
            id: template.id,
            label: template.label,
            detail: template.prompt,
            icon: <Brain className="size-3.5" />,
            selected: reviewerMatchesTemplate(reviewer, template, reviewers, reviewerIndex),
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

function reviewerMatchesTemplate(
  reviewer: ReviewSetupDraft["reviewers"][number],
  template: ReviewPersonaTemplate,
  reviewers: ReviewSetupDraft["reviewers"],
  reviewerIndex: number,
): boolean {
  return nextReviewReviewerId(template.id, reviewers, reviewerIndex) === reviewer.id
    && reviewer.label === template.label
    && reviewer.prompt === template.prompt;
}

function personalityLabel(
  templates: ReviewPersonaTemplate[],
  reviewer: ReviewSetupDraft["reviewers"][number],
): string {
  const exact = templates.find((template) =>
    findReviewPersonaTemplateForReviewer([template], reviewer.id)
    && reviewer.label === template.label
    && reviewer.prompt === template.prompt
  );
  if (exact) {
    return exact.label;
  }
  const base = findReviewPersonaTemplateForReviewer(templates, reviewer.id);
  return base ? `${base.label} edited` : reviewer.label || "Choose personality";
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
