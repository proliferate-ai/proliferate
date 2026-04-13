import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { OnboardingIntentStep } from "@/components/onboarding/OnboardingIntentStep";
import { OnboardingRecommendationsStep } from "@/components/onboarding/OnboardingRecommendationsStep";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { OnboardingWorkflowStep } from "@/components/onboarding/OnboardingWorkflowStep";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { useOnboardingFlow } from "@/hooks/onboarding/use-onboarding-flow";
import { useOnboardingRecommendationsStep } from "@/hooks/onboarding/use-onboarding-recommendations-step";
import { useOnboardingRequirement } from "@/hooks/onboarding/use-onboarding-requirement";
import { useOnboardingWorkflowStep } from "@/hooks/onboarding/use-onboarding-workflow-step";

export function OnboardingPage() {
  const requirement = useOnboardingRequirement();
  const flow = useOnboardingFlow();
  const workflow = useOnboardingWorkflowStep();
  const recommendations = useOnboardingRecommendationsStep({
    goalId: flow.goalId,
  });

  useEffect(() => {
    trackProductEvent("onboarding_step_viewed", { step: "intent" });
  }, []);

  if (requirement.isHydrated && !requirement.requiresOnboarding) {
    return <Navigate to="/" replace />;
  }

  return (
    <OnboardingShell stepKind={flow.stepKind}>
      {flow.stepKind === "intent" && (
        <OnboardingIntentStep
          goalId={flow.goalId}
          onSelectGoal={flow.setGoalId}
          onContinue={flow.goNext}
        />
      )}
      {flow.stepKind === "workflow" && (
        <OnboardingWorkflowStep
          state={workflow}
          onContinue={() => {
            workflow.persistOpenTarget();
            flow.goNext();
          }}
          onBack={flow.goBack}
        />
      )}
      {flow.stepKind === "recommendations" && (
        <OnboardingRecommendationsStep
          state={recommendations}
          onBack={flow.goBack}
          onContinue={() => {
            flow.completeOnboarding({
              agentKind: recommendations.selectedAgentKind ?? "",
              modelId: recommendations.selectedModelId ?? "",
              modeId: recommendations.selectedModeId,
            });
          }}
          onComplete={() => {
            // Registries not ready — defer defaults to the finalizer.
            flow.completeOnboarding({
              agentKind: "",
              modelId: "",
              modeId: null,
            });
          }}
        />
      )}
    </OnboardingShell>
  );
}
