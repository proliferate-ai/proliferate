import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Badge } from "@/components/ui/Badge";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import type {
  SlackBotConfig,
  SlackChannel,
  UpdateSlackBotConfigRequest,
} from "@/lib/access/cloud/client";

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
    <section className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-medium text-foreground">Channels</h2>
          <p className="text-sm text-muted-foreground">
            Leave the list empty to let the bot respond in any channel it can read.
          </p>
        </div>
        <Badge tone={allowedChannelIds.length === 0 ? "success" : "accent"}>
          {allowedChannelIds.length === 0
            ? "Any channel"
            : `${allowedChannelIds.length.toLocaleString()} allowed`}
        </Badge>
      </div>
      <SettingsCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Allowed channels</div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {loadingChannels
                ? "Loading Slack channels..."
                : channels.length === 0
                  ? "No channels are available from Slack yet."
                  : "Choose channels for a tighter rollout, or clear the list for any channel."}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || allowedChannelIds.length === 0}
            onClick={() => onUpdateConfig({ allowedSlackChannelIds: [] })}
          >
            Allow any
          </Button>
        </div>
        {channels.map((channel) => {
          const selected = allowedChannelSet.has(channel.id);
          return (
            <label
              key={channel.id}
              className="flex items-start gap-3 border-b border-border/60 p-3 last:border-b-0"
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
                <span className="block text-xs text-muted-foreground">
                  {channel.isArchived
                    ? "Archived"
                    : channel.isPrivate
                      ? "Private channel"
                      : "Public channel"}
                </span>
              </span>
            </label>
          );
        })}
      </SettingsCard>
    </section>
  );
}
