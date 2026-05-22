import { Select } from "@/components/ui/Select";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import type {
  CloudAgentRunConfig,
  SlackBotConfig,
  UpdateSlackBotConfigRequest,
} from "@proliferate/cloud-sdk";

interface AgentOption {
  kind: string;
  displayName: string;
}

interface SessionDefaultsSectionProps {
  config: SlackBotConfig | null;
  agentOptions: AgentOption[];
  agentRunConfigs: CloudAgentRunConfig[];
  loadingConfigs: boolean;
  canManage: boolean;
  saving: boolean;
  onUpdateConfig: (body: UpdateSlackBotConfigRequest) => void;
}

export function SessionDefaultsSection({
  config,
  agentOptions,
  agentRunConfigs,
  loadingConfigs,
  canManage,
  saving,
  onUpdateConfig,
}: SessionDefaultsSectionProps) {
  const selectedAgentKind = config?.defaultAgentKind
    ?? agentOptions[0]?.kind
    ?? "claude";
  const visibleConfigs = agentRunConfigs.filter(
    (agentConfig) => agentConfig.agentKind === selectedAgentKind,
  );
  const selectedConfigId = config?.defaultAgentRunConfigId ?? "";
  const selectedConfig = visibleConfigs.find((agentConfig) => agentConfig.id === selectedConfigId);
  const disabled = !canManage || !config || saving;

  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-foreground">Session defaults</h2>
        <p className="text-sm text-muted-foreground">
          Choose the agent family and shared-sandbox config Slack-created sessions use.
        </p>
      </div>
      <SettingsCard>
        <SettingsCardRow
          label="Default agent"
          description="Slack falls back to the organization default for this agent when no explicit config is selected."
        >
          <Select
            value={selectedAgentKind}
            disabled={disabled || agentOptions.length === 0}
            aria-label="Default Slack agent"
            className="min-w-48"
            onChange={(event) => {
              const nextKind = event.currentTarget.value;
              const currentConfigStillValid = visibleConfigs.some(
                (agentConfig) =>
                  agentConfig.id === selectedConfigId && agentConfig.agentKind === nextKind,
              );
              onUpdateConfig({
                defaultAgentKind: nextKind,
                defaultAgentRunConfigId: currentConfigStillValid ? selectedConfigId : null,
              });
            }}
          >
            {agentOptions.map((agent) => (
              <option key={agent.kind} value={agent.kind}>
                {agent.displayName}
              </option>
            ))}
          </Select>
        </SettingsCardRow>
        <SettingsCardRow
          label={`Default config for ${agentLabel(selectedAgentKind, agentOptions)}`}
          description={selectedConfig
            ? `${selectedConfig.name} uses ${selectedConfig.modelId}.`
            : "No explicit Slack config selected; the server resolver uses the org default, then the system starter preset."}
        >
          <Select
            value={selectedConfigId}
            disabled={disabled || loadingConfigs}
            aria-label="Default Slack agent run config"
            className="min-w-60"
            onChange={(event) => {
              onUpdateConfig({
                defaultAgentRunConfigId: event.currentTarget.value || null,
              });
            }}
          >
            <option value="">
              {loadingConfigs ? "Loading configs..." : "Use resolver default"}
            </option>
            {visibleConfigs.map((agentConfig) => (
              <option key={agentConfig.id} value={agentConfig.id}>
                {agentConfig.name} ({agentConfig.modelId})
              </option>
            ))}
          </Select>
        </SettingsCardRow>
      </SettingsCard>
    </section>
  );
}

function agentLabel(kind: string, options: AgentOption[]): string {
  return options.find((option) => option.kind === kind)?.displayName ?? kind;
}
