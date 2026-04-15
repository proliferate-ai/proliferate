import { isOnboardingGoalId, type OnboardingGoalId } from "@/config/onboarding";

// Shape of the one-shot route state handed to the home surface when onboarding
// completes. The consumer reads it once and clears it — see
// useHomeOnboardingLanding.
export interface OnboardingHomeLandingState {
  onboardingLanding: true;
  goalId: OnboardingGoalId | null;
}

export function parseOnboardingHomeLandingState(
  value: unknown,
): OnboardingHomeLandingState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.onboardingLanding !== true) {
    return null;
  }

  const goalId = isOnboardingGoalId(record.goalId) ? record.goalId : null;
  return { onboardingLanding: true, goalId };
}
