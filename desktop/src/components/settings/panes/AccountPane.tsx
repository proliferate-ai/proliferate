import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { ExternalLink, GitHub, Link2, Mail, RefreshCw } from "@/components/ui/icons";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { AUTH_ACCOUNT_LABELS } from "@/copy/auth/auth-copy";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { useAuthViewer } from "@/hooks/access/cloud/auth/use-auth-viewer";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useGitHubDesktopAuthAvailability } from "@/hooks/access/cloud/auth/use-github-auth-availability";
import {
  getAccountActionDescription,
  getAccountDisplayName,
  getAccountInitials,
  getAccountProfileSummary,
  getGitHubStatusLabel,
} from "@/lib/domain/auth/account-profile-presentation";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import { useAuthActions } from "@/hooks/auth/workflows/use-auth-actions";
import { useGitHubSignIn } from "@/hooks/auth/workflows/use-github-sign-in";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { buildGitHubOAuthAppSettingsUrl } from "@/lib/integrations/auth/proliferate-auth";
import { useAuthStore } from "@/stores/auth/auth-store";

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
  const devAuthBypassed = isDevAuthBypassed();
  const isAuthenticated = status === "authenticated";
  const authViewer = useAuthViewer(
    isAuthenticated && !devAuthBypassed && cloudSignInAvailable,
    "desktop-account",
  );
  const linkedProviders = authViewer.data?.linkedProviders ?? [];
  const linkedGitHub = linkedProviders.find((provider) => (
    provider.provider === "github" && provider.connected
  ));
  const googleAccounts = linkedProviders.filter((provider) => (
    provider.provider === "google" && provider.connected
  ));
  const googleAvailability = authViewer.data?.providerAvailability.find((provider) => (
    provider.provider === "google"
  ));
  const localMode = cloudUnavailable && !devAuthBypassed && !isAuthenticated;
  const canReconnectGitHub = isAuthenticated && cloudSignInAvailable && !cloudSignInChecking;
  const canOpenGitHubSettings = isAuthenticated && !devAuthBypassed;
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
  const githubLogin = user?.github_login?.trim() || null;
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

      <AccountProfileHeader
        avatarUrl={profileAvatarUrl}
        displayName={displayName}
        email={user?.email ?? "Not signed in"}
        githubLabel={githubLogin ? `@${githubLogin}` : getGitHubStatusLabel({
          cloudSignInChecking,
          devAuthBypassed,
          isAuthenticated,
          localMode,
          signInUnavailable,
        })}
        profileSummary={profileSummary}
      />

      <SettingsCard>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium text-foreground">Account access</div>
            <p className="max-w-xl text-sm text-muted-foreground">
              {getAccountActionDescription({
                devAuthBypassed,
                isAuthenticated,
                localMode,
                signInUnavailable,
                signedInWhileCloudUnavailable,
                githubLogin,
              })}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {devAuthBypassed ? (
              <span className="text-sm text-muted-foreground">
                {AUTH_ACCOUNT_LABELS.localPill}
              </span>
            ) : isAuthenticated ? (
              <>
                {canReconnectGitHub && (
                  <Button
                    variant="secondary"
                    onClick={() => void signInWithGitHub({ prompt: "select_account" })}
                    disabled={signingIn || signInChecking}
                    loading={signingIn}
                  >
                    {!signingIn && <RefreshCw className="size-3" />}
                    {signingIn
                      ? AUTH_ACCOUNT_LABELS.reconnecting
                      : AUTH_ACCOUNT_LABELS.reconnect}
                  </Button>
                )}
                {canOpenGitHubSettings && (
                  <Button
                    variant="ghost"
                    onClick={() => { void openExternal(githubSettingsUrl); }}
                  >
                    {AUTH_ACCOUNT_LABELS.manageAccess}
                    <ExternalLink className="size-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                  loading={signingOut}
                  className="text-destructive hover:text-destructive"
                >
                  {signingOut ? AUTH_ACCOUNT_LABELS.signingOut : AUTH_ACCOUNT_LABELS.signOut}
                </Button>
              </>
            ) : localMode || signInUnavailable ? (
              <span className="text-sm text-muted-foreground">Unavailable</span>
            ) : cloudSignInChecking ? (
              <span className="text-sm text-muted-foreground">Checking…</span>
            ) : (
              <Button
                variant="secondary"
                onClick={() => void signInWithGitHub()}
                disabled={signingIn || signInChecking}
                loading={signingIn}
              >
                {signingIn
                  ? AUTH_ACCOUNT_LABELS.signingIn
                  : signInChecking
                    ? AUTH_ACCOUNT_LABELS.checkingSignIn
                    : AUTH_ACCOUNT_LABELS.signIn}
              </Button>
            )}
          </div>
        </div>
      </SettingsCard>

      {isAuthenticated && !devAuthBypassed && (
        <SettingsCard>
          <div className="space-y-3 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium text-foreground">Connected providers</div>
                <p className="max-w-xl text-sm text-muted-foreground">
                  GitHub is required for repository access. Add Google accounts here so web, mobile, and desktop auth resolve to the same Proliferate user.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={!canLinkGoogle || linkingGoogle}
                loading={linkingGoogle}
                onClick={() => void handleLinkGoogle()}
              >
                {!linkingGoogle && <Link2 className="size-3" />}
                {linkingGoogle ? "Waiting for Google..." : "Add Google"}
              </Button>
            </div>

            <div className="divide-y divide-border rounded-lg border border-border">
              <ConnectedProviderRow
                label="GitHub"
                detail={githubLogin ? `@${githubLogin}` : linkedGitHub?.accountEmail ?? "Connected"}
                connected={Boolean(linkedGitHub) || Boolean(githubLogin)}
              />
              {googleAccounts.length > 0 ? (
                googleAccounts.map((account, index) => (
                  <ConnectedProviderRow
                    key={`google-${account.accountId ?? account.accountEmail ?? index}`}
                    label="Google"
                    detail={account.accountEmail ?? account.accountId ?? "Connected"}
                    connected
                  />
                ))
              ) : (
                <ConnectedProviderRow
                  label="Google"
                  detail={
                    googleAvailability?.enabled === false
                      ? "Not configured in this environment"
                      : "Not connected"
                  }
                  connected={false}
                />
              )}
            </div>
          </div>
        </SettingsCard>
      )}

      {(signInError || providerLinkError) && (
        <p className="text-sm text-destructive">{signInError || providerLinkError}</p>
      )}
    </section>
  );
}

