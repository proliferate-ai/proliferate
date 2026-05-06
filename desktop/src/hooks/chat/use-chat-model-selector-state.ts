import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { CHAT_MODEL_SELECTOR_LABELS } from "@/config/chat";
import { getProviderDisplayName } from "@/config/providers";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { getPendingSessionConfigChange } from "@/lib/domain/sessions/pending-config";
import {
  resolveMatchingModelControlLabel,
  resolveModelDisplayName,
} from "@/lib/domain/chat/model-display";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useActiveSessionLaunchState } from "./use-active-chat-session-selectors";
import { useConfiguredLaunchReadiness } from "./use-configured-launch-readiness";
import { useChatLaunchActions } from "./use-chat-launch-actions";
import { useChatLaunchCatalog } from "./use-chat-launch-catalog";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import {
  resolveToggleState,
  type LiveSessionControlDescriptor,
  type SupportedLiveControlKey,
} from "@/lib/domain/chat/session-controls";
import type { WorkspaceSessionLaunchControl } from "@anyharness/sdk";

function resolveCurrentModelDisplayName(args: {
  activeLaunchIdentity: { kind: string; modelId: string } | null;
  defaultLaunchSelection: { kind: string; modelId: string } | null;
  launchAgents: Array<{
    kind: string;
    models: Array<{ id: string; displayName: string }>;
  }>;
  liveConfigLabel: string | null;
}) {
  const selection = args.activeLaunchIdentity ?? args.defaultLaunchSelection;
  if (!selection) {
    return null;
  }

  const agent = args.launchAgents.find((candidate) => candidate.kind === selection.kind);
  const model = agent?.models.find((candidate) => candidate.id === selection.modelId);
  return resolveModelDisplayName({
    agentKind: selection.kind,
    modelId: selection.modelId,
    sourceLabels: [
      args.liveConfigLabel,
      model?.displayName,
    ],
    preferKnownAlias: true,
  });
}

