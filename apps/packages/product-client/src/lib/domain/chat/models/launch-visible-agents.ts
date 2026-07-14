import type { DesktopAgentLaunchAgent } from "#product/lib/domain/agents/cloud-launch-catalog";
import { filterVisibleLaunchModels } from "#product/lib/domain/chat/models/model-visibility";
import { selectedModelIdForVisibility } from "#product/lib/domain/chat/models/model-selection-ids";
import type { ModelSelectorSelection } from "#product/lib/domain/chat/models/model-selector-types";
import type { ChatModelVisibilityOverridesByAgentKind } from "#product/lib/domain/preferences/user/session-defaults";

export function agentsWithVisibleModels(
  agents: readonly DesktopAgentLaunchAgent[],
  {
    selected,
    visibilityOverrides,
  }: {
    selected: ModelSelectorSelection | null;
    visibilityOverrides?: ChatModelVisibilityOverridesByAgentKind;
  },
): DesktopAgentLaunchAgent[] {
  return agents
    .map((agent) => agentWithVisibleModels(agent, { selected, visibilityOverrides }))
    .filter((agent) => agent.models.length > 0);
}

export function agentWithVisibleModels(
  agent: DesktopAgentLaunchAgent,
  {
    selected,
    visibilityOverrides,
  }: {
    selected: ModelSelectorSelection | null;
    visibilityOverrides?: ChatModelVisibilityOverridesByAgentKind;
  },
): DesktopAgentLaunchAgent {
  return {
    ...agent,
    models: filterVisibleLaunchModels({
      agent,
      selectedModelId: selected?.kind === agent.kind
        ? selectedModelIdForVisibility(agent.kind, selected.modelId)
        : null,
      overrides: visibilityOverrides ?? {},
    }),
  };
}
