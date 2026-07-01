import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AccountSettingsPane,
  type AccountPasswordCredentialSubmit,
  type AccountProviderView,
} from "@proliferate/product-ui/account/AccountSettingsPane";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { setPasswordCredential } from "@proliferate/cloud-sdk";
import {
  useGitHubAppUserAuthorizationStatus,
  useStartGitHubAppUserAuthorization,
} from "@proliferate/cloud-sdk-react";
import { ExternalLink, RefreshCw } from "@proliferate/ui/icons";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { AUTH_ACCOUNT_LABELS } from "@/copy/auth/auth-copy";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { useAuthViewer } from "@/hooks/access/cloud/auth/use-auth-viewer";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useGitHubDesktopAuthAvailability } from "@/hooks/access/cloud/auth/use-github-auth-availability";
import {
  getAccountActionDescription,
  getAccountDisplayName,
  getAccountProfileSummary,
  getGitHubStatusLabel,
} from "@/lib/domain/auth/account-profile-presentation";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import { useAuthActions } from "@/hooks/auth/workflows/use-auth-actions";
import { useGitHubSignIn } from "@/hooks/auth/workflows/use-github-sign-in";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { buildGitHubOAuthAppSettingsUrl } from "@/lib/integrations/auth/proliferate-auth";
import { useAuthStore } from "@/stores/auth/auth-store";
import { buildGitHubAppUserAuthorizationServiceView } from "./account/GitHubAppUserAuthorizationService";

