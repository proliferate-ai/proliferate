import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { AUTH_ACCOUNT_LABELS } from "@/copy/auth/auth-copy";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { useGitHubSignIn } from "@/hooks/auth/workflows/use-github-sign-in";

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

      <SettingsEmptyState
        title="Sign in to use cloud workspaces"
        description={CAPABILITY_COPY.cloudSignInDetails}
        action={
          <>
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
          </>
        }
      />
    </section>
  );
}
