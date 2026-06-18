import { twMerge } from "tailwind-merge";
import { ProliferateLivingMark } from "@proliferate/product-ui/brand/ProliferateLivingMark";
import { AuthAppearanceBoundary } from "@/components/auth/AuthAppearanceBoundary";
import { ArrowRight, GitHub } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { AUTH_LOGIN_LABELS, AUTH_SCREEN_LABELS } from "@/copy/auth/auth-copy";

// Shared shell for the initial page (loading -> auth). The SAME element tree is
// rendered in both modes so React never re-mounts the living mark — its braille
// animation stays cleanly persistent and keeps running across the transition.
// The mark + one-line heading sit in a fixed-height block, and the actions area
// reserves its height in BOTH modes, so the mark never moves; only the contents
// of the reserved slot cross-fade (loading skeleton -> GitHub button).

export interface AuthScreenLayoutProps {
  mode: "loading" | "auth";
  /** When the mark should settle to the static icon (e.g. session resolved). */
  markComplete?: boolean;
  onMarkResolved?: () => void;
  loadingHint?: string;
  // Auth action state — only meaningful in mode="auth".
  submitting?: boolean;
  busy?: boolean;
  error?: string | null;
  githubSignInAvailable?: boolean;
  githubSignInChecking?: boolean;
  githubSignInUnavailableDescription?: string;
  onGitHubSignIn?: () => void;
  canContinueLocally?: boolean;
  onContinueLocally?: () => void;
}

export function AuthScreenLayout({
  mode,
  markComplete = false,
  onMarkResolved,
  loadingHint = AUTH_SCREEN_LABELS.loadingHint,
  submitting = false,
  busy = false,
  error = null,
  githubSignInAvailable = true,
  githubSignInChecking = false,
  githubSignInUnavailableDescription = "",
  onGitHubSignIn,
  canContinueLocally = false,
  onContinueLocally,
}: AuthScreenLayoutProps) {
  const showAuth = mode === "auth";

  return (
    <AuthAppearanceBoundary
      className="flex min-h-screen flex-col items-center justify-center bg-background p-8"
      data-tauri-drag-region="true"
    >
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-5">
          <ProliferateLivingMark complete={markComplete} onResolved={onMarkResolved} />
          <div className="space-y-2.5">
            <h1 className="text-3xl font-semibold leading-tight text-foreground">
              {AUTH_SCREEN_LABELS.heading}
            </h1>
          </div>
        </div>

        {/* Reserved actions slot: identical height in both modes so the block
            above never shifts. Two absolutely-positioned layers cross-fade. */}
        <div className="relative h-11">
          {/* Loading layer: a skeleton sitting where the button will land.
              On exit it slides up so nothing drifts downward. */}
          <div
            className={twMerge(
              "absolute inset-0 transition-all duration-300 ease-out",
              "motion-reduce:translate-y-0 motion-reduce:transition-none",
              showAuth
                ? "pointer-events-none -translate-y-1 opacity-0"
                : "translate-y-0 opacity-100",
            )}
            aria-hidden={showAuth}
          >
            <div className="flex h-11 w-full items-center justify-center rounded-md border border-border/50 bg-card/30">
              <span className="thinking-text text-sm" data-text={loadingHint}>
                {loadingHint}
              </span>
            </div>
          </div>

          {/* Auth layer: the real GitHub button rises up into place. */}
          <div
            className={twMerge(
              "absolute inset-0 transition-all duration-300 ease-out",
              "motion-reduce:translate-y-0 motion-reduce:transition-none",
              showAuth
                ? "translate-y-0 opacity-100"
                : "pointer-events-none translate-y-1 opacity-0",
            )}
            aria-hidden={!showAuth}
          >
            <Button
              type="button"
              size="md"
              loading={submitting}
              onClick={onGitHubSignIn}
              disabled={
                !showAuth
                || busy
                || githubSignInChecking
                || !githubSignInAvailable
              }
              tabIndex={showAuth ? 0 : -1}
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
          </div>

          {/* Message line is absolutely anchored below the action slot so error /
              unavailable / local text (which can wrap to multiple lines) never
              changes the centered column height — the mark stays pinned. */}
          <div className="absolute inset-x-0 top-full mt-3 text-center">
            {showAuth && error
              ? <p className="text-sm text-destructive">{error}</p>
              : showAuth && (githubSignInChecking || !githubSignInAvailable)
                ? (
                  <p className="text-sm text-muted-foreground">
                    {githubSignInUnavailableDescription}
                  </p>
                )
                : showAuth && canContinueLocally
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
                  : null}
          </div>
        </div>
      </div>
    </AuthAppearanceBoundary>
  );
}
