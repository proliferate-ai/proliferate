import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { AgentHarnessConfigComposer } from "@/components/settings/shared/AgentHarnessConfigComposer";
import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type {
  LiveSessionControlDescriptor,
} from "@/lib/domain/chat/session-controls/session-controls";
import type {
  SlackBotConfig,
} from "@proliferate/cloud-sdk";

interface SessionDefaultsSectionProps {
  config: SlackBotConfig | null;
  agents: DesktopAgentLaunchAgent[];
  selectedAgent: DesktopAgentLaunchAgent | null;
  selectedModel: DesktopAgentLaunchModel | null;
  controls: LiveSessionControlDescriptor[];
  loading: boolean;
  canManage: boolean;
  saving: boolean;
  onSelectModel: (agentKind: string, modelId: string) => void;
  onSave: () => void;
}

export function SessionDefaultsSection({
  config,
  agents,
  selectedAgent,
  selectedModel,
  controls,
  loading,
  canManage,
  saving,
  onSelectModel,
  onSave,
}: SessionDefaultsSectionProps) {
  const disabled = !canManage || !config || saving || loading;

  return (
    <SettingsSection
      title="Session defaults"
      description="Configure the agent, model, and modes Slack-created sessions use."
    >
      <AgentHarnessConfigComposer
        agentKind={selectedAgent?.kind ?? null}
        agentDisplayName={selectedAgent?.displayName ?? null}
        selectedModelId={selectedModel?.id ?? null}
        selectedModelLabel={selectedModel?.displayName ?? null}
        modelGroups={agents.map((agent) => ({
          agentKind: agent.kind,
          agentDisplayName: agent.displayName,
          models: agent.models.map((model) => ({
            id: model.id,
            label: model.displayName,
            detail: model.description ?? model.id,
          })),
        }))}
        controls={controls}
        disabled={disabled}
        saving={saving}
        actionLabel="Save defaults"
        placeholder="Slack mentions create sessions with these defaults"
        onSelectModel={onSelectModel}
        onAction={onSave}
      />
    </SettingsSection>
  );
}
