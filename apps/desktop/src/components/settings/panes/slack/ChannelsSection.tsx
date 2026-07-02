import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Label } from "@proliferate/ui/primitives/Label";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import type {
  SlackBotConfig,
  SlackChannel,
  UpdateSlackBotConfigRequest,
} from "@proliferate/cloud-sdk";

interface ChannelsSectionProps {
  config: SlackBotConfig | null;
  channels: SlackChannel[];
  loadingChannels: boolean;
  canManage: boolean;
  saving: boolean;
  onUpdateConfig: (body: UpdateSlackBotConfigRequest) => void;
}

export function ChannelsSection({
  config,
  channels,
  loadingChannels,
  canManage,
  saving,
  onUpdateConfig,
}: ChannelsSectionProps) {
  const allowedChannelIds = config?.allowedSlackChannelIds ?? [];
  const allowedChannelSet = new Set(allowedChannelIds);
  const disabled = !canManage || !config || saving;

  return (
    <SettingsSection
      title="Channels"
      description="Leave the list empty to let the bot respond in any channel it can read."
    >
      <SettingsRow
        label="Allowed channels"
        description={loadingChannels
          ? "Loading Slack channels…"
          : channels.length === 0
            ? "No channels are available from Slack yet."
            : "Choose channels for a tighter rollout, or clear the list for any channel."}
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tone={allowedChannelIds.length === 0 ? "success" : "accent"}>
            {allowedChannelIds.length === 0
              ? "Any channel"
              : `${allowedChannelIds.length.toLocaleString()} allowed`}
          </Badge>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || allowedChannelIds.length === 0}
            onClick={() => onUpdateConfig({ allowedSlackChannelIds: [] })}
          >
            Allow any
          </Button>
        </div>
      </SettingsRow>
      {channels.map((channel) => {
        const selected = allowedChannelSet.has(channel.id);
        return (
          <Label
            key={channel.id}
            className="mb-0 flex items-start gap-3 border-t border-border py-3 first:border-t-0"
          >
            <Checkbox
              checked={selected}
              disabled={disabled || channel.isArchived}
              onChange={(event) => {
                const nextIds = event.currentTarget.checked
                  ? [...allowedChannelIds, channel.id]
                  : allowedChannelIds.filter((id) => id !== channel.id);
                onUpdateConfig({ allowedSlackChannelIds: nextIds });
              }}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                #{channel.name}
              </span>
              <span className="block text-sm text-muted-foreground">
                {channel.isArchived
                  ? "Archived"
                  : channel.isPrivate
                    ? "Private channel"
                    : "Public channel"}
              </span>
            </span>
          </Label>
        );
      })}
    </SettingsSection>
  );
}
