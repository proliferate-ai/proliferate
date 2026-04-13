import { Button } from "@/components/ui/Button";
import { SelectionRow } from "@/components/ui/SelectionRow";
import {
  ONBOARDING_COPY,
  ONBOARDING_GOALS,
  type OnboardingGoalId,
} from "@/config/onboarding";

interface OnboardingIntentStepProps {
  goalId: OnboardingGoalId | "";
  onSelectGoal: (goalId: OnboardingGoalId) => void;
  onContinue: () => void;
}

export function OnboardingIntentStep({
  goalId,
  onSelectGoal,
  onContinue,
}: OnboardingIntentStepProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        {ONBOARDING_GOALS.map((goal) => {
          const Icon = goal.icon;
          return (
            <SelectionRow
              key={goal.id}
              selected={goal.id === goalId}
              onClick={() => onSelectGoal(goal.id)}
              icon={<Icon className="size-5" />}
              label={goal.label}
              subtitle={goal.description}
            />
          );
        })}
      </div>

      <Button
        type="button"
        size="md"
        onClick={onContinue}
        disabled={!goalId}
        className="h-11 w-full"
      >
        {ONBOARDING_COPY.continueAction}
      </Button>
    </div>
  );
}
