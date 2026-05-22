import { Button } from "@proliferate/ui/primitives/Button";
import { Switch } from "@/components/ui/Switch";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import type {
  SlackBotConfig,
  SlackWorkspaceConnection,
  UpdateSlackBotConfigRequest,
} from "@proliferate/cloud-sdk";
import {
  SlackConnectionStatusBadge,
  SlackEnabledBadge,
} from "@/components/settings/panes/slack/SlackStatusBadge";

interface BotStatusSectionProps {
  connection: SlackWorkspaceConnection | null;
  config: SlackBotConfig | null;
  canManage: boolean;
  saving: boolean;
  validating: boolean;
  onUpdateConfig: (body: UpdateSlackBotConfigRequest) => void;
  onValidate: () => void;
}

export function BotStatusSection({
  connection,
  config,
  canManage,
  saving,
  validating,
  onUpdateConfig,
  onValidate,
}: BotStatusSectionProps) {
  const enabled = config?.enabled ?? false;

  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-foreground">Bot status</h2>
        <p className="text-sm text-muted-foreground">
          Control whether the bot responds to allowed Slack mentions.
        </p>
      </div>
      <SettingsCard>
        <SettingsCardRow
          label="Connection health"
          description={connection?.lastValidatedAt
            ? `Last validated ${formatDate(connection.lastValidatedAt)}.`
            : connection
              ? "Connection has not been validated from this device yet."
              : "Install Slack before validation is available."}
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SlackConnectionStatusBadge status={connection?.status ?? null} />
            <Button
              type="button"
              variant="outline"
              loading={validating}
              disabled={!canManage || !connection}
              onClick={onValidate}
            >
              Validate now
            </Button>
          </div>
        </SettingsCardRow>
        <SettingsCardRow
          label="Respond to mentions"
          description={config
            ? "When enabled, Slack mentions can create shared unclaimed cloud work."
            : "Install Slack before enabling the bot."}
        >
          <div className="flex items-center justify-end gap-2">
            <SlackEnabledBadge enabled={config ? enabled : null} />
            <Switch
              checked={enabled}
              disabled={!canManage || !config || saving}
              aria-label="Enable Slack bot"
              onChange={(nextEnabled) => onUpdateConfig({ enabled: nextEnabled })}
            />
          </div>
        </SettingsCardRow>
      </SettingsCard>
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
