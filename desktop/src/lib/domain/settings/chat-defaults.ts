import type { ModelRegistry, ModelRegistryModel } from "@anyharness/sdk";
import { withUpdatedDefaultModelIdByAgentKind } from "@/lib/domain/agents/model-options";
import { resolveModelForRegistry } from "@/lib/domain/chat/session-config";
import {
  listConfiguredSessionControlValues,
  resolveEffectiveConfiguredSessionControlValue,
  withUpdatedDefaultSessionModeByAgentKind,
} from "@/lib/domain/chat/session-mode-control";
import type {
  ConfiguredSessionControlValue,
} from "@/lib/domain/chat/session-controls/presentation";

export interface SettingsChatDefaultPreferences {
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
  defaultSessionModeByAgentKind: Record<string, string>;
}

export interface SettingsChatDefaultRow {
  kind: string;
  displayName: string;
  isPrimary: boolean;
  models: ModelRegistryModel[];
  selectedModel: ModelRegistryModel;
  modeOptions: ConfiguredSessionControlValue[];
  selectedMode: ConfiguredSessionControlValue | null;
}

export function buildSettingsChatDefaultRows({
  modelRegistries,
  readyAgentKinds,
  preferences,
}: {
  modelRegistries: ModelRegistry[];
  readyAgentKinds: ReadonlySet<string>;
  preferences: SettingsChatDefaultPreferences;
}): SettingsChatDefaultRow[] {
  return modelRegistries.flatMap((registry) => {
    if (!readyAgentKinds.has(registry.kind) || registry.models.length === 0) {
      return [];
    }

    const selectedModel = resolveModelForRegistry(
      registry,
      preferences.defaultChatModelIdByAgentKind[registry.kind] ?? null,
    );
    if (!selectedModel) {
      return [];
    }

    const modeOptions = listConfiguredSessionControlValues(registry.kind, "mode");
    const selectedMode = modeOptions.length > 0
      ? resolveEffectiveConfiguredSessionControlValue(
        registry.kind,
        "mode",
        preferences.defaultSessionModeByAgentKind[registry.kind] ?? null,
      )
      : null;

    return [{
      kind: registry.kind,
      displayName: registry.displayName,
      isPrimary: preferences.defaultChatAgentKind === registry.kind,
      models: registry.models,
      selectedModel,
      modeOptions,
      selectedMode,
    }];
  });
}

export function buildPrimaryHarnessPreferenceUpdate(
  preferences: SettingsChatDefaultPreferences,
  registry: ModelRegistry,
): SettingsChatDefaultPreferences {
  const selectedModel = resolveModelForRegistry(
    registry,
    preferences.defaultChatModelIdByAgentKind[registry.kind] ?? null,
  );
  const selectedMode = resolveEffectiveConfiguredSessionControlValue(
    registry.kind,
    "mode",
    preferences.defaultSessionModeByAgentKind[registry.kind] ?? null,
  );

  return {
    defaultChatAgentKind: registry.kind,
    defaultChatModelIdByAgentKind: selectedModel
      ? withUpdatedDefaultModelIdByAgentKind(
        preferences.defaultChatModelIdByAgentKind,
        registry.kind,
        selectedModel.id,
      )
      : preferences.defaultChatModelIdByAgentKind,
    defaultSessionModeByAgentKind: selectedMode
      ? withUpdatedDefaultSessionModeByAgentKind(
        preferences.defaultSessionModeByAgentKind,
        registry.kind,
        selectedMode.value,
      )
      : preferences.defaultSessionModeByAgentKind,
  };
}
