import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ONBOARDING_COPY,
  type OnboardingGoalId,
} from "@/config/onboarding";
import { parseOnboardingHomeLandingState } from "@/lib/domain/onboarding/home-landing";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";

export interface HomeOnboardingLanding {
  active: boolean;
  goalId: OnboardingGoalId | null;
  heroTitle: string | null;
  heroDetail: string | null;
}

export function useHomeOnboardingLanding(): HomeOnboardingLanding {
  const location = useLocation();
  const navigate = useNavigate();
  const consumedRef = useRef(false);
  const [snapshot, setSnapshot] = useState<{
    active: boolean;
    goalId: OnboardingGoalId | null;
  }>(() => {
    const parsed = parseOnboardingHomeLandingState(location.state);
    if (!parsed) {
      return { active: false, goalId: null };
    }
    return { active: true, goalId: parsed.goalId };
  });

  useEffect(() => {
    if (consumedRef.current) {
      return;
    }
    const parsed = parseOnboardingHomeLandingState(location.state);
    if (!parsed) {
      return;
    }
    consumedRef.current = true;
    trackProductEvent("onboarding_home_landing_viewed", {
      goal_id: parsed.goalId,
    });
    // Clear the one-shot state so a back navigation or refresh doesn't
    // retrigger the personalized hero.
    navigate(location.pathname, { replace: true, state: null });
    setSnapshot({ active: true, goalId: parsed.goalId });
  }, [location.pathname, location.state, navigate]);

  return useMemo<HomeOnboardingLanding>(
    () => ({
      active: snapshot.active,
      goalId: snapshot.goalId,
      heroTitle: snapshot.active ? ONBOARDING_COPY.homeLandingTitle : null,
      heroDetail: snapshot.goalId
        ? ONBOARDING_COPY.homeLandingDetailByGoal[snapshot.goalId]
        : null,
    }),
    [snapshot.active, snapshot.goalId],
  );
}
