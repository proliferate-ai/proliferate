import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { ProliferateLivingMark } from "@proliferate/product-ui/brand/ProliferateLivingMark";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { AuthAppearanceBoundary } from "@/components/auth/AuthAppearanceBoundary";
import { ConnectServerDialog } from "@/components/auth/ConnectServerDialog";
import { PasswordSignInForm } from "@/components/auth/PasswordSignInForm";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { useConnectServer } from "@/hooks/auth/workflows/use-connect-server";
import { ArrowRight, GitHub } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { AUTH_LOGIN_LABELS, AUTH_SCREEN_LABELS, CONNECT_SERVER_LABELS } from "@/copy/auth/auth-copy";

// Shared shell for the initial page (loading -> auth). The SAME element tree is
// rendered in both modes so React never re-mounts the living mark — its
// breathing animation stays cleanly persistent across the transition.
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
  ssoSubmitting?: boolean;
  ssoSignInAvailable?: boolean;
  ssoSignInChecking?: boolean;
  ssoSignInUnavailableDescription?: string;
  ssoDisplayName?: string | null;
  onSsoSignIn?: () => void;
  // Email/password sign-in: the default surface when the server reports
  // GitHub OAuth is not configured (self-hosted posture).
  passwordSignInAvailable?: boolean;
  passwordSubmitting?: boolean;
  onPasswordSignIn?: (email: string, password: string) => void;
  onCancelSignIn?: () => void;
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
  ssoSubmitting = false,
  ssoSignInAvailable = false,
  ssoSignInChecking = false,
  ssoSignInUnavailableDescription = "",
  ssoDisplayName = null,
  onSsoSignIn,
  passwordSignInAvailable = false,
  passwordSubmitting = false,
  onPasswordSignIn,
  onCancelSignIn,
  canContinueLocally = false,
  onContinueLocally,
}: AuthScreenLayoutProps) {
  const showAuth = mode === "auth";
  const showSso = showAuth && ssoSignInAvailable;
  // Password form is the DEFAULT when GitHub OAuth is not configured; the
  // GitHub button keeps its place whenever GitHub is (or may still be) enabled.
  const showPasswordForm = showAuth
    && passwordSignInAvailable
    && !githubSignInChecking
    && !githubSignInAvailable;
  const showCancelSignIn = showAuth
    && Boolean(onCancelSignIn)
    && (submitting || ssoSubmitting);
  const showUnavailableMessage = showAuth
    && !showPasswordForm
    && !ssoSignInChecking
    && !ssoSignInAvailable
    && !githubSignInChecking
    && !githubSignInAvailable;

  // Connect-to-a-self-hosted-server: a quiet secondary affordance, never
  // rendered in the web build (no Tauri, no `set_app_config` command —
  // `available` is false there).
  const connectServer = useConnectServer();
  const showConnectServer = showAuth && connectServer.available;

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
        <div
          className={twMerge(
            "relative",
            showPasswordForm
              ? (showSso ? "h-[11.5rem]" : "h-[8.25rem]")
              : ssoSignInAvailable
                ? "h-[5.875rem]"
                : "h-11",
          )}
        >
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
              <ThinkingText text={loadingHint} className="text-sm font-normal" />
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
            <div className="grid gap-2">
              {showPasswordForm ? (
                <PasswordSignInForm
                  submitting={passwordSubmitting}
                  disabled={!showAuth || busy}
                  tabbable={showAuth}
                  onSubmit={(email, password) => onPasswordSignIn?.(email, password)}
                />
              ) : (
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
                  {submitting ? AUTH_LOGIN_LABELS.waiting : AUTH_LOGIN_LABELS.signIn}
                  {!submitting && <ArrowRight className="h-4 w-4" />}
                </Button>
              )}

              {showSso ? (
                <Button
                  type="button"
                  size="md"
                  variant="secondary"
                  loading={ssoSubmitting}
                  onClick={onSsoSignIn}
                  disabled={!showAuth || busy}
                  tabIndex={showAuth ? 0 : -1}
                  className="h-11 w-full"
                >
                  {!ssoSubmitting && (
                    <ProviderBrandIcon
                      provider="sso"
                      label={ssoDisplayName}
                      className="h-4 w-4 shrink-0"
                    />
                  )}
                  {ssoSubmitting
                    ? AUTH_LOGIN_LABELS.ssoWaiting
                    : AUTH_LOGIN_LABELS.ssoSignIn(ssoDisplayName)}
                  {!ssoSubmitting && <ArrowRight className="h-4 w-4" />}
                </Button>
              ) : null}
            </div>
          </div>

          {/* Message line is absolutely anchored below the action slot so error /
              unavailable / local text (which can wrap to multiple lines) never
              changes the centered column height — the mark stays pinned. */}
          <div className="absolute inset-x-0 top-full mt-3 text-center">
            {showCancelSignIn
              ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onCancelSignIn}
                  className="inline h-auto px-0 py-0 text-muted-foreground underline underline-offset-4 hover:bg-transparent hover:text-foreground"
                >
                  {AUTH_LOGIN_LABELS.cancelSignIn}
                </Button>
              )
              : showAuth && error
              ? <p className="text-sm text-destructive">{error}</p>
              : showUnavailableMessage
                ? (
                  <p className="text-sm text-muted-foreground">
                    {githubSignInUnavailableDescription || ssoSignInUnavailableDescription}
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

      {showConnectServer && (
        <div className="fixed inset-x-0 bottom-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          {connectServer.connectedServerHost ? (
            <>
              <span>
                {CONNECT_SERVER_LABELS.connectedPrefix} {connectServer.connectedServerHost}
              </span>
              <span aria-hidden>·</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void connectServer.resetToDefaultServer()}
                className="inline h-auto px-0 py-0 text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                {CONNECT_SERVER_LABELS.reset}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={connectServer.open}
              className="inline h-auto px-0 py-0 text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {CONNECT_SERVER_LABELS.connectAffordance}
            </Button>
          )}
        </div>
      )}
      <ConnectServerDialog controller={connectServer} />
    </AuthAppearanceBoundary>
  );
}
