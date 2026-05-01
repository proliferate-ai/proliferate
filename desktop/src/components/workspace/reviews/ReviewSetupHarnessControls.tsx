import type { AgentModelGroup, AgentModelOption } from "@/lib/domain/agents/model-options";
import type { ReviewSetupDraft } from "@/lib/domain/reviews/review-config";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import { ProviderIcon } from "@/components/ui/icons";

type ReviewerDraft = ReviewSetupDraft["reviewers"][number];

export function ReviewModelSettingsMenu({
  reviewer,
  modelGroups,
  modelsLoading,
  onSelect,
}: {
  reviewer: ReviewerDraft;
  modelGroups: AgentModelGroup[];
  modelsLoading: boolean;
  onSelect: (group: AgentModelGroup, model: AgentModelOption) => void;
}) {
  const selectedModel = selectedReviewerModel(modelGroups, reviewer);
  return (
    <SettingsMenu
      label={selectedModel
        ? `${selectedModel.group.providerDisplayName} · ${selectedModel.model.displayName}`
        : modelsLoading ? "Loading models" : "Choose model"}
      leading={<ProviderIcon kind={reviewer.agentKind} className="size-4" />}
      className="w-full min-w-0"
      menuClassName="w-80"
      groups={modelGroups.map((group) => ({
        id: group.kind,
        label: group.providerDisplayName,
        options: group.models.map((model) => ({
          id: `${group.kind}:${model.modelId}`,
          label: model.displayName,
          icon: <ProviderIcon kind={group.kind} className="size-3.5" />,
          selected: group.kind === reviewer.agentKind && model.modelId === reviewer.modelId,
          onSelect: () => onSelect(group, model),
        })),
      }))}
    />
  );
}

function selectedReviewerModel(
  modelGroups: AgentModelGroup[],
  reviewer: ReviewerDraft,
): { group: AgentModelGroup; model: AgentModelOption } | null {
  const group = modelGroups.find((candidate) => candidate.kind === reviewer.agentKind) ?? null;
  const model = group?.models.find((candidate) => candidate.modelId === reviewer.modelId) ?? null;
  return group && model ? { group, model } : null;
}
