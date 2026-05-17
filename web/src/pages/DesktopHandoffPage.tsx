import { AuthHandoffScreen } from "../components/auth/screen/AuthHandoffScreen";

export function DesktopHandoffPage() {
  return (
    <AuthHandoffScreen
      title="Open Proliferate Desktop"
      description="Continue in Desktop to attach this cloud session to your local workspace."
      stateLabel="Desktop handoff"
    />
  );
}
