import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import type { AccountConnectedServiceView } from "@proliferate/product-ui/account/AccountSettingsPane";

export function buildGitHubAppConnectedServiceView({
  status,
  loading,
  connecting,
  onConnect,
  onManage,
}: {
  status: {
    connected: boolean;
    githubLogin?: string | null;
    status?: string | null;
    action?: string | null;
  } | undefined;
  loading: boolean;
  connecting: boolean;
  onConnect: () => void;
  onManage: () => void;
}): AccountConnectedServiceView {
  const connected = status?.connected === true;
  const needsReconnect = status?.status === "expired"
    || status?.status === "needs_reauth"
    || status?.action === "reauthorize";
  return {
    id: "github-app",
    label: "Proliferate GitHub App",
    description: "Required for Proliferate Cloud repositories.",
    accountLabel: status?.githubLogin ? `@${status.githubLogin}` : null,
    statusLabel: loading
      ? "Checking"
      : connected
        ? "Connected"
        : needsReconnect
          ? "Reconnect"
          : "Not connected",
    tone: connected ? "success" : needsReconnect ? "warning" : "neutral",
    action: connected
      ? {
          label: "Manage GitHub App",
          onClick: () => { void onManage(); },
        }
      : {
          label: connecting
            ? "Opening GitHub..."
            : needsReconnect
              ? "Reconnect GitHub App"
              : "Connect GitHub App",
          icon: <ProviderBrandIcon provider="github" className="size-[13px]" />,
          loading: connecting,
          disabled: connecting,
          onClick: () => { void onConnect(); },
        },
  };
}
