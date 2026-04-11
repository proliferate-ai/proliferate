import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ExternalLink } from "@/components/ui/icons";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { AUTH_ACCOUNT_LABELS } from "@/config/auth";
import { CAPABILITY_COPY } from "@/config/capabilities";
import { useGitHubDesktopAuthAvailability } from "@/hooks/auth/use-github-auth-availability";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
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

      <SettingsCard>
        <SettingsCardRow
          label="Proliferate"
          description={
            devAuthBypassed
                ? AUTH_ACCOUNT_LABELS.devBypassDescription
              : isAuthenticated
                ? user?.email ?? "Signed in"
                : localMode
                  ? CAPABILITY_COPY.accountLocalDescription
                  : cloudSignInChecking
                    ? CAPABILITY_COPY.githubAuthCheckingDescription
                  : signInUnavailable
                    ? CAPABILITY_COPY.accountAuthUnavailableDescription
                    : AUTH_ACCOUNT_LABELS.anonymousDescription
          }
        >
          {devAuthBypassed ? (
            <span className="text-sm text-muted-foreground">{AUTH_ACCOUNT_LABELS.localPill}</span>
          ) : localMode ? (
            <span className="text-sm text-muted-foreground">{AUTH_ACCOUNT_LABELS.localPill}</span>
          ) : cloudSignInChecking ? (
            <span className="text-sm text-muted-foreground">Checking…</span>
          ) : signInUnavailable ? (
            <span className="text-sm text-muted-foreground">Unavailable</span>
          ) : isAuthenticated ? (
            <Button
              variant="secondary"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              loading={signingOut}
            >
              {signingOut ? AUTH_ACCOUNT_LABELS.signingOut : AUTH_ACCOUNT_LABELS.signOut}
            </Button>
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
        </SettingsCardRow>

        <SettingsCardRow
          label="GitHub"
          description={
            devAuthBypassed
              ? "GitHub auth is bypassed in local development mode."
              : signedInWhileCloudUnavailable
                ? CAPABILITY_COPY.githubSignedInUnavailableDescription
              : localMode
                ? CAPABILITY_COPY.githubLocalDescription
                : cloudSignInChecking
                  ? CAPABILITY_COPY.githubAuthCheckingDescription
                : signInUnavailable
                  ? CAPABILITY_COPY.githubAuthUnavailableDescription
              : isAuthenticated
                ? user?.github_login
                  ? `Connected through GitHub desktop sign-in as @${user.github_login}. Reconnect opens GitHub's account picker. Manage access opens this app's authorization page on GitHub.`
                  : "Connected through GitHub desktop sign-in."
                : "Sign in with GitHub to connect your Proliferate account."
          }
        >
          {canReconnectGitHub ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-primary">Connected</span>
              <Button
                variant="secondary"
                onClick={() => void signInWithGitHub({ prompt: "select_account" })}
                disabled={signingIn || signInChecking}
                loading={signingIn}
              >
                {signingIn
                  ? AUTH_ACCOUNT_LABELS.reconnecting
                  : AUTH_ACCOUNT_LABELS.reconnect}
              </Button>
              <Button
                variant="ghost"
                onClick={() => { void openExternal(githubSettingsUrl); }}
              >
                {AUTH_ACCOUNT_LABELS.manageAccess}
                <ExternalLink className="size-3" />
              </Button>
            </div>
          ) : canOpenGitHubSettings ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-primary">Connected</span>
              <Button
                variant="ghost"
                onClick={() => { void openExternal(githubSettingsUrl); }}
              >
                {AUTH_ACCOUNT_LABELS.manageAccess}
                <ExternalLink className="size-3" />
              </Button>
            </div>
          ) : (
            <span className={`text-sm ${isAuthenticated ? "text-primary" : "text-muted-foreground"}`}>
              {devAuthBypassed
                ? "Bypassed"
                : localMode || signInUnavailable
                  ? "Unavailable"
                  : cloudSignInChecking
                    ? "Checking…"
                  : isAuthenticated
                    ? "Connected"
                    : "Not connected"}
            </span>
          )}
        </SettingsCardRow>
      </SettingsCard>

      {signInError && (
        <p className="text-sm text-destructive">{signInError}</p>
      )}
    </section>
  );
}
