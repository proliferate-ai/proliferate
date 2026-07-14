import { AuthScreenLayout } from "@/components/auth/AuthScreenLayout";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useGitHubSignIn } from "@/hooks/auth/workflows/use-github-sign-in";
import { usePasswordSignIn } from "@/hooks/auth/workflows/use-password-sign-in";
import { useSsoSignIn } from "@/hooks/auth/workflows/use-sso-sign-in";
import { productAuthIssueMessage } from "@/lib/domain/auth/product-auth-issue-presentation";

// Persistent owner of the pre-app experience. BootstrappedRoute keeps a single
// <AuthShell> mounted across the bootstrapping -> anonymous transition, so the
// living mark never re-mounts and the loading skeleton morphs into the GitHub
// button in place — no jump, no fade. The mark/fade lifecycle is driven by the
// props from BootstrappedRoute; this component only wires the sign-in action.
interface AuthShellProps {
  mode: "loading" | "auth";
  markComplete: boolean;
  onMarkResolved?: () => void;
}

export function AuthShell({ mode, markComplete, onMarkResolved }: AuthShellProps) {
  const { auth } = useProductHost();
  const {
    signIn,
    submitting,
    error,
    signInAvailable,
    signInChecking,
    signInUnavailableDescription,
    cancelSignIn,
  } = useGitHubSignIn();
  const {
    signIn: signInWithSso,
    submitting: ssoSubmitting,
    error: ssoError,
    signInAvailable: ssoSignInAvailable,
    signInChecking: ssoSignInChecking,
    signInUnavailableDescription: ssoSignInUnavailableDescription,
    displayName: ssoDisplayName,
    cancelSignIn: cancelSsoSignIn,
  } = useSsoSignIn();
  const {
    signIn: signInWithPassword,
    submitting: passwordSubmitting,
    error: passwordError,
    signInAvailable: passwordSignInAvailable,
  } = usePasswordSignIn();
  const busy = submitting || ssoSubmitting || passwordSubmitting;
  const handleCancelSignIn = ssoSubmitting ? cancelSsoSignIn : cancelSignIn;
  const hostIssue = auth.state.status === "anonymous"
    ? productAuthIssueMessage(auth.state.issue)
    : null;

  return (
    <AuthScreenLayout
      mode={mode}
      markComplete={markComplete}
      onMarkResolved={onMarkResolved}
      submitting={submitting}
      busy={busy}
      error={error ?? ssoError ?? passwordError ?? hostIssue}
      githubSignInAvailable={signInAvailable}
      githubSignInChecking={signInChecking}
      githubSignInUnavailableDescription={signInUnavailableDescription}
      ssoSubmitting={ssoSubmitting}
      ssoSignInAvailable={ssoSignInAvailable}
      ssoSignInChecking={ssoSignInChecking}
      ssoSignInUnavailableDescription={ssoSignInUnavailableDescription}
      ssoDisplayName={ssoDisplayName}
      passwordSignInAvailable={passwordSignInAvailable}
      passwordSubmitting={passwordSubmitting}
      onGitHubSignIn={() => {
        void signIn();
      }}
      onSsoSignIn={() => {
        void signInWithSso();
      }}
      onPasswordSignIn={(email, password) => {
        void signInWithPassword(email, password).catch(() => {
          // error is already surfaced via the hook's `error` state
        });
      }}
      onCancelSignIn={() => {
        void handleCancelSignIn();
      }}
    />
  );
}