export function useChatModelSelectorState(options?: { suppressActiveSessionState?: boolean }) {
  const suppressActiveSessionState = options?.suppressActiveSessionState ?? false;
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const {
    activeSessionId,
    currentLaunchIdentity,
    pendingConfigChanges,
    modelControl,
  } = useActiveSessionLaunchState();
  const scopedActiveSessionId = suppressActiveSessionState ? null : activeSessionId;
  const scopedLaunchIdentity = suppressActiveSessionState ? null : currentLaunchIdentity;
  const scopedPendingConfigChanges = suppressActiveSessionState ? null : pendingConfigChanges;
  const scopedModelControl = suppressActiveSessionState ? null : modelControl;
  const activeLaunchIntent = useChatLaunchIntentStore((state) => state.activeIntent);
  const launchIntentIdentity = useMemo(() => (
    !suppressActiveSessionState
    && !scopedActiveSessionId
    && activeLaunchIntent?.agentKind
    && activeLaunchIntent.modelId
      ? {
        kind: activeLaunchIntent.agentKind,
        modelId: activeLaunchIntent.modelId,
      }
      : null
  ), [
    activeLaunchIntent?.agentKind,
    activeLaunchIntent?.modelId,
    scopedActiveSessionId,
    suppressActiveSessionState,
  ]);
  const { handleLaunchSelect } = useChatLaunchActions({ suppressActiveSessionState });
  const { setActiveSessionConfigOption } = useSessionActions();
  const configuredLaunch = useConfiguredLaunchReadiness(scopedLaunchIdentity ?? launchIntentIdentity);
  const launchCatalog = useChatLaunchCatalog({
    activeSelection: scopedLaunchIdentity ?? launchIntentIdentity ?? configuredLaunch.selection,
    activeModelControl: scopedLaunchIdentity && scopedModelControl
      ? {
        kind: scopedLaunchIdentity.kind,
        values: scopedModelControl.values,
      }
      : null,
  });
  const { hasAgents, isLoading: agentsLoading, notReadyAgents } = useAgentCatalog();
  const launchControlPreferences = useUserPreferencesStore(useShallow((state) => ({
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
    defaultLiveSessionControlValuesByAgentKind:
      state.defaultLiveSessionControlValuesByAgentKind,
  })));

  const pendingModelChange = getPendingSessionConfigChange(
    scopedPendingConfigChanges,
    scopedModelControl?.rawConfigId ?? null,
  );
  const currentSelection = scopedLaunchIdentity ?? launchIntentIdentity ?? configuredLaunch.selection;
  const displayedModelValue =
    pendingModelChange?.value
    ?? scopedModelControl?.currentValue
    ?? null;
  const liveConfigModelLabel = resolveMatchingModelControlLabel({
    modelId: currentSelection?.modelId,
    control: scopedModelControl,
    displayedModelValue,
  });

  const currentModelDisplayName = useMemo(
    () => resolveCurrentModelDisplayName({
      activeLaunchIdentity: scopedLaunchIdentity ?? launchIntentIdentity,
      defaultLaunchSelection: configuredLaunch.selection,
      launchAgents: launchCatalog.launchAgents,
      liveConfigLabel: liveConfigModelLabel,
    }),
    [
      configuredLaunch.selection,
      launchIntentIdentity,
      launchCatalog.launchAgents,
      liveConfigModelLabel,
      scopedLaunchIdentity,
    ],
  );

  const resolvedConnectionState = selectedCloudRuntime.state?.phase === "ready"
    ? connectionState
    : selectedCloudRuntime.state
      ? "connecting"
      : connectionState;
  const activeLaunchAgentKind = scopedActiveSessionId ? currentSelection?.kind ?? null : null;

  const launchControls = useMemo(
    () => buildLaunchControlDescriptors({
      selection: currentSelection,
      launchAgents: launchCatalog.launchAgents,
      pendingConfigChanges: scopedPendingConfigChanges,
      preferences: launchControlPreferences,
      onActiveSessionSelect: activeLaunchAgentKind
        ? (rawConfigId, value) => {
          void setActiveSessionConfigOption(rawConfigId, value).catch(() => {
            const state = useUserPreferencesStore.getState();
            if (rawConfigId === "mode") {
              state.set("defaultSessionModeByAgentKind", {
                ...state.defaultSessionModeByAgentKind,
                [activeLaunchAgentKind]: value,
              });
              return;
            }
            state.set("defaultLiveSessionControlValuesByAgentKind", {
              ...state.defaultLiveSessionControlValuesByAgentKind,
              [activeLaunchAgentKind]: {
                ...state.defaultLiveSessionControlValuesByAgentKind[activeLaunchAgentKind],
                [rawConfigId]: value,
              },
            });
          });
        }
        : null,
    }),
    [
      currentSelection,
      launchCatalog.launchAgents,
      launchControlPreferences,
      activeLaunchAgentKind,
      scopedPendingConfigChanges,
      setActiveSessionConfigOption,
    ],
  );

  return {
    connectionState: resolvedConnectionState,
    currentModel: currentSelection
      ? {
        kind: currentSelection.kind,
        displayName:
          currentModelDisplayName
          ?? configuredLaunch.displayName
          ?? getProviderDisplayName(currentSelection.kind)
          ?? CHAT_MODEL_SELECTOR_LABELS.unknownModel,
        pendingState: pendingModelChange?.status ?? null,
      }
      : configuredLaunch.configuredKind && configuredLaunch.displayName
        ? {
          kind: configuredLaunch.configuredKind,
          displayName: configuredLaunch.displayName,
          pendingState: null,
        }
        : null,
    groups: launchCatalog.groups,
    hasAgents,
    isLoading: agentsLoading || launchCatalog.isLoading,
    notReadyAgents,
    onSelect: handleLaunchSelect,
    launchControls,
    launchAgentKind: currentSelection?.kind ?? null,
  };
}

export function buildLaunchControlDescriptors(input: {
  selection: { kind: string; modelId: string } | null;
  launchAgents: Array<{
    kind: string;
    launchControls?: WorkspaceSessionLaunchControl[];
    models: Array<{
      id: string;
      launchControls?: WorkspaceSessionLaunchControl[];
    }>;
  }>;
  preferences: {
    defaultSessionModeByAgentKind: Record<string, string>;
    defaultLiveSessionControlValuesByAgentKind: Record<string, Partial<Record<string, string>>>;
  };
  pendingConfigChanges: PendingConfigChangesLike | null;
  onActiveSessionSelect: ((rawConfigId: string, value: string) => void) | null;
}): LiveSessionControlDescriptor[] {
  if (!input.selection) {
    return [];
  }

  const agent = input.launchAgents.find((candidate) => candidate.kind === input.selection?.kind);
  const model = agent?.models.find((candidate) => candidate.id === input.selection?.modelId);
  if (!agent) {
    return [];
  }

  return mergeLaunchControls(agent.launchControls ?? [], model?.launchControls ?? [])
    .flatMap((control) => launchControlToDescriptor({
    agentKind: agent.kind,
    control,
    pendingConfigChanges: input.pendingConfigChanges,
    preferences: input.preferences,
    onActiveSessionSelect: input.onActiveSessionSelect,
  }));
}

type PendingConfigChangesLike = ReturnType<typeof useActiveSessionLaunchState>["pendingConfigChanges"];

