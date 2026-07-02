import {
  inferSessionControlPresentation,
  isConfiguredSessionControlKey,
  launchControlToConfiguredSessionControlValues as sharedLaunchControlToConfiguredSessionControlValues,
  listConfiguredSessionControlValues,
  resolveConfiguredSessionControlValue,
  resolveEffectiveConfiguredSessionControlValue,
  resolveSessionControlPresentation,
  type ConfiguredSessionControlValue,
  type SessionControlIconKey,
} from "@proliferate/product-domain/chats/session-controls/presentation";
import type { DesktopAgentLaunchControl } from "@/lib/domain/agents/cloud-launch-catalog";

export type SessionModeIconKey = SessionControlIconKey;

export interface SessionModePresentation {
  icon: SessionModeIconKey | null;
  shortLabel?: string | null;
}

export function launchControlToConfiguredSessionControlValues(
  agentKind: string | null | undefined,
  control: DesktopAgentLaunchControl | null | undefined,
): ConfiguredSessionControlValue[] {
  return sharedLaunchControlToConfiguredSessionControlValues(agentKind, control);
}

export function withUpdatedDefaultSessionModeByAgentKind(
  defaultsByAgentKind: Record<string, string>,
  agentKind: string,
  modeId: string | null | undefined,
): Record<string, string> {
  const trimmedAgentKind = agentKind.trim();
  const trimmedModeId = modeId?.trim() ?? "";
  if (!trimmedAgentKind || !trimmedModeId) {
    return defaultsByAgentKind;
  }

  if (defaultsByAgentKind[trimmedAgentKind] === trimmedModeId) {
    return defaultsByAgentKind;
  }

  return {
    ...defaultsByAgentKind,
    [trimmedAgentKind]: trimmedModeId,
  };
}

export function getPreviousSessionModeValue(
  options: Array<{ value: string }>,
  currentValue: string | null,
): string | null {
  if (options.length < 2) {
    return null;
  }

  const currentIndex = options.findIndex((option) => option.value === currentValue);
  if (currentIndex <= 0) {
    return options[options.length - 1]?.value ?? null;
  }

  return options[currentIndex - 1]?.value ?? null;
}

export {
  inferSessionControlPresentation,
  isConfiguredSessionControlKey,
  listConfiguredSessionControlValues,
  resolveConfiguredSessionControlValue,
  resolveEffectiveConfiguredSessionControlValue,
  resolveSessionControlPresentation,
};
