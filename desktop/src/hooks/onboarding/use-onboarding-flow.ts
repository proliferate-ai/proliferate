import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  CURRENT_ONBOARDING_VERSION,
  ONBOARDING_STEP_ORDER,
  type OnboardingGoalId,
  type OnboardingStepKind,
} from "@/config/onboarding";
import { buildAcceptedOnboardingDefaultsUpdate } from "@/lib/domain/onboarding/defaults";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import type { OnboardingHomeLandingState } from "@/lib/domain/onboarding/home-landing";

export interface OnboardingFlowState {
  stepKind: OnboardingStepKind;
  stepIndex: number;
  stepCount: number;
  goalId: OnboardingGoalId | "";
  setGoalId: (goalId: OnboardingGoalId) => void;
  goNext: () => void;
  goBack: () => void;
  completeOnboarding: (args: {
    agentKind: string;
    modelId: string;
    modeId: string | null;
  }) => void;
}

export function useOnboardingFlow(): OnboardingFlowState {
  const navigate = useNavigate();
  const preferences = useUserPreferencesStore(
    useShallow((state) => ({
      onboardingPrimaryGoalId: state.onboardingPrimaryGoalId,
      defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
      defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
      setMultiple: state.setMultiple,
    })),
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [goalId, setGoalIdState] = useState<OnboardingGoalId | "">(
    preferences.onboardingPrimaryGoalId,
  );

  const stepKind = ONBOARDING_STEP_ORDER[stepIndex] ?? "recommendations";

  const setGoalId = useCallback((next: OnboardingGoalId) => {
    setGoalIdState(next);
  }, []);

  const goNext = useCallback(() => {
    setStepIndex((current) => {
      const nextIndex = Math.min(current + 1, ONBOARDING_STEP_ORDER.length - 1);
      const nextKind = ONBOARDING_STEP_ORDER[nextIndex];
      if (nextKind) {
        trackProductEvent("onboarding_step_viewed", { step: nextKind });
      }
      return nextIndex;
    });
  }, []);

  const goBack = useCallback(() => {
    setStepIndex((current) => Math.max(current - 1, 0));
  }, []);

  const completeOnboarding = useCallback<OnboardingFlowState["completeOnboarding"]>(
    ({ agentKind, modelId, modeId }) => {
      preferences.setMultiple({
        onboardingCompletedVersion: CURRENT_ONBOARDING_VERSION,
        onboardingPrimaryGoalId: goalId || "",
        // Only write defaults if we actually have a recommendation. Empty
        // agentKind/modelId means the finalizer will fill them in later
        // once registries become available.
        ...buildAcceptedOnboardingDefaultsUpdate(preferences, {
          agentKind,
          modelId,
          modeId,
        }),
      });

      trackProductEvent("onboarding_completed", {
        goal_id: goalId || null,
        recommended_agent_kind: agentKind || null,
        deferred_defaults: !agentKind || !modelId,
      });

      const landingState: OnboardingHomeLandingState = {
        onboardingLanding: true,
        goalId: goalId || null,
      };
      navigate("/", { replace: true, state: landingState });
    },
    [goalId, navigate, preferences],
  );

  return useMemo<OnboardingFlowState>(
    () => ({
      stepKind,
      stepIndex: stepIndex + 1,
      stepCount: ONBOARDING_STEP_ORDER.length,
      goalId,
      setGoalId,
      goNext,
      goBack,
      completeOnboarding,
    }),
    [
      completeOnboarding,
      goBack,
      goNext,
      goalId,
      setGoalId,
      stepIndex,
      stepKind,
    ],
  );
}
