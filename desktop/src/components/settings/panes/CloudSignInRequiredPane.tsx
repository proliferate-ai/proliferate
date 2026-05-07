import { Button } from "@/components/ui/Button";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { AUTH_ACCOUNT_LABELS } from "@/copy/auth/auth-copy";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { useGitHubSignIn } from "@/hooks/auth/use-github-sign-in";

export function CloudSignInRequiredPane() {
  const {
    signIn,
    submitting: signingIn,
    signInChecking,
    error: signInError,
  } = useGitHubSignIn();

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Cloud"
        description={CAPABILITY_COPY.cloudSignInDescription}
      />

      <SettingsCard>
        <div className="space-y-4 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Sign in to use cloud workspaces.
            </p>
            <p className="text-sm text-muted-foreground">
              {CAPABILITY_COPY.cloudSignInDetails}
            </p>
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={() => void signIn()}
            disabled={signingIn || signInChecking}
            loading={signingIn}
            className="w-fit"
          >
            {signingIn
              ? AUTH_ACCOUNT_LABELS.signingIn
              : signInChecking
                ? AUTH_ACCOUNT_LABELS.checkingSignIn
                : AUTH_ACCOUNT_LABELS.signIn}
          </Button>

          {signInError && (
            <p className="text-sm text-destructive">{signInError}</p>
          )}
        </div>
      </SettingsCard>
    </section>
  );
}
