import { ProliferateLivingMark } from "@proliferate/product-ui/brand/ProliferateLivingMark";
import { AuthAppearanceBoundary } from "@/components/auth/AuthAppearanceBoundary";
import { PasswordSignInForm } from "@/components/auth/PasswordSignInForm";
import { ArrowRight, GitHub } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { AUTH_LOGIN_LABELS } from "@/copy/auth/auth-copy";

interface LoginScreenProps {
  submitting: boolean;
  busy: boolean;
  error: string | null;
  githubSignInAvailable: boolean;
  githubSignInChecking: boolean;
  githubSignInUnavailableDescription: string;
  onGitHubSignIn: () => void;
  onContinueLocally: () => void;
  canContinueLocally: boolean;
  // Email/password sign-in: the default surface when the server reports
  // GitHub OAuth is not configured (self-hosted posture).
  passwordSignInAvailable?: boolean;
  passwordSubmitting?: boolean;
  onPasswordSignIn?: (email: string, password: string) => void;
}

export function LoginScreen({
  submitting,
  busy,
  error,
  githubSignInAvailable,
  githubSignInChecking,
  githubSignInUnavailableDescription,
  onGitHubSignIn,
  onContinueLocally,
  canContinueLocally,
  passwordSignInAvailable = false,
  passwordSubmitting = false,
  onPasswordSignIn,
}: LoginScreenProps) {
  const showPasswordForm = passwordSignInAvailable
    && !githubSignInChecking
    && !githubSignInAvailable;
  return (
    <AuthAppearanceBoundary
      className="flex min-h-screen flex-col items-center justify-center bg-background p-8"
      data-tauri-drag-region="true"
    >
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-5">
          <ProliferateLivingMark />
          <div className="space-y-2.5">
            <h1 className="text-3xl font-semibold leading-tight text-foreground">
              {AUTH_LOGIN_LABELS.title}
            </h1>
            {canContinueLocally
              ? (
                <p className="text-sm text-muted-foreground">
                  {AUTH_LOGIN_LABELS.detailWithLocalPrefix}{" "}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onContinueLocally}
                    className="inline h-auto px-0 py-0 text-foreground underline underline-offset-4 hover:text-muted-foreground"
                  >
                    {AUTH_LOGIN_LABELS.continueLocallyInline}
                  </Button>
                  .
                </p>
              )
              : (
                <p className="text-sm text-muted-foreground">
                  {AUTH_LOGIN_LABELS.detail}
                </p>
              )}
          </div>
        </div>

        <div className="space-y-4">
          {showPasswordForm
            ? (
              <PasswordSignInForm
                submitting={passwordSubmitting}
                disabled={busy}
                onSubmit={(email, password) => onPasswordSignIn?.(email, password)}
              />
            )
            : (
              <Button
                type="button"
                size="md"
                loading={submitting}
                onClick={onGitHubSignIn}
                disabled={busy || githubSignInChecking || !githubSignInAvailable}
                className="h-11 w-full"
              >
                {!submitting && <GitHub className="h-4 w-4 shrink-0" />}
                {submitting ? AUTH_LOGIN_LABELS.waiting : AUTH_LOGIN_LABELS.signIn}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </Button>
            )}

          {!showPasswordForm && !githubSignInChecking && !githubSignInAvailable && (
            <p className="text-sm text-muted-foreground">
              {githubSignInUnavailableDescription}
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
      </div>
    </AuthAppearanceBoundary>
  );
}
