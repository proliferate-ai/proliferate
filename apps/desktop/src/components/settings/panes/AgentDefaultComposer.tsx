import { useEffect, useMemo } from "react";
import { AgentHarnessConfigComposer } from "@/components/settings/shared/AgentHarnessConfigComposer";
import {
  type DesktopAgentLaunchAgent,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { withUpdatedDefaultModelIdByAgentKind } from "@/lib/domain/agents/model-options";
import {
  buildLaunchControlDescriptors,
} from "@/lib/domain/chat/models/launch-control-descriptors";
import { withUpdatedDefaultSessionModeByAgentKind } from "@/lib/domain/chat/session-controls/session-mode-control";
import type {
  SupportedLiveControlKey,
} from "@/lib/domain/chat/session-controls/session-controls";
import type {
  DefaultLiveSessionControlKey,
} from "@/lib/domain/preferences/user/session-defaults";
import type { SettingsAgentDefaultRow } from "@/lib/domain/settings/agent-defaults";
import {
  withUpdatedDefaultLiveSessionControlValueByAgentKind,
} from "@/lib/domain/settings/agent-defaults";
import type { useModelRegistrySettings } from "@/hooks/settings/workflows/use-model-registry-settings";

export function AgentDefaultComposer({
  row,
  launchAgent,
  preferences,
}: {
  row: SettingsAgentDefaultRow;
  launchAgent: DesktopAgentLaunchAgent | null;
  preferences: ReturnType<typeof useModelRegistrySettings>["preferences"];
}) {
  const controls = useMemo(
    () => launchAgent
      ? buildLaunchControlDescriptors({
        selection: { kind: row.kind, modelId: row.selectedModel.id },
        launchAgents: [launchAgent],
        pendingConfigChanges: null,
        preferences,
        onSelect: (
          _agentKind: string,
          controlKey: SupportedLiveControlKey,
          _rawConfigId: string,
          value: string,
        ) => {
          if (controlKey === "mode") {
            preferences.set(
              "defaultSessionModeByAgentKind",
              withUpdatedDefaultSessionModeByAgentKind(
                preferences.defaultSessionModeByAgentKind,
                row.kind,
                value,
              ),
            );
            return;
          }
          if (isDefaultLiveSessionControlKey(controlKey)) {
            preferences.set(
              "defaultLiveSessionControlValuesByAgentKind",
              withUpdatedDefaultLiveSessionControlValueByAgentKind(
                preferences.defaultLiveSessionControlValuesByAgentKind,
                row.kind,
                controlKey,
                value,
              ),
            );
          }
        },
      })
      : [],
    [launchAgent, preferences, row.kind, row.selectedModel.id],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    console.debug("[agent-harness-config][agent-default]", {
      agentKind: row.kind,
      modelId: row.selectedModel.id,
      catalogControls: launchAgent?.launchControls.map((control) => ({
        key: control.key,
        createField: control.createField,
        phase: control.phase,
        surfaces: control.surfaces,
      })) ?? [],
      renderedControls: controls.map((control) => ({
        key: control.key,
        rawConfigId: control.rawConfigId,
        detail: control.detail,
        optionCount: control.options.length,
      })),
    });
  }, [controls, launchAgent, row.kind, row.selectedModel.id]);

  return (
    <AgentHarnessConfigComposer
      agentKind={row.kind}
      agentDisplayName={row.displayName}
      selectedModelId={row.selectedModel.id}
      selectedModelLabel={row.selectedModel.displayName}
      modelGroups={[{
        agentKind: row.kind,
        agentDisplayName: row.displayName,
        models: row.models.map((model) => ({
          id: model.id,
          label: model.displayName,
          detail: model.description ?? model.id,
        })),
      }]}
      controls={controls}
      placeholder="Describe a task"
      onSelectModel={(_agentKind, modelId) => {
        preferences.set(
          "defaultChatModelIdByAgentKind",
          withUpdatedDefaultModelIdByAgentKind(
            preferences.defaultChatModelIdByAgentKind,
            row.kind,
            modelId,
          ),
        );
      }}
    />
  );
}

function isDefaultLiveSessionControlKey(
  key: SupportedLiveControlKey,
): key is DefaultLiveSessionControlKey {
  return key === "collaboration_mode"
    || key === "reasoning"
    || key === "effort"
    || key === "fast_mode";
}
