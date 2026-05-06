import type { ModelRegistry, ModelRegistryModel } from "@anyharness/sdk";
import {
  resolveEffectiveConfiguredSessionControlValue,
  listConfiguredSessionControlValues,
} from "@/lib/domain/chat/session-mode-control";
import { resolveModelForRegistry } from "@/lib/domain/chat/session-config";
import type { ConfiguredSessionControlValue } from "@/config/session-control-presentations";
import type {
  DefaultLiveSessionControlKey,
  DefaultLiveSessionControlValuesByAgentKind,
} from "@/lib/domain/preferences/user-preferences";

export type SessionDefaultControlMetadata =
  NonNullable<ModelRegistryModel["sessionDefaultControls"]>[number];
export type SessionDefaultControlValueMetadata =
  SessionDefaultControlMetadata["values"][number];

export interface SettingsAgentDefaultPreferences {
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
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
  models: ModelRegistryModel[];
  selectedModel: ModelRegistryModel;
  modeOptions: ConfiguredSessionControlValue[];
  selectedMode: ConfiguredSessionControlValue | null;
  liveDefaultControls: SettingsAgentLiveDefaultControlRow[];
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
  modelRegistries: ModelRegistry[];
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
  model: ModelRegistryModel,
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
