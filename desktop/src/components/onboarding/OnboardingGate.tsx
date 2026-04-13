import { Navigate, Outlet } from "react-router-dom";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { useOnboardingRequirement } from "@/hooks/onboarding/use-onboarding-requirement";

const LOADING_MESSAGE = "Restoring your setup";
const LOADING_SUBTEXT = "Loading your saved preferences before opening Proliferate.";

function OnboardingLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <LoadingState message={LOADING_MESSAGE} subtext={LOADING_SUBTEXT} />
    </div>
  );
}

export function OnboardingGate() {
  const { isHydrated, requiresOnboarding } = useOnboardingRequirement();

  if (!isHydrated) {
    return <OnboardingLoadingScreen />;
  }

  if (requiresOnboarding) {
    return <Navigate to="/setup" replace />;
  }

  return <Outlet />;
}

export function OnboardingRoute() {
  const { isHydrated } = useOnboardingRequirement();

  if (!isHydrated) {
    return <OnboardingLoadingScreen />;
  }

  return <Outlet />;
}
