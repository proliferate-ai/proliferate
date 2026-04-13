import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { CURRENT_ONBOARDING_VERSION } from "@/config/onboarding";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export interface OnboardingRequirement {
  isHydrated: boolean;
  requiresOnboarding: boolean;
}

// Replaces useSetupRequirements. A fresh profile (or one below the current
// onboarding version) is sent through onboarding before any authed screen is
// rendered. The background finalizer is responsible for filling in missing
// chat defaults once registries become available — we intentionally do NOT
// re-gate on empty defaults, so a user who finished onboarding while
// registries were still loading is not trapped back in /setup.
export function useOnboardingRequirement(): OnboardingRequirement {
  const state = useUserPreferencesStore(
    useShallow((s) => ({
      hydrated: s._hydrated,
      onboardingCompletedVersion: s.onboardingCompletedVersion,
    })),
  );

  return useMemo<OnboardingRequirement>(
    () => ({
      isHydrated: state.hydrated,
      requiresOnboarding:
        state.hydrated
        && state.onboardingCompletedVersion < CURRENT_ONBOARDING_VERSION,
    }),
    [state.hydrated, state.onboardingCompletedVersion],
  );
}
