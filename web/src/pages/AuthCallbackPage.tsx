import { AuthHandoffScreen } from "../components/auth/screen/AuthHandoffScreen";
import { routes } from "../config/routes";

export function AuthCallbackPage() {
  const desktopHref = `proliferate://auth/callback${window.location.search}`;
  return (
    <AuthHandoffScreen
      title="Finishing sign in"
      description="Your browser session is ready. Continue in the app to finish account setup."
      stateLabel="Waiting for auth result"
      primaryActionLabel="Open desktop"
      primaryActionHref={desktopHref}
      secondaryActionLabel="Go to dashboard"
      secondaryActionHref={routes.home}
    />
  );
}
