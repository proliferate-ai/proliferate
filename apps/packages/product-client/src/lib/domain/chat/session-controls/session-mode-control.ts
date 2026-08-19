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
} from "#product/domain/chats/session-controls/presentation";
import type { DesktopAgentLaunchControl } from "#product/lib/domain/agents/cloud-launch-catalog";

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

export function getNextSessionModeValue(
  options: ReadonlyArray<{ value: string }>,
  currentValue: string | null,
): string | null {
  if (options.length < 2) {
    return null;
  }

  const currentIndex = options.findIndex((option) => option.value === currentValue);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
  return options[nextIndex]?.value ?? null;
}

export {
  inferSessionControlPresentation,
  isConfiguredSessionControlKey,
  listConfiguredSessionControlValues,
  resolveConfiguredSessionControlValue,
  resolveEffectiveConfiguredSessionControlValue,
  resolveSessionControlPresentation,
};
