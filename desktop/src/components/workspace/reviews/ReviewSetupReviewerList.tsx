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
  Pencil,
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
}

export function ReviewSetupReviewerList({
  draft,
  modelGroups,
  personalityTemplates,
  modelsLoading,
  onDraftChange,
  onRemoveReviewer,
  onManagePersonalities,
}: ReviewSetupReviewerListProps) {
  const hasInvalidReviewer = draft.reviewers.some((reviewer) => (
    !reviewerHasRequiredFields(reviewer)
  ));

  return (
    <section className="min-w-0">
      <div className="space-y-2">
        {draft.reviewers.map((reviewer, index) => {
          return (
            <div
              key={reviewer.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
            >
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
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${reviewer.label || `reviewer ${index + 1}`}`}
                onClick={() => onRemoveReviewer(index)}
                className="h-9 w-9 px-0"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          );
        })}
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
      label={personalityLabel(templates, reviewer) || `Reviewer ${reviewerIndex + 1}`}
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
