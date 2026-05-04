import type { ReviewKind } from "@anyharness/sdk";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import { SessionControlIcon } from "@/components/session-controls/SessionControlIcon";
import {
  Brain,
  Plus,
  ProviderIcon,
  RefreshCw,
  Sparkles,
  X,
} from "@/components/ui/icons";
import type { AgentModelGroup } from "@/lib/domain/agents/model-options";
import {
  listConfiguredSessionControlValues,
  resolveConfiguredSessionControlValue,
} from "@/lib/domain/chat/session-mode-control";
import {
  clampRounds,
  DEFAULT_REVIEW_MAX_ROUNDS,
  MAX_REVIEW_ROUNDS,
  MAX_REVIEWERS_PER_RUN,
  findReviewPersonaTemplateForReviewer,
  isBuiltInReviewPersonaId,
  nextReviewReviewerId,
  resolveReviewExecutionModeIdForAgent,
  type ReviewPersonaTemplate,
  type ReviewSetupReviewerDraft,
  type StoredReviewKindDefaults,
} from "@/lib/domain/reviews/review-config";

interface ReviewDefaultsSectionProps {
  kind: ReviewKind;
  title: string;
  description: string;
  separated: boolean;
  defaults: StoredReviewKindDefaults | null;
  personalityTemplates: ReviewPersonaTemplate[];
  modelGroups: AgentModelGroup[];
  modelsLoading: boolean;
  onChange: (
    updater: (current: StoredReviewKindDefaults | null) => StoredReviewKindDefaults | null,
  ) => void;
}

