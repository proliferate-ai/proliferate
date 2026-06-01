import { useState } from "react";

import { setPasswordCredential, type AuthProviderName } from "@proliferate/cloud-sdk";
import { useAuthViewer } from "@proliferate/cloud-sdk-react";
import type { AccountPasswordCredentialSubmit } from "@proliferate/product-ui/account/AccountSettingsPane";

import { startWebAuthFlow } from "../../../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../../../providers/WebCloudProvider";

export function useWebAccountSettingsActions() {
  const viewer = useAuthViewer();
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

  return {
    viewer: viewer.data,
    loadingProvider,
    error,
    connectGitHub: () => void startProvider("github", "required_github_link"),
    connectGoogle: () => void startProvider("google"),
    connectApple: () => void startProvider("apple"),
    setPassword,
    signOut: () => void signOut(),
  };
}
