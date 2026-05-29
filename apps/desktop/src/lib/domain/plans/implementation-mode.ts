import type { NormalizedSessionControl } from "@anyharness/sdk";

interface PlanImplementationModeSwitchInput {
  collaborationMode?: NormalizedSessionControl | null;
  mode?: NormalizedSessionControl | null;
}

interface PlanImplementationModeSwitch {
  rawConfigId: string;
  value: string;
}

export function resolvePlanImplementationModeSwitch(
  input: PlanImplementationModeSwitchInput,
): PlanImplementationModeSwitch | null {
  return switchForPlanControl(input.collaborationMode) ?? switchForPlanControl(input.mode);
}

function switchForPlanControl(
  control: NormalizedSessionControl | null | undefined,
): PlanImplementationModeSwitch | null {
  if (!control?.settable || control.currentValue !== "plan") {
    return null;
  }

  const defaultValue = control.values.find((value) => value.value === "default");
  if (!defaultValue) {
    return null;
  }

  return {
    rawConfigId: control.rawConfigId,
    value: defaultValue.value,
  };
}