function AccountProfileHeader({
  avatarUrl,
  displayName,
  email,
  githubLabel,
  profileSummary,
}: {
  avatarUrl: string | null;
  displayName: string;
  email: string;
  githubLabel: string;
  profileSummary: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <AccountAvatar
        key={avatarUrl ?? "account-avatar"}
        avatarUrl={avatarUrl}
        displayName={displayName}
      />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="min-w-0 space-y-1">
          <div className="truncate text-lg font-medium text-foreground">
            {displayName}
          </div>
          <p className="text-sm text-muted-foreground">{profileSummary}</p>
        </div>
        <div className="grid gap-2">
          <AccountProfileRow
            icon={<Mail className="size-4" />}
            label="Email"
            value={email}
          />
          <AccountProfileRow
            icon={<GitHub className="size-4" />}
            label="GitHub"
            value={githubLabel}
          />
        </div>
      </div>
    </div>
  );
}

function AccountAvatar({
  avatarUrl,
  displayName,
}: {
  avatarUrl: string | null;
  displayName: string;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = avatarUrl && !avatarFailed;

  return (
    <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground/5 text-xl font-medium text-muted-foreground">
      {showAvatar ? (
        <img
          src={avatarUrl}
          alt={`${displayName} GitHub profile`}
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <span>{getAccountInitials(displayName)}</span>
      )}
    </div>
  );
}

function AccountProfileRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[1rem_5rem_minmax(0,1fr)] items-center gap-3 text-sm">
      <span className="text-muted-foreground" aria-hidden="true">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-foreground">{value}</span>
    </div>
  );
}

function ConnectedProviderRow({
  label,
  detail,
  connected,
}: {
  label: string;
  detail: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="font-medium text-foreground">{label}</div>
        <div className="truncate text-muted-foreground">{detail}</div>
      </div>
      <span className={connected ? "text-xs text-foreground" : "text-xs text-muted-foreground"}>
        {connected ? "Connected" : "Not connected"}
      </span>
    </div>
  );
}
