import { Button } from "@/components/ui/Button";
import { SelectionRow } from "@/components/ui/SelectionRow";
import { OpenTargetIcon } from "@/components/workspace/open-target/OpenTargetIcon";
import { ONBOARDING_COPY } from "@/config/onboarding";
import type { OnboardingWorkflowStepState } from "@/hooks/onboarding/use-onboarding-workflow-step";

interface OnboardingWorkflowStepProps {
  state: OnboardingWorkflowStepState;
  onContinue: () => void;
  onBack: () => void;
}

export function OnboardingWorkflowStep({
  state,
  onContinue,
  onBack,
}: OnboardingWorkflowStepProps) {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {ONBOARDING_COPY.openTargetLabel}
        </p>
        <div className="space-y-1.5">
          {state.openTargetOptions.map((option) => (
            <SelectionRow
              key={option.id}
              selected={option.id === state.selectedOpenTargetId}
              onClick={() => state.setOpenTargetId(option.id)}
              icon={
                option.iconId
                  ? <OpenTargetIcon iconId={option.iconId} className="size-5 rounded-sm" />
                  : undefined
              }
              label={option.label}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {ONBOARDING_COPY.openTargetDetail}
        </p>
      </section>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onBack}
          className="h-11 flex-1"
        >
          Back
        </Button>
        <Button
          type="button"
          size="md"
          onClick={onContinue}
          disabled={!state.canContinue}
          className="h-11 flex-[2]"
        >
          {ONBOARDING_COPY.continueAction}
        </Button>
      </div>
    </div>
  );
}
