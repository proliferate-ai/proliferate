import { ProliferateLogo } from "@/components/brand/ProliferateLogo";
import { ArrowRight, GitHub } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { AUTH_LOGIN_LABELS } from "@/config/auth";

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
}: LoginScreenProps) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-background p-8"
      data-tauri-drag-region="true"
    >
      <div className="w-full max-w-md space-y-8">
        <div>
          <ProliferateLogo />
          <p className="mt-10 text-sm text-muted-foreground">
            {AUTH_LOGIN_LABELS.intro}
          </p>
        </div>

        <div className="space-y-4">
          <Button
            type="button"
            size="md"
            loading={submitting}
            onClick={onGitHubSignIn}
            disabled={busy || githubSignInChecking || !githubSignInAvailable}
            className="h-11 w-full"
          >
            {!submitting && <GitHub className="h-4 w-4 shrink-0" />}
            {submitting
              ? AUTH_LOGIN_LABELS.waiting
              : githubSignInChecking
                ? AUTH_LOGIN_LABELS.checking
                : AUTH_LOGIN_LABELS.signIn}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </Button>

          {(githubSignInChecking || !githubSignInAvailable) && (
            <p className="text-sm text-muted-foreground">
              {githubSignInUnavailableDescription}
            </p>
          )}

          {canContinueLocally && (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={onContinueLocally}
              className="h-11 w-full"
            >
              {AUTH_LOGIN_LABELS.continueLocally}
            </Button>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
