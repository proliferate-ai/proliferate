import {
  useModelRegistriesQuery,
} from "@anyharness/sdk-react";
import { useCallback, useMemo, useState } from "react";
import type { ModelRegistry, ModelRegistryModel } from "@anyharness/sdk";
import { useShallow } from "zustand/react/shallow";
import { AGENT_READINESS_LABELS } from "@/config/agents";
import { compareChatLaunchKinds } from "@/config/chat-launch";
import { SETUP_COPY } from "@/config/setup";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import type { ConfiguredSessionControlValue } from "@/config/session-control-presentations";
import {
  listConfiguredSessionControlValues,
  resolveEffectiveConfiguredSessionControlValue,
  withUpdatedDefaultSessionModeByAgentKind,
} from "@/lib/domain/chat/session-mode-control";
import { resolveModelForRegistry } from "@/lib/domain/chat/session-config";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export interface SetupAgentOption {
  kind: string;
  displayName: string;
  models: ModelRegistryModel[];
  readinessLabel: string;
}

export interface SetupSelection {
  kind: string;
  modelId: string;
  modeId: string | null;
}

export interface SetupChatDefaultsState {
  state:
    | {
      status: "loading";
      message: string;
      detail: string;
    }
    | {
      status: "error";
      message: string;
      detail: string;
    }
    | {
      status: "ready";
      message: null;
      detail: string;
    };
  options: SetupAgentOption[];
  selected: SetupSelection | null;
  selectedModels: ModelRegistryModel[];
  selectedModeId: string | null;
  modeOptions: ConfiguredSessionControlValue[];
  onSelectAgent: (kind: string) => void;
  onSelectModel: (kind: string, modelId: string) => void;
  onSelectMode: (kind: string, modeId: string) => void;
  onContinue: () => void;
}

const EMPTY_MODEL_ENTRIES: ModelRegistryModel[] = [];
const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];
const EMPTY_MODE_OPTIONS: ConfiguredSessionControlValue[] = [];

function defaultModelForRegistry(registry: ModelRegistry) {
  return resolveModelForRegistry(registry, null);
}

function resolveRecommendedSelection(
  registries: ModelRegistry[],
  stored: SetupSelection,
): SetupSelection | null {
  const storedRegistry = registries.find((registry) => registry.kind === stored.kind);
  const storedModel = storedRegistry
    ? resolveModelForRegistry(storedRegistry, stored.modelId)
    : null;
  if (storedRegistry && storedModel) {
    const modeSelection = resolveEffectiveConfiguredSessionControlValue(
      storedRegistry.kind,
      "mode",
      stored.modeId,
    );
    return {
      kind: storedRegistry.kind,
      modelId: storedModel.id,
      modeId: modeSelection?.value ?? null,
    };
  }

  const firstRegistry = registries.find((registry) => registry.models.length > 0) ?? null;
  const firstModel = firstRegistry ? defaultModelForRegistry(firstRegistry) : null;
  if (!firstRegistry || !firstModel) {
    return null;
  }

  return {
    kind: firstRegistry.kind,
    modelId: firstModel.id,
    modeId: resolveEffectiveConfiguredSessionControlValue(
      firstRegistry.kind,
      "mode",
      stored.modeId,
    )?.value ?? null,
  };
}

function buildAgentOptions(
  registries: ModelRegistry[],
  readinessByKind: Map<string, string>,
): SetupAgentOption[] {
  return registries.map((registry) => ({
    kind: registry.kind,
    displayName: registry.displayName,
    models: registry.models,
    readinessLabel: readinessByKind.get(registry.kind) ?? "Starting runtime",
  }));
}

