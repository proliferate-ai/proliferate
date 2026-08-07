import type {
  NormalizedSessionControls,
  SessionLiveConfigSnapshot,
  Workspace,
} from "@anyharness/sdk";
import { withUpdatedDefaultModelIdByAgentKind } from "#product/lib/domain/agents/model-options";
import { withUpdatedDefaultSessionModeByAgentKind } from "#product/lib/domain/chat/session-controls/session-mode-control";
import {
  withUpdatedDefaultLiveSessionControlValueByAgentKind,
  type DefaultLiveSessionControlKey,
} from "#product/lib/domain/preferences/user/session-defaults";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

interface PersistDefaultSessionControlPreferenceInput {
  agentKind: string | null | undefined;
  liveConfig: SessionLiveConfigSnapshot | null | undefined;
  rawConfigId: string;
  requestedValue?: string | null | undefined;
  workspaceSurface: Workspace["surface"] | null | undefined;
}

type PersistedLiveControlAccessor = keyof Pick<
  NormalizedSessionControls,
  "collaborationMode" | "reasoning" | "effort" | "fastMode"
>;

const LIVE_CONTROL_PREFERENCES: Array<{
  key: DefaultLiveSessionControlKey;
  accessor: PersistedLiveControlAccessor;
}> = [
  { key: "collaboration_mode", accessor: "collaborationMode" },
  { key: "reasoning", accessor: "reasoning" },
  { key: "effort", accessor: "effort" },
  { key: "fast_mode", accessor: "fastMode" },
];

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

  const modeControl = liveConfig.normalizedControls.mode;
  if (modeControl?.rawConfigId === rawConfigId) {
    persistModePreference(agentKind, modeControl.currentValue);
    return;
  }

  for (const { key, accessor } of LIVE_CONTROL_PREFERENCES) {
    const control = liveConfig.normalizedControls[accessor];
    if (control?.rawConfigId === rawConfigId && control.currentValue != null) {
      persistLiveControlPreference(agentKind, key, control.currentValue);
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

function persistModePreference(
  agentKind: string,
  modeId: string | null | undefined,
): void {
  const preferenceState = useUserPreferencesStore.getState();
  const nextDefaults = withUpdatedDefaultSessionModeByAgentKind(
    preferenceState.defaultSessionModeByAgentKind,
    agentKind,
    modeId,
  );

  if (nextDefaults !== preferenceState.defaultSessionModeByAgentKind) {
    preferenceState.set("defaultSessionModeByAgentKind", nextDefaults);
  }
}

function persistLiveControlPreference(
  agentKind: string,
  key: DefaultLiveSessionControlKey,
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
