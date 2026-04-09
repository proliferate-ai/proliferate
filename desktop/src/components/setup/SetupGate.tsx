import { Navigate, Outlet } from "react-router-dom";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { SETUP_COPY } from "@/config/setup";
import { useSetupRequirements } from "@/hooks/setup/use-setup-requirements";

function SetupLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <LoadingState
        message={SETUP_COPY.loadingMessage}
        subtext={SETUP_COPY.loadingSubtext}
      />
    </div>
  );
}

export function SetupGate() {
  const { isHydrated, requiresSetup } = useSetupRequirements();

  if (!isHydrated) {
    return <SetupLoadingScreen />;
  }

  if (requiresSetup) {
    return <Navigate to="/setup" replace />;
  }

  return <Outlet />;
}

export function SetupRoute() {
  const { isHydrated } = useSetupRequirements();

  if (!isHydrated) {
    return <SetupLoadingScreen />;
  }

  return <Outlet />;
}
