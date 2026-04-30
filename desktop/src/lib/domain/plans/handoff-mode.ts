import type { NormalizedSessionControl } from "@anyharness/sdk";
import { PLAN_HANDOFF_DEFAULT_MODE_ID_BY_AGENT_KIND } from "@/config/plan-handoff-session-mode-defaults";
import type { ConfiguredSessionControlValue } from "@/config/session-control-presentations";
import { listConfiguredSessionControlValues } from "@/lib/domain/chat/session-mode-control";

export interface PlanHandoffPrePromptConfigChange {
  rawConfigId: string;
  value: string;
}

const PLAN_MODE_VALUE = "plan";
const DEFAULT_COLLABORATION_MODE_VALUE = "default";

export function listPlanHandoffModeOptions(
  agentKind: string | null | undefined,
): ConfiguredSessionControlValue[] {
  return listConfiguredSessionControlValues(agentKind, "mode").filter(
    (value) => value.value !== PLAN_MODE_VALUE,
  );
}

export function resolvePlanHandoffModeId(
  agentKind: string | null | undefined,
): string | undefined {
  const trimmedAgentKind = agentKind?.trim() ?? "";
  if (!trimmedAgentKind) {
    return undefined;
  }

  const options = listPlanHandoffModeOptions(trimmedAgentKind);
  const configuredDefault = PLAN_HANDOFF_DEFAULT_MODE_ID_BY_AGENT_KIND[trimmedAgentKind];
  return resolvePlanHandoffModeIdFromOptions(configuredDefault, options);
}

export function resolvePlanHandoffModeIdFromOptions(
  configuredDefault: string | null | undefined,
  options: Array<{ value: string }>,
): string | undefined {
  const trimmedDefault = configuredDefault?.trim() ?? "";
  if (trimmedDefault && options.some((option) => option.value === trimmedDefault)) {
    return trimmedDefault;
  }

  return options[0]?.value;
}

export function resolvePlanHandoffPrePromptConfigChanges(
  collaborationMode: NormalizedSessionControl | null | undefined,
): PlanHandoffPrePromptConfigChange[] {
  if (!collaborationMode?.settable || collaborationMode.currentValue !== PLAN_MODE_VALUE) {
    return [];
  }

  const defaultValue = collaborationMode.values.find(
    (value) => value.value === DEFAULT_COLLABORATION_MODE_VALUE,
  );
  if (!defaultValue) {
    return [];
  }

  return [{
    rawConfigId: collaborationMode.rawConfigId,
    value: defaultValue.value,
  }];
}
