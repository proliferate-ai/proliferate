import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ExternalLink, GitHub, Mail, RefreshCw } from "@/components/ui/icons";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { AUTH_ACCOUNT_LABELS } from "@/copy/auth/auth-copy";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { useGitHubDesktopAuthAvailability } from "@/hooks/auth/use-github-auth-availability";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import {
  getAccountActionDescription,
  getAccountDisplayName,
  getAccountInitials,
  getAccountProfileSummary,
  getGitHubStatusLabel,
} from "@/lib/domain/auth/account-profile-presentation";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import { useAuthActions } from "@/hooks/auth/use-auth-actions";
import { useGitHubSignIn } from "@/hooks/auth/use-github-sign-in";
import { buildGitHubOAuthAppSettingsUrl } from "@/lib/integrations/auth/proliferate-auth";
import { openExternal } from "@/platform/tauri/shell";
import { useAuthStore } from "@/stores/auth/auth-store";

export function AccountPane() {
  const navigate = useNavigate();
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const { signOut } = useAuthActions();
  const {
    signIn: signInWithGitHub,
    submitting: signingIn,
    signInChecking,
    error: signInError,
  } = useGitHubSignIn();
  const { data: githubDesktopAuthAvailability } = useGitHubDesktopAuthAvailability();
  const { cloudSignInAvailable, cloudSignInChecking, cloudUnavailable } = useCloudAvailabilityState();
  const [signingOut, setSigningOut] = useState(false);
  const devAuthBypassed = isDevAuthBypassed();
  const isAuthenticated = status === "authenticated";
  const localMode = cloudUnavailable && !devAuthBypassed && !isAuthenticated;
  const canReconnectGitHub = isAuthenticated && cloudSignInAvailable && !cloudSignInChecking;
  const canOpenGitHubSettings = isAuthenticated && !devAuthBypassed;
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

      {signInError && (
        <p className="text-sm text-destructive">{signInError}</p>
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
