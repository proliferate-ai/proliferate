import type { ReviewKind } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  Plus,
  X,
} from "@/components/ui/icons";
import type { AgentModelGroup } from "@/lib/domain/agents/model-options";
import {
  MAX_REVIEWERS_PER_RUN,
  nextAvailableReviewPersonaTemplate,
  nextReviewReviewerId,
  resolveReviewDefaultReviewerRows,
  resolveReviewExecutionModeIdForAgent,
  type ReviewPersonaTemplate,
  type ReviewSetupReviewerDraft,
  type StoredReviewKindDefaults,
} from "@/lib/domain/reviews/review-config";
import {
  ReviewDefaultModeMenu,
  ReviewDefaultModelMenu,
  ReviewDefaultPersonalityMenu,
} from "./ReviewDefaultReviewerMenus";

interface ReviewDefaultReviewerControlsProps {
  kind: ReviewKind;
  defaults: StoredReviewKindDefaults | null;
  effective: StoredReviewKindDefaults;
  personalityTemplates: ReviewPersonaTemplate[];
  modelGroups: AgentModelGroup[];
  modelsLoading: boolean;
  onUpdate: (patch: Partial<StoredReviewKindDefaults>) => void;
}

export function ReviewDefaultReviewerControls({
  kind,
  defaults,
  effective,
  personalityTemplates,
  modelGroups,
  modelsLoading,
  onUpdate,
}: ReviewDefaultReviewerControlsProps) {
  const reviewerRows = resolveReviewDefaultReviewerRows({
    kind,
    defaults: effective,
    personalityTemplates,
  });
  const reviewersLabel = defaults === null
    ? "Unset, uses built-in reviewers"
    : effective.reviewers.mode === "inherit"
      ? "Built-in reviewers"
      : `${effective.reviewers.items.length} custom ${
        effective.reviewers.items.length === 1 ? "reviewer" : "reviewers"
      }`;

  const updateReviewerRows = (items: ReviewSetupReviewerDraft[]) => {
    const firstReviewer = items[0] ?? null;
    onUpdate({
      agentKind: firstReviewer?.agentKind.trim() ?? "",
      modelId: firstReviewer?.modelId.trim() ?? "",
      modeId: firstReviewer?.modeId.trim() ?? "",
      reviewers: { mode: "custom", items: items.slice(0, MAX_REVIEWERS_PER_RUN) },
    });
  };
  const updateReviewer = (
    index: number,
    patch: Partial<ReviewSetupReviewerDraft>,
  ) => {
    updateReviewerRows(reviewerRows.map((reviewer, reviewerIndex) => (
      reviewerIndex === index ? { ...reviewer, ...patch } : reviewer
    )));
  };
  const addReviewer = () => {
    const template = nextAvailableReviewPersonaTemplate(personalityTemplates, reviewerRows);
    if (!template || reviewerRows.length >= MAX_REVIEWERS_PER_RUN) {
      return;
    }
    updateReviewerRows([
      ...reviewerRows,
      {
        id: nextReviewReviewerId(template.id, reviewerRows),
        label: template.label,
        prompt: template.prompt,
        agentKind: "",
        modelId: "",
        modeId: "",
      },
    ]);
  };
  const removeReviewer = (index: number) => {
    updateReviewerRows(reviewerRows.filter((_, reviewerIndex) => reviewerIndex !== index));
  };

  return (
    <div className="space-y-3 p-3">
      <div className="flex min-w-0 items-start justify-between gap-6">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-medium">Reviewer defaults</div>
          <div className="text-sm text-muted-foreground">
            Personality, harness, model, and mode for one-click review.
          </div>
        </div>
        <div className="shrink-0 text-xs text-muted-foreground">{reviewersLabel}</div>
      </div>

      <div className="space-y-2" data-telemetry-mask>
        {reviewerRows.length > 0 ? (
          reviewerRows.map((reviewer, index) => (
            <div
              key={`${reviewer.id}-${index}`}
              className="grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.72fr)_auto]"
            >
              <ReviewDefaultPersonalityMenu
                reviewer={reviewer}
                reviewerIndex={index}
                reviewers={reviewerRows}
                personalityTemplates={personalityTemplates}
                onSelect={(template) => updateReviewer(index, {
                  id: nextReviewReviewerId(template.id, reviewerRows, index),
                  label: template.label,
                  prompt: template.prompt,
                })}
              />
              <ReviewDefaultModelMenu
                reviewer={reviewer}
                modelGroups={modelGroups}
                modelsLoading={modelsLoading}
                onSelect={(group, modelId) => updateReviewer(index, {
                  agentKind: group.kind,
                  modelId,
                  modeId: resolveReviewExecutionModeIdForAgent(group.kind, reviewer.modeId),
                })}
                onInherit={() => updateReviewer(index, {
                  agentKind: "",
                  modelId: "",
                  modeId: "",
                })}
              />
              <ReviewDefaultModeMenu
                reviewer={reviewer}
                onSelect={(modeId) => updateReviewer(index, { modeId })}
                onInherit={() => updateReviewer(index, { modeId: "" })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${reviewer.label || `reviewer ${index + 1}`}`}
                className="h-9 w-9 px-0"
                onClick={() => removeReviewer(index)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-border bg-foreground/5 px-3 py-2 text-sm text-muted-foreground">
            One-click review will open configuration until reviewers are saved.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={reviewerRows.length >= MAX_REVIEWERS_PER_RUN || personalityTemplates.length === 0}
          onClick={addReviewer}
        >
          <Plus className="size-3.5" />
          Add reviewer
        </Button>
        <Button
          type="button"
          variant={effective.reviewers.mode === "inherit" ? "secondary" : "outline"}
          size="sm"
          onClick={() => onUpdate({
            agentKind: "",
            modelId: "",
            modeId: "",
            reviewers: { mode: "inherit" },
          })}
        >
          Use built-ins
        </Button>
        <Button
          type="button"
          variant={effective.reviewers.mode === "custom" && effective.reviewers.items.length === 0
            ? "secondary"
            : "outline"}
          size="sm"
          onClick={() => onUpdate({
            agentKind: "",
            modelId: "",
            modeId: "",
            reviewers: { mode: "custom", items: [] },
          })}
        >
          Require config
        </Button>
      </div>
    </div>
  );
}
