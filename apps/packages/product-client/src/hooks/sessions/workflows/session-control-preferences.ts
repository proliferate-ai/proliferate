import type {
  SessionLiveConfigSnapshot,
  Workspace,
} from "@anyharness/sdk";
import { withUpdatedDefaultModelIdByAgentKind } from "#product/lib/domain/agents/model-options";
import {
  withUpdatedDefaultLiveSessionControlValueByAgentKind,
} from "#product/lib/domain/preferences/user/session-defaults";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

interface PersistDefaultSessionControlPreferenceInput {
  agentKind: string | null | undefined;
  liveConfig: SessionLiveConfigSnapshot | null | undefined;
  rawConfigId: string;
  requestedValue?: string | null | undefined;
  workspaceSurface: Workspace["surface"] | null | undefined;
}

export function shouldPersistDefaultSessionControlPreference(
  workspaceSurface: Workspace["surface"] | null | undefined,
): boolean {
  return workspaceSurface === "standard";
}

export function persistDefaultSessionControlPreference(
  input: PersistDefaultSessionControlPreferenceInput,
): void {
  if (!shouldPersistDefaultSessionControlPreference(input.workspaceSurface)) {
    return;
  }

  const { agentKind, liveConfig, rawConfigId, requestedValue } = input;
  if (!agentKind) {
    return;
  }

  const modelControl = liveConfig?.normalizedControls.model;
  if (
    (rawConfigId === "model" || modelControl?.rawConfigId === rawConfigId)
    && requestedValue != null
  ) {
    persistModelPreference(agentKind, requestedValue);
    return;
  }

  if (!liveConfig) {
    return;
  }

  for (const control of Object.values(liveConfig.normalizedControls)
    .flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])) {
    if (control?.rawConfigId === rawConfigId && control.currentValue != null) {
      persistLiveControlPreference(agentKind, rawConfigId, control.currentValue);
      return;
    }
  }
}

function persistModelPreference(agentKind: string, modelId: string): void {
  const preferenceState = useUserPreferencesStore.getState();
  preferenceState.setMultiple({
    defaultChatAgentKind: agentKind,
    defaultChatModelIdByAgentKind: withUpdatedDefaultModelIdByAgentKind(
      preferenceState.defaultChatModelIdByAgentKind,
      agentKind,
      modelId,
    ),
  });
}

function persistLiveControlPreference(
  agentKind: string,
  key: string,
  value: string,
): void {
  const preferenceState = useUserPreferencesStore.getState();
  const nextDefaults = withUpdatedDefaultLiveSessionControlValueByAgentKind(
    preferenceState.defaultLiveSessionControlValuesByAgentKind,
    agentKind,
    key,
    value,
  );

  if (nextDefaults !== preferenceState.defaultLiveSessionControlValuesByAgentKind) {
    preferenceState.set("defaultLiveSessionControlValuesByAgentKind", nextDefaults);
  }
}
