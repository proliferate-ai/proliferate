import { Button } from "#product/primitives/Button";
import { SettingsEmptyState } from "#product/primitives/patterns/settings/SettingsEmptyState";
import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";
import { AUTH_ACCOUNT_LABELS } from "#product/copy/auth/auth-copy";
import { CAPABILITY_COPY } from "#product/copy/capabilities/capability-copy";
import { useGitHubSignIn } from "#product/hooks/auth/workflows/use-github-sign-in";

export function CloudSignInRequiredPane() {
  const {
    signIn,
    submitting: signingIn,
    signInChecking,
    error: signInError,
  } = useGitHubSignIn();

  return (
    <SettingsPageBody>
      <PageHeader
        variant="flat"
        title="Cloud"
        description={CAPABILITY_COPY.cloudSignInDescription}
      />

      <SettingsEmptyState
        title="Sign in to sync credentials"
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
              <p className="text-ui text-destructive">{signInError}</p>
            )}
          </>
        }
      />
    </SettingsPageBody>
  );
}
