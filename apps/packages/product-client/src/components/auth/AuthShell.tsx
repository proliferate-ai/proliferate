import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import { AuthScreenLayout } from "#product/components/auth/AuthScreenLayout";
import { describeAuthIssue } from "#product/lib/domain/auth/describe-auth-issue";
import { useGitHubSignIn } from "#product/hooks/auth/workflows/use-github-sign-in";
import { usePasswordSignIn } from "#product/hooks/auth/workflows/use-password-sign-in";

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
    signIn: signInWithPassword,
    submitting: passwordSubmitting,
    error: passwordError,
    signInAvailable: passwordSignInAvailable,
  } = usePasswordSignIn();
  const busy = submitting || passwordSubmitting;

  const { auth } = useProductHost();
  const issue = auth.state.status === "anonymous" ? auth.state.issue : undefined;

  return (
    <AuthScreenLayout
      mode={mode}
      markComplete={markComplete}
      onMarkResolved={onMarkResolved}
      submitting={submitting}
      busy={busy}
      error={error ?? passwordError ?? (issue ? describeAuthIssue(issue) : null)}
      githubSignInAvailable={signInAvailable}
      githubSignInChecking={signInChecking}
      githubSignInUnavailableDescription={signInUnavailableDescription}
      passwordSignInAvailable={passwordSignInAvailable}
      passwordSubmitting={passwordSubmitting}
      onGitHubSignIn={() => {
        void signIn().catch(() => {
          // error is already surfaced via the hook's `error` state
        });
      }}
      onPasswordSignIn={(email, password) => {
        void signInWithPassword(email, password).catch(() => {
          // error is already surfaced via the hook's `error` state
        });
      }}
      onCancelSignIn={() => {
        void cancelSignIn();
      }}
    />
  );
}
