import { useState } from "react";

import { setPasswordCredential, type AuthProviderName } from "@proliferate/cloud-sdk";
import {
  useAuthViewer,
  useGitHubAppUserAuthorizationStatus,
  useStartGitHubAppUserAuthorization,
} from "@proliferate/cloud-sdk-react";
import type { AccountPasswordCredentialSubmit } from "@proliferate/product-ui/account/AccountSettingsPane";

import { startWebAuthFlow } from "../../../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../../../providers/WebCloudProvider";

export function useWebAccountSettingsActions() {
  const viewer = useAuthViewer();
  const githubAppUserAuthorization = useGitHubAppUserAuthorizationStatus(
    Boolean(viewer.data),
    viewer.data?.user?.id ? `web-account:${viewer.data.user.id}` : "web-account:anonymous",
  );
  const githubAppUserAuthorizationStart = useStartGitHubAppUserAuthorization();
  const { token, clearToken } = useAuthToken();
  const [loadingProvider, setLoadingProvider] = useState<AuthProviderName | "sign-out" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startProvider(
    provider: AuthProviderName,
    purpose: "link" | "required_github_link" = "link",
  ) {
    if (loadingProvider || !token) {
      return;
    }
    setError(null);
    setLoadingProvider(provider);
    try {
      await startWebAuthFlow({
        provider,
        purpose,
        accessToken: token,
      });
    } catch (authError) {
      setLoadingProvider(null);
      setError(authError instanceof Error ? authError.message : "Provider linking could not start.");
    }
  }

  async function signOut() {
    setLoadingProvider("sign-out");
    try {
      await clearToken();
    } finally {
      setLoadingProvider(null);
    }
  }

  async function setPassword(input: AccountPasswordCredentialSubmit) {
    if (!token) {
      throw new Error("Sign in before changing password.");
    }
    await setPasswordCredential({
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });
    await viewer.refetch();
  }

  async function authorizeGitHubAppUser() {
    if (!token) {
      return;
    }
    setError(null);
    try {
      const response = await githubAppUserAuthorizationStart.mutateAsync();
      window.location.assign(response.authorizationUrl);
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : "GitHub App authorization could not start.",
      );
    }
  }

  function manageGitHubApp() {
    window.open("https://github.com/settings/installations", "_blank", "noopener,noreferrer");
  }

  return {
    viewer: viewer.data,
    githubAppUserAuthorization: githubAppUserAuthorization.data,
    githubAppUserAuthorizationLoading: githubAppUserAuthorization.isLoading,
    githubAppUserAuthorizing: githubAppUserAuthorizationStart.isPending,
    loadingProvider,
    error,
    connectGitHub: () => void startProvider("github", "required_github_link"),
    authorizeGitHubAppUser: () => void authorizeGitHubAppUser(),
    manageGitHubApp,
    connectGoogle: () => void startProvider("google"),
    connectApple: () => void startProvider("apple"),
    setPassword,
    signOut: () => void signOut(),
  };
}
