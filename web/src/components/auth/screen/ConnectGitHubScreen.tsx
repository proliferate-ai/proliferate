import { useState } from "react";

import {
  AUTH_REQUIRED_GITHUB_COPY,
  authProviderPresentation,
} from "@proliferate/product-model/auth/presentation";
import { ConnectGitHubRequiredPanel } from "@proliferate/product-ui/auth/ConnectGitHubRequiredPanel";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { ProliferateMark } from "@proliferate/product-ui/brand/ProliferateMark";

import { startWebAuthFlow } from "../../../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../../../providers/WebCloudProvider";

export function ConnectGitHubScreen() {
  const { token, clearToken } = useAuthToken();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connectGitHub() {
    if (!token || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await startWebAuthFlow({
        provider: "github",
        purpose: "required_github_link",
        accessToken: token,
      });
    } catch (connectError) {
      setLoading(false);
      setError(
        connectError instanceof Error
          ? connectError.message
          : "GitHub linking could not start.",
      );
    }
  }

  return (
    <ConnectGitHubRequiredPanel
      mark={<ProliferateMark size={32} />}
      title={AUTH_REQUIRED_GITHUB_COPY.title}
      subtitle={AUTH_REQUIRED_GITHUB_COPY.subtitle}
      footer={<span className="block text-faint">{AUTH_REQUIRED_GITHUB_COPY.footer}</span>}
      actionIcon={<ProviderBrandIcon provider="github" />}
      actionLabel={authProviderPresentation("github").actionLabel}
      loading={loading}
      error={error}
      onConnect={() => void connectGitHub()}
      onSignOut={() => void clearToken()}
    />
  );
}
