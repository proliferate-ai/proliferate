import { useEffect, type ReactNode } from "react";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { useAuthViewer } from "@proliferate/cloud-sdk-react";

import { useAuthToken } from "../../providers/WebCloudProvider";
import { AuthLoadingScreen } from "./screen/AuthLoadingScreen";
import { AuthScreen } from "./screen/AuthScreen";
import { ConnectGitHubScreen } from "./screen/ConnectGitHubScreen";

export function AuthGate({ children }: { children: ReactNode }) {
  const { token, clearToken } = useAuthToken();
  const viewer = useAuthViewer(Boolean(token));
  const authError = viewer.error instanceof ProliferateClientError ? viewer.error : null;
  const invalidToken = authError?.status === 401 || authError?.status === 403;

  useEffect(() => {
    if (invalidToken) {
      clearToken();
    }
  }, [clearToken, invalidToken]);

  if (!token) {
    return <AuthScreen />;
  }

  if (viewer.isLoading) {
    return <AuthLoadingScreen />;
  }

  if (invalidToken) {
    return <AuthLoadingScreen />;
  }

  if (viewer.error) {
    return <AuthScreen />;
  }

  if (!viewer.data?.githubConnected) {
    return <ConnectGitHubScreen />;
  }

  return children;
}
