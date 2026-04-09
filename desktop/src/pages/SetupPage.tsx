import { Navigate } from "react-router-dom";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { useSetupPageState } from "@/hooks/setup/use-setup-page-state";

export function SetupPage() {
  const state = useSetupPageState();

  if (state.isComplete) {
    return <Navigate to="/" replace />;
  }

  return <SetupScreen {...state} />;
}
