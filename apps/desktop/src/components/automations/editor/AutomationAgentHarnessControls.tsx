import { AgentHarnessModelSelector } from "@/components/agents/AgentHarnessModelSelector";
import { SessionConfigControls } from "@/components/workspace/chat/input/SessionConfigControls";
import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";

export function AutomationAgentHarnessControls({
  agents,
  selectedAgent,
  selectedModel,
  controls,
  loading,
  onSelectModel,
}: {
  agents: DesktopAgentLaunchAgent[];
  selectedAgent: DesktopAgentLaunchAgent | null;
  selectedModel: DesktopAgentLaunchModel | null;
  controls: LiveSessionControlDescriptor[];
  loading: boolean;
  onSelectModel: (agent: DesktopAgentLaunchAgent, model: DesktopAgentLaunchModel) => void;
}) {
  const label = selectedAgent && selectedModel
    ? selectedModel.displayName
    : loading
      ? "Loading agents"
      : "Agent harness";

  return (
    <>
      <AgentHarnessModelSelector
        label={label}
        agentKind={selectedAgent?.kind ?? null}
        selectedModelId={selectedModel?.id ?? null}
        disabled={loading || agents.length === 0}
        className="max-w-[16rem]"
        menuClassName="w-80"
        modelGroups={agents.map((agent) => ({
          agentKind: agent.kind,
          agentDisplayName: agent.displayName,
          models: agent.models.map((model) => ({
            id: model.id,
            label: model.displayName,
            detail: agent.displayName,
          })),
        })).filter((group) => group.models.length > 0)}
        onSelectModel={(nextAgentKind, nextModelId) => {
          const nextAgent = agents.find((agent) => agent.kind === nextAgentKind) ?? null;
          const nextModel = nextAgent?.models.find((model) => model.id === nextModelId) ?? null;
          if (nextAgent && nextModel) {
            onSelectModel(nextAgent, nextModel);
          }
        }}
      />
      <SessionConfigControls
        agentKind={selectedAgent?.kind ?? null}
        controls={controls}
      />
    </>
  );
}
