import type { NormalizedSessionControl } from "@anyharness/sdk";
import type { ConfiguredSessionControlValue } from "#product/lib/domain/chat/session-controls/presentation";
import {
  inferSessionControlPresentation,
  listConfiguredSessionControlValues,
} from "#product/lib/domain/chat/session-controls/session-mode-control";

export interface PlanHandoffPrePromptConfigChange {
  rawConfigId: string;
  value: string;
}

const PLAN_MODE_VALUE = "plan";
const DEFAULT_COLLABORATION_MODE_VALUE = "default";

export function listPlanHandoffModeOptions(
  agentKind: string | null | undefined,
  unattendedModeId?: string | null,
): ConfiguredSessionControlValue[] {
  const options = listConfiguredSessionControlValues(agentKind, "mode").filter(
    (value) => value.value !== PLAN_MODE_VALUE,
  );
  const unattended = unattendedModeId?.trim() || undefined;
  if (!unattended || options.some((option) => option.value === unattended)) {
    return options;
  }
  const label = humanizeModeId(unattended);
  return [
    ...options,
    {
      value: unattended,
      label,
      shortLabel: label,
      description: null,
      icon: inferSessionControlPresentation(unattended).icon,
    },
  ];
}

export function resolvePlanHandoffModeId(
  agentKind: string | null | undefined,
  unattendedModeId: string | null | undefined,
): string | undefined {
  const trimmedAgentKind = agentKind?.trim() ?? "";
  if (!trimmedAgentKind) {
    return undefined;
  }

  const unattended = unattendedModeId?.trim() || undefined;
  return unattended === PLAN_MODE_VALUE ? undefined : unattended;
}

export function resolvePlanHandoffModeIdFromOptions(
  configuredDefault: string | null | undefined,
  options: Array<{ value: string }>,
): string | undefined {
  const trimmedDefault = configuredDefault?.trim() ?? "";
  if (trimmedDefault && options.some((option) => option.value === trimmedDefault)) {
    return trimmedDefault;
  }

  return undefined;
}

function humanizeModeId(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
