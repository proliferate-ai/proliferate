import { AuthScreenLayout } from "@/components/auth/AuthScreenLayout";
import { useGitHubSignIn } from "@/hooks/auth/workflows/use-github-sign-in";

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
  } = useGitHubSignIn();

  return (
    <AuthScreenLayout
      mode={mode}
      markComplete={markComplete}
      onMarkResolved={onMarkResolved}
      submitting={submitting}
      busy={submitting}
      error={error}
      githubSignInAvailable={signInAvailable}
      githubSignInChecking={signInChecking}
      githubSignInUnavailableDescription={signInUnavailableDescription}
      onGitHubSignIn={() => {
        void signIn();
      }}
    />
  );
}
