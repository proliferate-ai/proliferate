import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { SlackWorkspaceConnectionStatus } from "@proliferate/cloud-sdk";

const CONNECTION_STATUS_LABELS: Record<SlackWorkspaceConnectionStatus, string> = {
  active: "Connected",
  reauth_required: "Reconnect required",
  revoked: "Disconnected",
};

const CONNECTION_STATUS_TONES: Record<SlackWorkspaceConnectionStatus, BadgeTone> = {
  active: "success",
  reauth_required: "warning",
  revoked: "destructive",
};

export function SlackConnectionStatusBadge({
  status,
}: {
  status: SlackWorkspaceConnectionStatus | null;
}) {
  if (!status) {
    return <Badge>Not installed</Badge>;
  }

  return (
    <Badge tone={CONNECTION_STATUS_TONES[status]}>
      {CONNECTION_STATUS_LABELS[status]}
    </Badge>
  );
}

export function SlackEnabledBadge({ enabled }: { enabled: boolean | null }) {
  if (enabled === null) {
    return <Badge>Not configured</Badge>;
  }

  return (
    <Badge tone={enabled ? "success" : "warning"}>
      {enabled ? "Enabled" : "Paused"}
    </Badge>
  );
}
