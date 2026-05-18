import type { ReactNode } from "react";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { useAuthViewer } from "@proliferate/cloud-sdk-react";

import { useAuthToken } from "../../providers/WebCloudProvider";
import { AuthLoadingScreen } from "./screen/AuthLoadingScreen";
import { AuthScreen } from "./screen/AuthScreen";
import { ConnectGitHubScreen } from "./screen/ConnectGitHubScreen";

export function AuthGate({ children }: { children: ReactNode }) {
  const { token } = useAuthToken();
  const viewer = useAuthViewer(Boolean(token));

  if (!token) {
    return <AuthScreen />;
  }

  if (viewer.isLoading) {
    return <AuthLoadingScreen />;
  }

  if (viewer.error) {
    if (viewer.error instanceof ProliferateClientError) {
      return <AuthScreen />;
    }
    return <AuthScreen />;
  }

  if (!viewer.data?.githubConnected) {
    return <ConnectGitHubScreen />;
  }

  return children;
}
