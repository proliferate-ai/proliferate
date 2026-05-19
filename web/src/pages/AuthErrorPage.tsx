import { useSearchParams } from "react-router-dom";

import { AuthHandoffScreen } from "../components/auth/screen/AuthHandoffScreen";
import { routes } from "../config/routes";

export function AuthErrorPage() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");

  return (
    <AuthHandoffScreen
      tone="error"
      title="Sign in needs attention"
      description={
        code
          ? `The sign-in attempt could not be completed: ${code}`
          : "The sign-in attempt could not be completed. Return to the app and try again."
      }
      stateLabel="Auth error"
      primaryActionLabel="Try again"
      primaryActionHref={routes.auth}
      secondaryActionLabel="Go to dashboard"
      secondaryActionHref={routes.home}
    />
  );
}
