import { AuthHandoffScreen } from "../components/auth/screen/AuthHandoffScreen";

export function AuthCallbackPage() {
  return (
    <AuthHandoffScreen
      title="Finishing sign in"
      description="Your browser session is ready. Continue in the app to finish account setup."
      stateLabel="Waiting for auth result"
    />
  );
}
