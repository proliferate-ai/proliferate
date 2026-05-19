import { AuthHandoffScreen } from "../components/auth/screen/AuthHandoffScreen";
import { routes } from "../config/routes";

export function DesktopHandoffPage() {
  return (
    <AuthHandoffScreen
      title="Open Proliferate Desktop"
      description="Continue in Desktop to attach this cloud session to your local workspace."
      stateLabel="Desktop handoff"
      primaryActionLabel="Open desktop"
      primaryActionHref="proliferate://"
      secondaryActionLabel="Go to dashboard"
      secondaryActionHref={routes.home}
    />
  );
}
