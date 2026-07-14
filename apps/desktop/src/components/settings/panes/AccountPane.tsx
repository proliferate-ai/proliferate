import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AccountSettingsPane,
  type AccountPasswordCredentialSubmit,
} from "@proliferate/product-ui/account/AccountSettingsPane";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { setPasswordCredential } from "@proliferate/cloud-sdk";
import {
  useGitHubAppUserAuthorizationStatus,
  useStartGitHubAppUserAuthorization,
} from "@proliferate/cloud-sdk-react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { ExternalLink, RefreshCw } from "@proliferate/ui/icons";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { ConnectServerDialog } from "@/components/auth/ConnectServerDialog";
import { CurrentUserInvitationsSection } from "@/components/settings/panes/organization/CurrentUserInvitationsSection";
import { AUTH_ACCOUNT_LABELS, CONNECT_SERVER_LABELS } from "@/copy/auth/auth-copy";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { useAuthViewer } from "@/hooks/access/cloud/auth/use-auth-viewer";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useGitHubDesktopAuthAvailability } from "@/hooks/access/cloud/auth/use-github-auth-availability";
import { useCurrentUserOrganizationInvitations } from "@/hooks/access/cloud/organizations/use-current-user-organization-invitations";
import { useOrganizationActions } from "@/hooks/access/cloud/organizations/use-organization-actions";
import {
  buildAccountProviderViews,
  getAccountActionDescription,
  getAccountDisplayName,
  getAccountProfileSummary,
  getGitHubStatusLabel,
} from "@/lib/domain/auth/account-profile-presentation";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import {
  useProductAuthStatus,
  useProductAuthUser,
} from "@/hooks/auth/facade/use-product-auth";
import { useAuditedAuth } from "@/hooks/auth/facade/use-audited-auth";
import { useGitHubSignIn } from "@/hooks/auth/workflows/use-github-sign-in";
import { useOrganizationJoinInvitationFlow } from "@/hooks/organizations/workflows/use-organization-join-invitation-flow";
import { useJoinedOrganizationActivation } from "@/hooks/organizations/workflows/use-joined-organization-activation";
import { buildGitHubOAuthAppSettingsUrl } from "@/lib/integrations/auth/proliferate-auth";
import type { OrganizationInvitationRecord } from "@/lib/domain/organizations/organization-records";
import { useToastStore } from "@/stores/toast/toast-store";
import { buildGitHubAppUserAuthorizationServiceView } from "./account/GitHubAppUserAuthorizationService";

const EMPTY_INVITATIONS: OrganizationInvitationRecord[] = [];

export function AccountPane() {
  const navigate = useNavigate();
  const status = useProductAuthStatus();
  const user = useProductAuthUser();
  const { links } = useProductHost();
  const auth = useAuditedAuth();
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
  // Pending invitations for the signed-in user's own email. Account is the
  // one settings page every member (admin or not) can reach — Members is
  // admin-gated, so this is the reachable surface for a plain invitee.
  const pendingInvitationsQuery = useCurrentUserOrganizationInvitations(isAuthenticated);
  const pendingInvitations = pendingInvitationsQuery.data?.invitations ?? EMPTY_INVITATIONS;
  const organizationActions = useOrganizationActions(null);
  const joinFlow = useOrganizationJoinInvitationFlow();
  const { activateJoinedOrganization } = useJoinedOrganizationActivation();
  const showToast = useToastStore((state) => state.show);
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
  const githubLogin = user?.githubLogin?.trim() || null;
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
    displayName: user?.displayName,
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
  const profileAvatarUrl = user?.avatarUrl?.trim()
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

  async function handleAcceptCurrentInvitation(invitationId: string) {
    joinFlow.setStatusMessage(null);
    try {
      const response = await organizationActions.acceptCurrentInvitation(invitationId);
      await activateJoinedOrganization(response.organization.id);
      joinFlow.clearJoinTarget();
      joinFlow.setStatusMessage(`Joined ${response.organization.name}.`);
      showToast(`Joined ${response.organization.name}.`, "info");
    } catch {
      joinFlow.setStatusMessage("Could not accept invitation.");
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await auth.logout();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  async function handleLinkGoogle() {
    setLinkingGoogle(true);
    setProviderLinkError(null);
    try {
      await auth.startLogin({ kind: "google", purpose: "link" });
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
        returnTo: links.buildReturnUrl({
          kind: "settings",
          section: "account",
          source: "github_app_callback",
        }),
      });
      await links.openExternal(response.authorizationUrl);
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
    await links.openExternal("https://github.com/settings/installations");
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
        // In local mode the profile card below carries the control-plane
        // explanation; repeating it as the page subtitle read as a bug.
        description={
          localMode
            ? undefined
            : signInUnavailable
              ? CAPABILITY_COPY.accountAuthUnavailableDescription
            : "Sign in to use cloud workspaces and credential sync. Local workspaces remain available without an account."
        }
      />

      {joinFlow.statusMessage ? (
        <AccountNotice>{joinFlow.statusMessage}</AccountNotice>
      ) : null}

      {joinFlow.unauthenticatedJoin ? (
        <AccountNotice>Finish sign-in to accept this organization invitation.</AccountNotice>
      ) : null}

      {pendingInvitations.length > 0 ? (
        <CurrentUserInvitationsSection
          invitations={pendingInvitations}
          accepting={organizationActions.acceptingCurrentInvitation}
          focusedOrganizationId={joinFlow.joinOrganizationId}
          onAccept={(invitationId) => {
            void handleAcceptCurrentInvitation(invitationId);
          }}
        />
      ) : null}

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
                label: linkingGoogle ? "Waiting for Google…" : "Add Google",
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
                onClick: () => { void links.openExternal(githubSettingsUrl); },
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

      {/* Invite links from a different server open this trust-confirm dialog
          before the app is ever repointed (join-invitation flow's security
          boundary). No-op when no server switch is pending. */}
      <ConnectServerDialog
        controller={joinFlow.connectServer}
        context={CONNECT_SERVER_LABELS.inviteContext}
      />
    </section>
  );
}

function AccountNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-foreground/5 px-4 py-3 text-ui-sm text-muted-foreground">
      {children}
    </div>
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
