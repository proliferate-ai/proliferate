import { useEffect, type ReactNode } from "react";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { useAuthViewer } from "@proliferate/cloud-sdk-react";

import { useAuthToken } from "../../providers/WebCloudProvider";
import { isWebBetaAuthErrorCode } from "../../lib/domain/auth/web-auth-errors";
import { AuthErrorScreen } from "./screen/AuthErrorScreen";
import { AuthLoadingScreen } from "./screen/AuthLoadingScreen";
import { AuthScreen } from "./screen/AuthScreen";
import { ConnectGitHubScreen } from "./screen/ConnectGitHubScreen";

export function AuthGate({ children }: { children: ReactNode }) {
  const { token, bootstrapping, authRejectionCode, clearToken } = useAuthToken();
  const viewer = useAuthViewer(!bootstrapping && Boolean(token));
  const authError = viewer.error instanceof ProliferateClientError ? viewer.error : null;
  const invalidToken = authError?.status === 401;
  const betaDeniedCode = isWebBetaAuthErrorCode(authError?.code ?? null)
    ? authError?.code ?? null
    : null;
  const betaDenied = betaDeniedCode !== null;

  useEffect(() => {
    if (betaDeniedCode) {
      void clearToken({ authRejectionCode: betaDeniedCode });
      return;
    }
    if (invalidToken) {
      void clearToken();
    }
  }, [betaDeniedCode, clearToken, invalidToken]);

  if (bootstrapping) {
    return <AuthLoadingScreen />;
  }

  if (!token) {
    if (authRejectionCode) {
      return <AuthErrorScreen code={authRejectionCode} />;
    }
    return <AuthScreen />;
  }

  if (viewer.isLoading) {
    return <AuthLoadingScreen />;
  }

  if (invalidToken) {
    return <AuthLoadingScreen />;
  }

  if (betaDenied) {
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
