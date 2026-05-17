import { AuthHandoffScreen } from "../components/auth/screen/AuthHandoffScreen";

export function AuthErrorPage() {
  return (
    <AuthHandoffScreen
      tone="error"
      title="Sign in needs attention"
      description="The sign-in attempt could not be completed. Return to the app and try again."
      stateLabel="Auth error"
    />
  );
}