export function useSetupChatDefaultsStep(): SetupChatDefaultsState {
  const { agentsByKind } = useAgentCatalog();
  const {
    data: modelRegistries = EMPTY_MODEL_REGISTRIES,
    error: modelRegistriesError,
    isLoading: modelRegistriesLoading,
  } = useModelRegistriesQuery();
  const { connectionState, error: runtimeError } = useHarnessStore(useShallow((state) => ({
    connectionState: state.connectionState,
    error: state.error,
  })));
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelId: state.defaultChatModelId,
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
    setMultiple: state.setMultiple,
  })));
  const [draft, setDraft] = useState<SetupSelection | null>(null);

  const orderedModelRegistries = useMemo(
    () => [...modelRegistries].sort((left, right) => compareChatLaunchKinds(
      left.kind,
      right.kind,
      left.displayName,
      right.displayName,
    )),
    [modelRegistries],
  );

  const readinessByKind = useMemo(
    () => new Map(
      orderedModelRegistries.map((registry) => [
        registry.kind,
        AGENT_READINESS_LABELS[agentsByKind.get(registry.kind)?.readiness ?? "install_required"],
      ]),
    ),
    [agentsByKind, orderedModelRegistries],
  );

  const recommendedSelection = useMemo(
    () => resolveRecommendedSelection(orderedModelRegistries, {
      kind: preferences.defaultChatAgentKind,
      modelId: preferences.defaultChatModelId,
      modeId: preferences.defaultSessionModeByAgentKind[preferences.defaultChatAgentKind] ?? null,
    }),
    [
      orderedModelRegistries,
      preferences.defaultChatAgentKind,
      preferences.defaultChatModelId,
      preferences.defaultSessionModeByAgentKind,
    ],
  );

  const selected = draft ?? recommendedSelection;

  const options = useMemo(
    () => buildAgentOptions(orderedModelRegistries, readinessByKind),
    [orderedModelRegistries, readinessByKind],
  );

  const selectedModels = useMemo(
    () => options.find((option) => option.kind === selected?.kind)?.models ?? EMPTY_MODEL_ENTRIES,
    [options, selected?.kind],
  );
  const modeOptions = useMemo(
    () => selected ? listConfiguredSessionControlValues(selected.kind, "mode") : EMPTY_MODE_OPTIONS,
    [selected],
  );
  const selectedModeId = selected?.modeId ?? null;

  const onSelectAgent = useCallback((kind: string) => {
    const registry = orderedModelRegistries.find((candidate) => candidate.kind === kind);
    const defaultModel = registry ? defaultModelForRegistry(registry) : null;
    if (!registry || !defaultModel) {
      return;
    }

    setDraft((current) => {
      const existingModel = current?.kind === kind
        ? resolveModelForRegistry(registry, current.modelId)
        : null;

      return {
        kind,
        modelId: existingModel?.id ?? defaultModel.id,
        modeId: resolveEffectiveConfiguredSessionControlValue(
          kind,
          "mode",
          current?.kind === kind ? current.modeId : preferences.defaultSessionModeByAgentKind[kind] ?? null,
        )?.value ?? null,
      };
    });
  }, [orderedModelRegistries, preferences.defaultSessionModeByAgentKind]);

  const onSelectModel = useCallback((kind: string, modelId: string) => {
    setDraft((current) => ({
      kind,
      modelId,
      modeId: resolveEffectiveConfiguredSessionControlValue(
        kind,
        "mode",
        current?.kind === kind ? current.modeId : preferences.defaultSessionModeByAgentKind[kind] ?? null,
      )?.value ?? null,
    }));
  }, [preferences.defaultSessionModeByAgentKind]);

  const onSelectMode = useCallback((kind: string, modeId: string) => {
    setDraft((current) => {
      if (!current || current.kind !== kind) {
        return current;
      }

      return {
        ...current,
        modeId,
      };
    });
  }, []);

  const onContinue = useCallback(() => {
    if (!selected) {
      return;
    }

    const nextDefaultModes = withUpdatedDefaultSessionModeByAgentKind(
      preferences.defaultSessionModeByAgentKind,
      selected.kind,
      selected.modeId,
    );
    preferences.setMultiple({
      defaultChatAgentKind: selected.kind,
      defaultChatModelId: selected.modelId,
      defaultSessionModeByAgentKind: nextDefaultModes,
    });
  }, [preferences, selected]);

  const state = connectionState !== "healthy"
    ? {
      status: "loading" as const,
      message: SETUP_COPY.pendingDefaultsMessage,
      detail: runtimeError ?? SETUP_COPY.pendingDefaultsSubtext,
    }
    : modelRegistriesLoading && orderedModelRegistries.length === 0
      ? {
        status: "loading" as const,
        message: "Loading available agents",
        detail: SETUP_COPY.pendingDefaultsSubtext,
      }
      : modelRegistriesError
        ? {
          status: "error" as const,
          message: modelRegistriesError instanceof Error
            ? modelRegistriesError.message
            : "Could not load the available agents.",
          detail: SETUP_COPY.pendingDefaultsSubtext,
        }
        : orderedModelRegistries.length === 0
          ? {
            status: "error" as const,
            message: "No model registries are available yet.",
            detail: SETUP_COPY.pendingDefaultsSubtext,
          }
        : {
            status: "ready" as const,
            message: null,
            detail: SETUP_COPY.chosenDefaultPending,
          };

  return useMemo(() => ({
    onContinue,
    onSelectAgent,
    onSelectModel,
    onSelectMode,
    modeOptions,
    options,
    selected,
    selectedModeId,
    selectedModels,
    state,
  }), [
    onContinue,
    onSelectAgent,
    onSelectModel,
    onSelectMode,
    modeOptions,
    options,
    selected,
    selectedModeId,
    selectedModels,
    state,
  ]);
}
