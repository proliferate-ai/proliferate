import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
import { filterVisibleLaunchModels } from "@/lib/domain/chat/models/model-visibility";
import type { ModelSelectorSelection } from "@/lib/domain/chat/models/model-selector-types";
import type { ChatModelVisibilityOverridesByAgentKind } from "@/lib/domain/preferences/user/session-defaults";

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
      selectedModelId: selected?.kind === agent.kind ? selected.modelId : null,
      overrides: visibilityOverrides ?? {},
    }),
  };
}