export function ReviewDefaultsSection({
  kind,
  title,
  description,
  separated,
  defaults,
  personalityTemplates,
  modelGroups,
  modelsLoading,
  onChange,
}: ReviewDefaultsSectionProps) {
  const effective = defaults ?? createDefaultReviewDefaults();
  const reviewerRows = resolveDefaultReviewerRows(kind, effective, personalityTemplates);
  const reviewersLabel = defaults === null
    ? "Unset, uses built-in reviewers"
    : effective.reviewers.mode === "inherit"
      ? "Built-in reviewers"
      : `${effective.reviewers.items.length} custom ${
        effective.reviewers.items.length === 1 ? "reviewer" : "reviewers"
      }`;

  const update = (patch: Partial<StoredReviewKindDefaults>) => {
    onChange((current) => ({
      ...createDefaultReviewDefaults(),
      ...current,
      ...patch,
    }));
  };
  const updateReviewerRows = (items: ReviewSetupReviewerDraft[]) => {
    const firstReviewer = items[0] ?? null;
    update({
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
    const template = nextAvailablePersonaTemplate(personalityTemplates, reviewerRows);
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
    <section className={`space-y-2 ${separated ? "border-t border-border/60 pt-5" : ""}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {defaults ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(() => null)}>
            <RefreshCw className="size-3.5" />
            Reset
          </Button>
        ) : null}
      </div>

      <SettingsCard>
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
              onClick={() => update({
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
              onClick={() => update({
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

        <SettingsCardRow
          label="Max rounds"
          description={`One-click launches use ${DEFAULT_REVIEW_MAX_ROUNDS} rounds unless overridden.`}
        >
          <Input
            type="number"
            min={1}
            max={MAX_REVIEW_ROUNDS}
            value={effective.maxRounds}
            className="w-24"
            onChange={(event) => {
              const nextValue = event.target.valueAsNumber;
              update({
                maxRounds: Number.isFinite(nextValue)
                  ? clampRounds(nextValue)
                  : DEFAULT_REVIEW_MAX_ROUNDS,
              });
            }}
          />
        </SettingsCardRow>

        <SettingsCardRow
          label="Auto iterate"
          description="Automatically send feedback when a review round requests revisions."
        >
          <Label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={effective.autoIterate}
              onChange={(event) => update({ autoIterate: event.target.checked })}
            />
            Enabled
          </Label>
        </SettingsCardRow>
      </SettingsCard>
    </section>
  );
}

function ReviewDefaultPersonalityMenu({
  reviewer,
  reviewerIndex,
  reviewers,
  personalityTemplates,
  onSelect,
}: {
  reviewer: ReviewSetupReviewerDraft;
  reviewerIndex: number;
  reviewers: ReviewSetupReviewerDraft[];
  personalityTemplates: ReviewPersonaTemplate[];
  onSelect: (template: ReviewPersonaTemplate) => void;
}) {
  return (
    <SettingsMenu
      label={personalityLabel(personalityTemplates, reviewer) || `Reviewer ${reviewerIndex + 1}`}
      leading={<Brain className="size-3.5 text-muted-foreground" />}
      className="w-full min-w-0"
      menuClassName="w-80"
      groups={[{
        id: "personalities",
        options: personalityTemplates.map((template) => ({
          id: template.id,
          label: template.label,
          detail: template.prompt,
          icon: <Brain className="size-3.5" />,
          selected: reviewerMatchesTemplate(reviewer, template, reviewers, reviewerIndex),
          onSelect: () => onSelect(template),
        })),
      }]}
    />
  );
}

function ReviewDefaultModelMenu({
  reviewer,
  modelGroups,
  modelsLoading,
  onSelect,
  onInherit,
}: {
  reviewer: ReviewSetupReviewerDraft;
  modelGroups: AgentModelGroup[];
  modelsLoading: boolean;
  onSelect: (group: AgentModelGroup, modelId: string) => void;
  onInherit: () => void;
}) {
  const selected = selectedDefaultModel(modelGroups, reviewer);
  const hasStoredSelection = !!reviewer.agentKind || !!reviewer.modelId;
  const label = selected
    ? `${selected.group.providerDisplayName} · ${selected.model.displayName}`
    : modelsLoading
      ? "Loading models"
      : hasStoredSelection
        ? "Saved model unavailable"
        : "Active session model";
  const leading = selected
    ? <ProviderIcon kind={selected.group.kind} className="size-3.5" />
    : <Sparkles className="size-3.5 text-muted-foreground" />;

  return (
    <SettingsMenu
      label={label}
      leading={leading}
      className="w-full min-w-0"
      menuClassName="w-80"
      groups={[
        {
          id: "inherit",
          options: [{
            id: "inherit-active-session-model",
            label: "Active session model",
            detail: "Use the parent session agent and model",
            icon: <Sparkles className="size-3.5" />,
            selected: !reviewer.agentKind && !reviewer.modelId,
            onSelect: onInherit,
          }],
        },
        ...modelGroups.map((group) => ({
          id: group.kind,
          label: group.providerDisplayName,
          options: group.models.map((model) => ({
            id: `${group.kind}:${model.modelId}`,
            label: model.displayName,
            detail: model.description,
            icon: <ProviderIcon kind={group.kind} className="size-3.5" />,
            selected: reviewer.agentKind === group.kind && reviewer.modelId === model.modelId,
            onSelect: () => onSelect(group, model.modelId),
          })),
        })),
      ]}
    />
  );
}

function ReviewDefaultModeMenu({
  reviewer,
  onSelect,
  onInherit,
}: {
  reviewer: ReviewSetupReviewerDraft;
  onSelect: (modeId: string) => void;
  onInherit: () => void;
}) {
  const modeOptions = listConfiguredSessionControlValues(reviewer.agentKind, "mode");
  const selectedMode = resolveConfiguredSessionControlValue(
    reviewer.agentKind,
    "mode",
    reviewer.modeId,
  );
  const label = !reviewer.agentKind
    ? "Active session mode"
    : selectedMode
      ? selectedMode.shortLabel ?? selectedMode.label
      : "Default mode";
  const groups = [
    {
      id: "inherit",
      options: [{
        id: "inherit-active-session-mode",
        label: reviewer.agentKind ? "Default mode" : "Active session mode",
        detail: reviewer.agentKind
          ? "Use the active session mode when available"
          : "Choose a model default to customize this",
        icon: <Sparkles className="size-3.5" />,
        selected: !reviewer.modeId,
        onSelect: onInherit,
      }],
    },
    ...(modeOptions.length > 0 ? [{
      id: "modes",
      label: "Modes",
      options: modeOptions.map((mode) => ({
        id: mode.value,
        label: mode.label,
        detail: mode.description,
        icon: <SessionControlIcon icon={mode.icon} className="size-3.5" />,
        selected: reviewer.modeId === mode.value,
        onSelect: () => onSelect(mode.value),
      })),
    }] : []),
  ];

  return (
    <SettingsMenu
      label={label}
      leading={selectedMode
        ? <SessionControlIcon icon={selectedMode.icon} className="size-3.5" />
        : <Sparkles className="size-3.5 text-muted-foreground" />}
      className="w-full min-w-0"
      menuClassName="w-72"
      groups={groups}
    />
  );
}

function selectedDefaultModel(
  modelGroups: AgentModelGroup[],
  reviewer: ReviewSetupReviewerDraft,
): { group: AgentModelGroup; model: AgentModelGroup["models"][number] } | null {
  const group = modelGroups.find((candidate) => candidate.kind === reviewer.agentKind) ?? null;
  const model = group?.models.find((candidate) => candidate.modelId === reviewer.modelId) ?? null;
  return group && model ? { group, model } : null;
}

function resolveDefaultReviewerRows(
  kind: ReviewKind,
  defaults: StoredReviewKindDefaults,
  personalityTemplates: ReviewPersonaTemplate[],
): ReviewSetupReviewerDraft[] {
  if (defaults.reviewers.mode === "custom") {
    return defaults.reviewers.items;
  }

  const builtInTemplates = personalityTemplates.filter((template) =>
    isBuiltInReviewPersonaId(kind, template.id)
  );
  const sourceTemplates = builtInTemplates.length > 0 ? builtInTemplates : personalityTemplates;
  return sourceTemplates.slice(0, 2).map((template) => ({
    id: template.id,
    label: template.label,
    prompt: template.prompt,
    agentKind: defaults.agentKind,
    modelId: defaults.modelId,
    modeId: defaults.modeId,
  }));
}

function nextAvailablePersonaTemplate(
  personalityTemplates: ReviewPersonaTemplate[],
  reviewers: ReviewSetupReviewerDraft[],
): ReviewPersonaTemplate | null {
  return personalityTemplates.find((template) => (
    !reviewers.some((reviewer) => (
      findReviewPersonaTemplateForReviewer([template], reviewer.id) !== null
    ))
  )) ?? personalityTemplates[0] ?? null;
}

function reviewerMatchesTemplate(
  reviewer: ReviewSetupReviewerDraft,
  template: ReviewPersonaTemplate,
  reviewers: ReviewSetupReviewerDraft[],
  reviewerIndex: number,
): boolean {
  return nextReviewReviewerId(template.id, reviewers, reviewerIndex) === reviewer.id
    && reviewer.label === template.label
    && reviewer.prompt === template.prompt;
}

function personalityLabel(
  personalityTemplates: ReviewPersonaTemplate[],
  reviewer: ReviewSetupReviewerDraft,
): string {
  const exact = personalityTemplates.find((template) =>
    findReviewPersonaTemplateForReviewer([template], reviewer.id)
    && reviewer.label === template.label
    && reviewer.prompt === template.prompt
  );
  if (exact) {
    return exact.label;
  }
  const base = findReviewPersonaTemplateForReviewer(personalityTemplates, reviewer.id);
  return base ? `${base.label} edited` : reviewer.label || "Choose personality";
}

function createDefaultReviewDefaults(): StoredReviewKindDefaults {
  return {
    maxRounds: DEFAULT_REVIEW_MAX_ROUNDS,
    autoIterate: true,
    agentKind: "",
    modelId: "",
    modeId: "",
    reviewers: { mode: "inherit" },
  };
}
