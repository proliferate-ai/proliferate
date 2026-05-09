import { SessionControlIcon } from "@/components/session-controls/SessionControlIcon";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import {
  Brain,
  ProviderIcon,
  Sparkles,
} from "@/components/ui/icons";
import type { AgentModelGroup } from "@/lib/domain/agents/model-options";
import {
  listConfiguredSessionControlValues,
  resolveConfiguredSessionControlValue,
} from "@/lib/domain/chat/session-controls/session-mode-control";
import {
  reviewerMatchesReviewPersonaTemplate,
  reviewerPersonalityLabel,
  type ReviewPersonaTemplate,
  type ReviewSetupReviewerDraft,
} from "@/lib/domain/reviews/review-config";

export function ReviewDefaultPersonalityMenu({
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
      label={reviewerPersonalityLabel(personalityTemplates, reviewer) || `Reviewer ${reviewerIndex + 1}`}
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
          selected: reviewerMatchesReviewPersonaTemplate(
            reviewer,
            template,
            reviewers,
            reviewerIndex,
          ),
          onSelect: () => onSelect(template),
        })),
      }]}
    />
  );
}

export function ReviewDefaultModelMenu({
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

export function ReviewDefaultModeMenu({
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
