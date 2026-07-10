import { useLoginPage } from "@/hooks/auth/facade/use-login-page";
import { AuthScreenLayout } from "@/components/auth/AuthScreenLayout";
import { OrgSsoLoginLink } from "@/components/auth/OrgSsoLoginLink";

export function LoginPage() {
  const {
    submitting,
    busy,
    error,
    githubSignInAvailable,
    githubSignInChecking,
    githubSignInUnavailableDescription,
    ssoSubmitting,
    ssoSignInAvailable,
    ssoSignInChecking,
    ssoSignInUnavailableDescription,
    ssoDisplayName,
    passwordSignInAvailable,
    passwordSubmitting,
    handleGitHubSignIn,
    handleSsoSignIn,
    handlePasswordSignIn,
    handleCancelSignIn,
    handleContinueLocally,
    canContinueLocally,
  } = useLoginPage();

  return (
    <>
      <AuthScreenLayout
        mode="auth"
        markComplete
        submitting={submitting}
        busy={busy}
        error={error}
        githubSignInAvailable={githubSignInAvailable}
        githubSignInChecking={githubSignInChecking}
        githubSignInUnavailableDescription={githubSignInUnavailableDescription}
        ssoSubmitting={ssoSubmitting}
        ssoSignInAvailable={ssoSignInAvailable}
        ssoSignInChecking={ssoSignInChecking}
        ssoSignInUnavailableDescription={ssoSignInUnavailableDescription}
        ssoDisplayName={ssoDisplayName}
        passwordSignInAvailable={passwordSignInAvailable}
        passwordSubmitting={passwordSubmitting}
        onGitHubSignIn={() => void handleGitHubSignIn()}
        onSsoSignIn={() => void handleSsoSignIn()}
        onPasswordSignIn={(email, password) => void handlePasswordSignIn(email, password)}
        onCancelSignIn={handleCancelSignIn}
        canContinueLocally={canContinueLocally}
        onContinueLocally={handleContinueLocally}
      />
      <div className="pointer-events-none fixed inset-x-0 bottom-10 flex justify-center px-8">
        <div className="pointer-events-auto w-full max-w-md text-center">
          <OrgSsoLoginLink />
        </div>
      </div>
    </>
  );
}
