import type {
  DesktopLaunchModelRegistry as SettingsAgentModelRegistry,
  DesktopLaunchModelRegistryModel as SettingsAgentModel,
  DesktopSessionDefaultControl,
} from "@/lib/domain/agents/cloud-launch-catalog";
import {
  resolveEffectiveConfiguredSessionControlValue,
  listConfiguredSessionControlValues,
} from "@/lib/domain/chat/session-controls/session-mode-control";
import { resolveModelForRegistry } from "@/lib/domain/chat/launch/session-config";
import type { ConfiguredSessionControlValue } from "@/lib/domain/chat/session-controls/presentation";
import type {
  DefaultLiveSessionControlKey,
  DefaultLiveSessionControlValuesByAgentKind,
} from "@/lib/domain/preferences/user/session-defaults";
import {
  isChatModelIdVisible,
  isDefaultVisibleChatModel,
  type ChatModelVisibilityOverridesByAgentKind,
} from "@/lib/domain/chat/models/model-visibility";

export type SessionDefaultControlMetadata =
  DesktopSessionDefaultControl;
export type SessionDefaultControlValueMetadata =
  SessionDefaultControlMetadata["values"][number];

export interface SettingsAgentDefaultPreferences {
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
  chatModelVisibilityOverridesByAgentKind: ChatModelVisibilityOverridesByAgentKind;
  defaultSessionModeByAgentKind: Record<string, string>;
  defaultLiveSessionControlValuesByAgentKind: DefaultLiveSessionControlValuesByAgentKind;
}

export interface SettingsAgentLiveDefaultControlRow {
  key: DefaultLiveSessionControlKey;
  label: string;
  values: SessionDefaultControlValueMetadata[];
  selectedValue: SessionDefaultControlValueMetadata;
  storedValue: string | null;
  staleStoredValue: string | null;
}

export interface SettingsAgentDefaultRow {
  kind: string;
  displayName: string;
  isPrimary: boolean;
  models: SettingsAgentModel[];
  selectedModel: SettingsAgentModel;
  modeOptions: ConfiguredSessionControlValue[];
  selectedMode: ConfiguredSessionControlValue | null;
  liveDefaultControls: SettingsAgentLiveDefaultControlRow[];
  modelVisibilityOptions: SettingsAgentModelVisibilityOption[];
  hasModelVisibilityOverrides: boolean;
}

export interface SettingsAgentModelVisibilityOption {
  id: string;
  displayName: string;
  description: string | null;
  isVisible: boolean;
  isDefaultVisible: boolean;
}

const SUPPORTED_LIVE_DEFAULT_KEYS = new Set<DefaultLiveSessionControlKey>([
  "collaboration_mode",
  "reasoning",
  "effort",
  "fast_mode",
]);

export function buildSettingsAgentDefaultRows({
  modelRegistries,
  readyAgentKinds,
  preferences,
}: {
  modelRegistries: SettingsAgentModelRegistry[];
  readyAgentKinds: ReadonlySet<string>;
  preferences: SettingsAgentDefaultPreferences;
}): SettingsAgentDefaultRow[] {
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
      liveDefaultControls: buildLiveDefaultControlsForModel(
        selectedModel,
        preferences.defaultLiveSessionControlValuesByAgentKind[registry.kind] ?? {},
      ),
      modelVisibilityOptions: buildModelVisibilityOptions(
        registry,
        preferences.chatModelVisibilityOverridesByAgentKind,
      ),
      hasModelVisibilityOverrides:
        Boolean(preferences.chatModelVisibilityOverridesByAgentKind[registry.kind]),
    }];
  });
}

export function withUpdatedDefaultLiveSessionControlValueByAgentKind(
  current: DefaultLiveSessionControlValuesByAgentKind,
  agentKind: string,
  key: DefaultLiveSessionControlKey,
  value: string,
): DefaultLiveSessionControlValuesByAgentKind {
  return {
    ...current,
    [agentKind]: {
      ...(current[agentKind] ?? {}),
      [key]: value,
    },
  };
}

function buildLiveDefaultControlsForModel(
  model: SettingsAgentModel,
  storedValues: Partial<Record<DefaultLiveSessionControlKey, string>>,
): SettingsAgentLiveDefaultControlRow[] {
  return (model.sessionDefaultControls ?? []).flatMap((control) => {
    const key = control.key as DefaultLiveSessionControlKey;
    if (!SUPPORTED_LIVE_DEFAULT_KEYS.has(key) || control.values.length === 0) {
      return [];
    }

    const storedValue = storedValues[key] ?? null;
    const storedOption = storedValue
      ? control.values.find((value) => value.value === storedValue) ?? null
      : null;
    const selectedValue = storedOption ?? resolveFallbackControlValue(control);
    if (!selectedValue) {
      return [];
    }

    return [{
      key,
      label: control.label,
      values: control.values,
      selectedValue,
      storedValue,
      staleStoredValue: storedValue && !storedOption ? storedValue : null,
    }];
  });
}

function buildModelVisibilityOptions(
  registry: SettingsAgentModelRegistry,
  overrides: ChatModelVisibilityOverridesByAgentKind,
): SettingsAgentModelVisibilityOption[] {
  if (!registry.modelDisplayPolicy?.allowUserVisibleModelSelection) {
    return [];
  }

  return registry.models.map((model) => {
    const isDefaultVisible = isDefaultVisibleChatModel(registry, model);
    return {
      id: model.id,
      displayName: model.displayName,
      description: model.description ?? null,
      isDefaultVisible,
      isVisible: isChatModelIdVisible({
        agent: registry,
        agentKind: registry.kind,
        modelId: model.id,
        catalogModel: model,
        overrides,
      }),
    };
  });
}

function resolveFallbackControlValue(
  control: SessionDefaultControlMetadata,
): SessionDefaultControlValueMetadata | null {
  const defaultValue = control.defaultValue ?? null;
  if (defaultValue) {
    const defaultOption = control.values.find((value) => value.value === defaultValue);
    if (defaultOption) {
      return defaultOption;
    }
  }

  return control.values.find((value) => value.isDefault)
    ?? control.values[0]
    ?? null;
}