function launchControlToDescriptor(input: {
  agentKind: string;
  control: WorkspaceSessionLaunchControl;
  pendingConfigChanges: PendingConfigChangesLike | null;
  preferences: {
    defaultSessionModeByAgentKind: Record<string, string>;
    defaultLiveSessionControlValuesByAgentKind: Record<string, Partial<Record<string, string>>>;
  };
  onActiveSessionSelect: ((rawConfigId: string, value: string) => void) | null;
}): LiveSessionControlDescriptor[] {
  const key = normalizeLaunchControlKey(input.control.key);
  if (!key || input.control.values.length === 0) {
    return [];
  }
  const rawConfigId = input.control.createField === "modeId" ? "mode" : input.control.key;
  const pendingChange = getPendingSessionConfigChange(
    input.pendingConfigChanges,
    rawConfigId,
  );

  const selectedValue = key === "mode"
    ? pendingChange?.value
      || input.preferences.defaultSessionModeByAgentKind[input.agentKind]
      || input.control.defaultValue
      || input.control.values.find((value) => value.isDefault)?.value
      || input.control.values[0]?.value
      || null
    : pendingChange?.value
      || input.preferences.defaultLiveSessionControlValuesByAgentKind[input.agentKind]?.[key]
      || input.control.defaultValue
      || input.control.values.find((value) => value.isDefault)?.value
      || input.control.values[0]?.value
      || null;
  const detail =
    input.control.values.find((value) => value.value === selectedValue)?.label
    ?? selectedValue;

  const descriptorBase = {
    key,
    label: input.control.label,
    detail,
    rawConfigId,
    settable: true,
    pendingState: pendingChange?.status ?? null,
    options: input.control.values.map((value) => ({
      value: value.value,
      label: value.label,
      description: value.description,
      selected: value.value === selectedValue,
    })),
    onSelect: (value) => {
      if (input.onActiveSessionSelect) {
        input.onActiveSessionSelect(rawConfigId, value);
        return;
      }
      const state = useUserPreferencesStore.getState();
      if (key === "mode") {
        state.set("defaultSessionModeByAgentKind", {
          ...state.defaultSessionModeByAgentKind,
          [input.agentKind]: value,
        });
        return;
      }
      state.set("defaultLiveSessionControlValuesByAgentKind", {
        ...state.defaultLiveSessionControlValuesByAgentKind,
        [input.agentKind]: {
          ...state.defaultLiveSessionControlValuesByAgentKind[input.agentKind],
          [key]: value,
        },
      });
    },
  } satisfies Omit<
    LiveSessionControlDescriptor,
    "kind" | "enabledValue" | "disabledValue" | "isEnabled"
  >;

  const toggleState = resolveToggleState({
    key,
    rawConfigId,
    label: input.control.label,
    currentValue: selectedValue,
    settable: true,
    values: input.control.values.map((value) => ({
      value: value.value,
      label: value.label,
      description: value.description,
    })),
  }, selectedValue);

  if (toggleState) {
    return [{
      ...descriptorBase,
      kind: "toggle",
      enabledValue: toggleState.enabledValue,
      disabledValue: toggleState.disabledValue,
      isEnabled: toggleState.isEnabled,
    }];
  }

  return [{
    ...descriptorBase,
    kind: "select",
  }];
}

function normalizeLaunchControlKey(
  key: WorkspaceSessionLaunchControl["key"],
): SupportedLiveControlKey | null {
  if (key === "access_mode") {
    return "mode";
  }
  if (
    key === "mode"
    || key === "collaboration_mode"
    || key === "reasoning"
    || key === "effort"
    || key === "fast_mode"
  ) {
    return key;
  }
  return null;
}

function mergeLaunchControls(
  agentControls: WorkspaceSessionLaunchControl[],
  modelControls: WorkspaceSessionLaunchControl[] | undefined,
): WorkspaceSessionLaunchControl[] {
  const controlsByKey = new Map<SupportedLiveControlKey, WorkspaceSessionLaunchControl>();
  const orderedKeys: SupportedLiveControlKey[] = [];

  for (const control of agentControls) {
    const key = normalizeLaunchControlKey(control.key);
    if (!key) {
      continue;
    }
    if (!controlsByKey.has(key)) {
      orderedKeys.push(key);
    }
    controlsByKey.set(key, control);
  }

  for (const control of modelControls ?? []) {
    const key = normalizeLaunchControlKey(control.key);
    if (!key) {
      continue;
    }
    if (!controlsByKey.has(key)) {
      orderedKeys.push(key);
    }
    controlsByKey.set(key, control);
  }

  return orderedKeys
    .map((key) => controlsByKey.get(key))
    .filter((control): control is WorkspaceSessionLaunchControl => control !== undefined);
}
