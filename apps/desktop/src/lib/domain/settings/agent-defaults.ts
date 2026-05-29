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
import { resolveModelDisplayName } from "@/lib/domain/chat/models/model-display";
import {
  filterVisibleRegistryModels,
  resolveVisibleRegistryModelIds,
  resolveRegistryModelCatalogDefaultOptIn,
} from "@/lib/domain/chat/models/model-visibility";
import type { ConfiguredSessionControlValue } from "@/lib/domain/chat/session-controls/presentation";
import type {
  ChatModelVisibilityOverridesByAgentKind,
  DefaultLiveSessionControlKey,
  DefaultLiveSessionControlValuesByAgentKind,
} from "@/lib/domain/preferences/user/session-defaults";

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
  visibilityModels: SettingsAgentModelVisibilityRow[];
  selectedModel: SettingsAgentModel;
  modeOptions: ConfiguredSessionControlValue[];
  selectedMode: ConfiguredSessionControlValue | null;
  liveDefaultControls: SettingsAgentLiveDefaultControlRow[];
}

export interface SettingsAgentModelVisibilityRow {
  id: string;
  displayName: string;
  isVisible: boolean;
  catalogDefaultOptIn: boolean;
  hasManualOverride: boolean;
  canHide: boolean;
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

    const visibleModels = filterVisibleRegistryModels({
      registry,
      selectedModelId: null,
      overrides: preferences.chatModelVisibilityOverridesByAgentKind,
    }).map((model) => presentSettingsModel(registry.kind, model));
    const selectedModel = resolveModelForRegistry(
      { ...registry, models: visibleModels },
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
      models: visibleModels,
      visibilityModels: buildVisibilityRows(
        registry,
        preferences.chatModelVisibilityOverridesByAgentKind,
      ),
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

function buildVisibilityRows(
  registry: SettingsAgentModelRegistry,
  overrides: ChatModelVisibilityOverridesByAgentKind,
): SettingsAgentModelVisibilityRow[] {
  const visibleModelIds = resolveVisibleRegistryModelIds({
    registry,
    selectedModelId: null,
    overrides,
  });
  return registry.models.map((model) => {
    const catalogDefaultOptIn = resolveRegistryModelCatalogDefaultOptIn(model);
    const isVisible = visibleModelIds.has(model.id);
    return {
      id: model.id,
      displayName: presentSettingsModel(registry.kind, model).displayName,
      catalogDefaultOptIn,
      isVisible,
      hasManualOverride: overrides[registry.kind]?.[model.id] !== undefined,
      canHide: !isVisible || visibleModelIds.size > 1,
    };
  });
}

function presentSettingsModel<T extends SettingsAgentModel>(
  agentKind: string,
  model: T,
): T {
  return {
    ...model,
    displayName: resolveModelDisplayName({
      agentKind,
      modelId: model.id,
      sourceLabels: [model.displayName],
      preferKnownAlias: true,
    }) ?? model.displayName,
  };
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
