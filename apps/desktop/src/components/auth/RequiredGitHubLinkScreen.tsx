import {
  AUTH_REQUIRED_GITHUB_COPY,
  authProviderPresentation,
} from "@proliferate/product-domain/auth/presentation";
import { ConnectGitHubRequiredPanel } from "@proliferate/product-ui/auth/ConnectGitHubRequiredPanel";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { ProliferateMark } from "@proliferate/product-ui/brand/ProliferateMark";

import { useRequiredGitHubLink } from "@/hooks/auth/workflows/use-required-github-link";

export function RequiredGitHubLinkScreen() {
  const { connect, error, loading, logout } = useRequiredGitHubLink();
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
      onConnect={() => void connect()}
      onSignOut={() => void logout()}
    />
  );
}