export function AccountPane() {
  const navigate = useNavigate();
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const { linkGoogle, signOut } = useAuthActions();
  const { openExternal } = useTauriShellActions();
  const {
    signIn: signInWithGitHub,
    submitting: signingIn,
    signInChecking,
    error: signInError,
  } = useGitHubSignIn();
  const { data: githubDesktopAuthAvailability } = useGitHubDesktopAuthAvailability();
  const { cloudSignInAvailable, cloudSignInChecking, cloudUnavailable } = useCloudAvailabilityState();
  const [signingOut, setSigningOut] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [providerLinkError, setProviderLinkError] = useState<string | null>(null);
  const githubAppAuthorizationRefreshTimersRef = useRef<number[]>([]);
  const devAuthBypassed = isDevAuthBypassed();
  const isAuthenticated = status === "authenticated";
  const authViewerCacheScope = user?.id
    ? `desktop-account:${user.id}`
    : "desktop-account:anonymous";
  const githubAppUserAuthorization = useGitHubAppUserAuthorizationStatus(
    isAuthenticated && !devAuthBypassed,
    authViewerCacheScope,
  );
  const githubAppUserAuthorizationStart = useStartGitHubAppUserAuthorization();
  const authViewer = useAuthViewer(
    isAuthenticated && !devAuthBypassed && cloudSignInAvailable,
    authViewerCacheScope,
  );
  const linkedProviders = authViewer.data?.linkedProviders ?? [];
  const linkedGitHub = linkedProviders.find((provider) => (
    provider.provider === "github" && provider.connected
  ));
  const googleAccounts = linkedProviders.filter((provider) => (
    provider.provider === "google" && provider.connected
  ));
  const ssoAccounts = linkedProviders.filter((provider) => (
    provider.provider === "sso" && provider.connected
  ));
  const googleAvailability = authViewer.data?.providerAvailability.find((provider) => (
    provider.provider === "google"
  ));
  const githubLogin = user?.github_login?.trim() || null;
  const githubConnected = Boolean(authViewer.data?.githubConnected || linkedGitHub || githubLogin);
  const githubAccountLabel = githubLogin
    ? `@${githubLogin}`
    : linkedGitHub?.accountEmail ?? linkedGitHub?.accountId ?? null;
  const localMode = cloudUnavailable && !devAuthBypassed && !isAuthenticated;
  const canConnectGitHub = isAuthenticated
    && !githubConnected
    && cloudSignInAvailable
    && !cloudSignInChecking;
  const canReconnectGitHub = isAuthenticated
    && githubConnected
    && cloudSignInAvailable
    && !cloudSignInChecking;
  const canOpenGitHubSettings = isAuthenticated && !devAuthBypassed && githubConnected;
  const canLinkGoogle = isAuthenticated
    && cloudSignInAvailable
    && !cloudSignInChecking
    && googleAvailability?.enabled !== false;
  const githubSettingsUrl = buildGitHubOAuthAppSettingsUrl(githubDesktopAuthAvailability?.clientId);
  const signInUnavailable = !cloudUnavailable
    && !cloudSignInChecking
    && !cloudSignInAvailable
    && !isAuthenticated;
  const signedInWhileCloudUnavailable = cloudUnavailable && isAuthenticated;
  const displayName = getAccountDisplayName({
    email: user?.email,
    displayName: user?.display_name,
    githubLogin,
    isAuthenticated,
    devAuthBypassed,
    localMode,
  });
  const profileSummary = getAccountProfileSummary({
    devAuthBypassed,
    isAuthenticated,
    localMode,
    signInUnavailable,
    signedInWhileCloudUnavailable,
  });
  const profileAvatarUrl = user?.avatar_url?.trim()
    || (githubLogin
      ? `https://github.com/${encodeURIComponent(githubLogin)}.png?size=160`
      : null);

  useEffect(() => () => {
    clearGitHubAppAuthorizationRefreshTimers(githubAppAuthorizationRefreshTimersRef.current);
  }, []);

  useEffect(() => {
    clearGitHubAppAuthorizationRefreshTimers(githubAppAuthorizationRefreshTimersRef.current);
    githubAppAuthorizationRefreshTimersRef.current = [];
  }, [authViewerCacheScope]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  async function handleLinkGoogle() {
    setLinkingGoogle(true);
    setProviderLinkError(null);
    try {
      await linkGoogle();
      await authViewer.refetch();
    } catch (error) {
      setProviderLinkError(error instanceof Error ? error.message : "Google linking failed");
    } finally {
      setLinkingGoogle(false);
    }
  }

  async function handleAuthorizeGitHubAppUser() {
    setProviderLinkError(null);
    try {
      const response = await githubAppUserAuthorizationStart.mutateAsync({
        returnTo: "proliferate://settings/account?source=github_app_callback",
      });
      await openExternal(response.authorizationUrl);
      clearGitHubAppAuthorizationRefreshTimers(githubAppAuthorizationRefreshTimersRef.current);
      githubAppAuthorizationRefreshTimersRef.current = scheduleGitHubAppAuthorizationRefresh(() => {
        void githubAppUserAuthorization.refetch();
      });
    } catch (error) {
      setProviderLinkError(
        error instanceof Error ? error.message : "GitHub App authorization failed",
      );
    }
  }

  async function handleManageGitHubApp() {
    await openExternal("https://github.com/settings/installations");
  }

  async function handleSetPassword(input: AccountPasswordCredentialSubmit) {
    await setPasswordCredential({
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });
    await authViewer.refetch();
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Account"
        description={
          localMode
            ? CAPABILITY_COPY.accountLocalDescription
            : signInUnavailable
              ? CAPABILITY_COPY.accountAuthUnavailableDescription
            : "Sign in to use cloud workspaces and credential sync. Local workspaces remain available without an account."
        }
      />

      <AccountSettingsPane
        displayName={displayName}
        email={user?.email ?? "Not signed in"}
        avatarUrl={profileAvatarUrl}
        githubLabel={githubAccountLabel ?? getGitHubStatusLabel({
          cloudSignInChecking,
          devAuthBypassed,
          localMode,
          signInUnavailable,
        })}
        profileSummary={profileSummary}
        accessDescription={getAccountActionDescription({
          devAuthBypassed,
          isAuthenticated,
          localMode,
          signInUnavailable,
          signedInWhileCloudUnavailable,
          githubConnected,
        })}
        providers={buildAccountProviderViews({
          githubAccountLabel,
          githubConnected,
          googleAccounts,
          ssoAccounts,
          googleAvailable: googleAvailability?.enabled !== false,
          showProviders: isAuthenticated && !devAuthBypassed,
        })}
        connectedServices={isAuthenticated && !devAuthBypassed
          ? [buildGitHubAppUserAuthorizationServiceView({
              status: githubAppUserAuthorization.data,
              loading: githubAppUserAuthorization.isLoading,
              authorizing: githubAppUserAuthorizationStart.isPending,
              onAuthorize: handleAuthorizeGitHubAppUser,
              onManage: handleManageGitHubApp,
            })]
          : []}
        passwordCredential={isAuthenticated && !devAuthBypassed
          ? {
              enabled: authViewer.data?.passwordCredential.enabled ?? false,
              setAt: authViewer.data?.passwordCredential.setAt ?? null,
              loading: authViewer.isLoading && !authViewer.data,
              disabled: !cloudSignInAvailable || authViewer.isLoading,
              onSubmit: handleSetPassword,
            }
          : undefined}
        actions={{
          signIn: !devAuthBypassed && !isAuthenticated && !localMode && !signInUnavailable && !cloudSignInChecking
            ? {
                label: signingIn
                  ? AUTH_ACCOUNT_LABELS.signingIn
                  : signInChecking
                    ? AUTH_ACCOUNT_LABELS.checkingSignIn
                    : AUTH_ACCOUNT_LABELS.signIn,
                loading: signingIn,
                disabled: signingIn || signInChecking,
                onClick: () => { void signInWithGitHub(); },
              }
            : undefined,
          reconnectGitHub: canReconnectGitHub
            ? {
                label: signingIn
                  ? AUTH_ACCOUNT_LABELS.reconnecting
                  : AUTH_ACCOUNT_LABELS.reconnect,
                icon: <RefreshCw className="size-3" />,
                loading: signingIn,
                disabled: signingIn || signInChecking,
                onClick: () => { void signInWithGitHub({ prompt: "select_account" }); },
              }
            : undefined,
          connectGitHub: canConnectGitHub
            ? {
                label: signingIn
                  ? AUTH_ACCOUNT_LABELS.connectingGitHub
                  : AUTH_ACCOUNT_LABELS.connectGitHub,
                icon: <ProviderBrandIcon provider="github" className="size-[13px]" />,
                loading: signingIn,
                disabled: signingIn || signInChecking,
                onClick: () => { void signInWithGitHub({ prompt: "select_account" }); },
              }
            : undefined,
          connectGoogle: isAuthenticated && !devAuthBypassed
            ? {
                label: linkingGoogle ? "Waiting for Google..." : "Add Google",
                icon: <ProviderBrandIcon provider="google" className="size-[13px]" />,
                loading: linkingGoogle,
                disabled: !canLinkGoogle || linkingGoogle,
                onClick: () => { void handleLinkGoogle(); },
              }
            : undefined,
          manageGitHubAccess: canOpenGitHubSettings
            ? {
                label: AUTH_ACCOUNT_LABELS.manageAccess,
                icon: <ExternalLink className="size-3" />,
                onClick: () => { void openExternal(githubSettingsUrl); },
              }
            : undefined,
          signOut: isAuthenticated && !devAuthBypassed
            ? {
                label: signingOut ? AUTH_ACCOUNT_LABELS.signingOut : AUTH_ACCOUNT_LABELS.signOut,
                loading: signingOut,
                disabled: signingOut,
                destructive: true,
                onClick: () => { void handleSignOut(); },
              }
            : undefined,
        }}
        error={signInError || providerLinkError}
      />
    </section>
  );
}

function scheduleGitHubAppAuthorizationRefresh(refetch: () => void): number[] {
  return [2_000, 5_000, 10_000, 20_000, 40_000, 80_000].map((delayMs) => (
    window.setTimeout(refetch, delayMs)
  ));
}

function clearGitHubAppAuthorizationRefreshTimers(timerIds: number[]) {
  for (const timerId of timerIds) {
    window.clearTimeout(timerId);
  }
}

function buildAccountProviderViews({
  githubAccountLabel,
  githubConnected,
  googleAccounts,
  ssoAccounts,
  googleAvailable,
  showProviders,
}: {
  githubAccountLabel: string | null;
  githubConnected: boolean;
  googleAccounts: Array<{ accountEmail?: string | null; accountId?: string | null }>;
  ssoAccounts: Array<{
    accountEmail?: string | null;
    accountId?: string | null;
    displayName?: string | null;
    brandLabel?: string | null;
  }>;
  googleAvailable: boolean;
  showProviders: boolean;
}): AccountProviderView[] {
  if (!showProviders) {
    return [
      {
        provider: "github",
        label: "GitHub",
        accountLabel: "Not signed in",
        connected: false,
        primary: false,
      },
    ];
  }

  const providers: AccountProviderView[] = ssoAccounts.map((account) => ({
    provider: "sso" as const,
    label: account.displayName ?? "SSO",
    brandLabel: account.brandLabel ?? account.displayName ?? null,
    accountLabel: account.accountEmail ?? account.accountId ?? "Connected",
    connected: true,
  }));

  providers.push(
    {
      provider: "github",
      label: "GitHub",
      accountLabel: githubConnected ? githubAccountLabel ?? "Connected" : "Not connected",
      connected: githubConnected,
      primary: githubConnected,
    },
  );

  if (googleAccounts.length > 0) {
    providers.push(
      ...googleAccounts.map((account) => ({
        provider: "google" as const,
        label: "Google",
        accountLabel: account.accountEmail ?? account.accountId ?? "Connected",
        connected: true,
      })),
    );
  } else {
    providers.push({
      provider: "google",
      label: "Google",
      accountLabel: googleAvailable ? "Not connected" : "Not configured in this environment",
      connected: false,
    });
  }

  return providers;
}
