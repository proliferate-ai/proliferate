import { useCallback, useMemo, useState } from "react";
import {
  useSetupChatDefaultsStep,
  type SetupChatDefaultsState,
} from "@/hooks/setup/use-setup-chat-defaults-step";
import {
  useSetupOpenTargetStep,
  type SetupOpenTargetStepState,
} from "@/hooks/setup/use-setup-open-target-step";
import { type SetupRequirementKind } from "./use-setup-requirements";

const ORDERED_STEPS: SetupRequirementKind[] = ["open-target", "chat-defaults"];

export interface SetupPageState {
  isComplete: boolean;
  requirementKind: SetupRequirementKind | null;
  remainingRequirements: number;
  stepIndex: number;
  stepCount: number;
  openTargetStep: SetupOpenTargetStepState;
  chatDefaultsStep: SetupChatDefaultsState;
}

export function useSetupPageState(): SetupPageState {
  const openTargetStep = useSetupOpenTargetStep();
  const chatDefaultsStep = useSetupChatDefaultsStep();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const advanceStep = useCallback(() => {
    setCurrentStepIndex((index) => index + 1);
  }, []);

  const onContinueOpenTarget = useCallback(() => {
    openTargetStep.onContinue();
    advanceStep();
  }, [advanceStep, openTargetStep.onContinue]);

  const onContinueChatDefaults = useCallback(() => {
    chatDefaultsStep.onContinue();
    advanceStep();
  }, [advanceStep, chatDefaultsStep.onContinue]);

  const currentStepKind = ORDERED_STEPS[currentStepIndex] ?? null;
  const displayedStepIndex = Math.min(currentStepIndex + 1, ORDERED_STEPS.length);
  const isComplete = currentStepKind === null;

  const openTargetFlowStep = useMemo(() => ({
    ...openTargetStep,
    onContinue: onContinueOpenTarget,
  }), [onContinueOpenTarget, openTargetStep]);
  const chatDefaultsFlowStep = useMemo(() => ({
    ...chatDefaultsStep,
    onContinue: onContinueChatDefaults,
  }), [chatDefaultsStep, onContinueChatDefaults]);

  return useMemo(() => ({
    chatDefaultsStep: chatDefaultsFlowStep,
    isComplete,
    openTargetStep: openTargetFlowStep,
    remainingRequirements: Math.max(ORDERED_STEPS.length - currentStepIndex, 0),
    requirementKind: currentStepKind,
    stepCount: ORDERED_STEPS.length,
    stepIndex: displayedStepIndex,
  }), [
    chatDefaultsFlowStep,
    currentStepIndex,
    currentStepKind,
    displayedStepIndex,
    isComplete,
    openTargetFlowStep,
  ]);
}
