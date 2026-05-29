import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import type { SlackWorkspaceConnection } from "@proliferate/cloud-sdk";
import { SlackConnectionStatusBadge } from "@/components/settings/panes/slack/SlackStatusBadge";

interface ConnectionSectionProps {
  connection: SlackWorkspaceConnection | null;
  loading: boolean;
  canManage: boolean;
  opening: boolean;
  disconnecting: boolean;
  onOpenOAuth: () => void;
  onDisconnect: () => void;
}

export function ConnectionSection({
  connection,
  loading,
  canManage,
  opening,
  disconnecting,
  onOpenOAuth,
  onDisconnect,
}: ConnectionSectionProps) {
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const installedBy = [
    connection?.installedByDisplayName,
    connection?.installedByEmail,
  ].filter(Boolean).join(" / ");
  const installLabel = connection ? "Reconnect" : "Install Slack";

  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-foreground">Connection</h2>
        <p className="text-sm text-muted-foreground">
          Connect one Slack workspace to this organization.
        </p>
      </div>
      <SettingsCard>
        <SettingsCardRow
          label={connection?.slackTeamName ?? "Slack workspace"}
          description={connection
            ? `Installed ${formatDate(connection.installedAt)}${installedBy ? ` by ${installedBy}` : ""}.`
            : loading
              ? "Checking Slack installation..."
              : "Install the bot to enable Slack mentions for this organization."}
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SlackConnectionStatusBadge status={connection?.status ?? null} />
            <Button
              type="button"
              variant="secondary"
              loading={opening}
              disabled={!canManage}
              onClick={onOpenOAuth}
            >
              {installLabel}
            </Button>
          </div>
        </SettingsCardRow>
        {connection ? (
          <SettingsCardRow
            label="Disconnect"
            description="Disconnecting revokes this organization connection and stops new Slack-triggered work."
          >
            <Button
              type="button"
              variant="destructive"
              loading={disconnecting}
              disabled={!canManage}
              onClick={() => setConfirmDisconnectOpen(true)}
            >
              Disconnect
            </Button>
          </SettingsCardRow>
        ) : null}
      </SettingsCard>
      <ConfirmationDialog
        open={confirmDisconnectOpen}
        title="Disconnect Slack?"
        description="Slack mentions will stop creating new work for this organization until an admin reconnects the bot."
        confirmLabel="Disconnect"
        confirmVariant="destructive"
        onClose={() => setConfirmDisconnectOpen(false)}
        onConfirm={() => {
          setConfirmDisconnectOpen(false);
          onDisconnect();
        }}
      />
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
