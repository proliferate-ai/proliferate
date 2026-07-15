import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import type { AccountConnectedServiceView } from "@proliferate/product-ui/account/AccountSettingsPane";

export function buildGitHubAppUserAuthorizationServiceView({
  status,
  loading,
  authorizing,
  onAuthorize,
  onManage,
}: {
  status: {
    connected: boolean;
    githubLogin?: string | null;
    status?: string | null;
    action?: string | null;
  } | undefined;
  loading: boolean;
  authorizing: boolean;
  onAuthorize: () => void;
  onManage: () => void;
}): AccountConnectedServiceView {
  const connected = status?.connected === true;
  const needsReconnect = status?.status === "expired"
    || status?.status === "needs_reauth"
    || status?.action === "reauthorize";
  return {
    id: "github-app-user-authorization",
    label: "GitHub App user authorization",
    description: "Authorizes Proliferate Cloud to use your GitHub identity in managed sandboxes.",
    accountLabel: status?.githubLogin ? `@${status.githubLogin}` : null,
    statusLabel: loading
      ? "Checking…"
      : connected
        ? "Authorized"
        : needsReconnect
          ? "Needs reauthorization"
          : "Not authorized",
    tone: connected ? "success" : needsReconnect ? "warning" : "neutral",
    action: connected
      ? {
          label: "Manage in GitHub",
          onClick: () => { void onManage(); },
        }
      : {
          label: authorizing
            ? "Opening GitHub…"
            : needsReconnect
              ? "Reauthorize GitHub App"
              : "Authorize GitHub App",
          icon: <ProviderBrandIcon provider="github" className="size-[13px]" />,
          loading: authorizing,
          disabled: authorizing,
          onClick: () => { void onAuthorize(); },
        },
  };
}
