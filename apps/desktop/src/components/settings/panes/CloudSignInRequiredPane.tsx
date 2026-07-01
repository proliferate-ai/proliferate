import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
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

      <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <div className="text-sm font-medium text-foreground">
          Sign in to use cloud workspaces.
        </div>
        <p className="max-w-[48ch] text-xs leading-[1.45] text-muted-foreground">
          {CAPABILITY_COPY.cloudSignInDetails}
        </p>
        <div className="mt-2">
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
        </div>

        {signInError && (
          <p className="text-sm text-destructive">{signInError}</p>
        )}
      </div>
    </section>
  );
}
