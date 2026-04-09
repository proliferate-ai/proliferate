import type {
  AgentSummary,
  ModelEntry,
  ModelRegistry,
  ModelRegistryModel,
  ProviderConfig,
  WorkspaceSessionLaunchAgent,
} from "@anyharness/sdk";
import type { OpenTarget } from "@/platform/tauri/shell";
import type { UserPreferences } from "@/stores/preferences/user-preferences-store";
import { resolveModelForRegistry } from "./session-config";

export interface ChatDefaultPreferences {
  defaultChatAgentKind: string;
  defaultChatModelId: string;
}

export interface EffectiveChatDefaults {
  agentKind: string;
  modelId: string;
  modelDisplayName: string;
  degraded: boolean;
  degradedReason: string | null;
}

interface ExplicitSelection {
  kind: string;
  modelId: string;
}

export interface ConfiguredLaunchSelection {
  kind: string;
  modelId: string;
}

export interface ConfiguredLaunchResolution {
  selection: ConfiguredLaunchSelection | null;
  displayName: string | null;
  reason: string | null;
  status: "missing" | "ready" | "unavailable";
}

function findModelById<T extends ModelEntry>(
  models: T[],
  modelId: string,
): T | null {
  return models.find((model) => model.id === modelId) ?? null;
}

export function resolveEffectiveChatDefaults(
  modelRegistries: ModelRegistry[],
  agents: AgentSummary[],
  prefs: ChatDefaultPreferences,
  explicit?: ExplicitSelection | null,
): EffectiveChatDefaults {
  const readyKinds = new Set(
    agents.filter((agent) => agent.readiness === "ready").map((agent) => agent.kind),
  );
  const readyRegistries = modelRegistries.filter((registry) => readyKinds.has(registry.kind));

  if (explicit) {
    const config = readyRegistries.find((entry) => entry.kind === explicit.kind);
    const model = config?.models.find((entry) => entry.id === explicit.modelId);
    if (config && model) {
      return buildResult(config, model, false, null);
    }
  }

  const preferredConfig = readyRegistries.find((config) => config.kind === prefs.defaultChatAgentKind);
  const preferredModel = preferredConfig?.models.find((model) => model.id === prefs.defaultChatModelId);
  const resolvedPreferredModel = preferredConfig
    ? resolveModelForRegistry(preferredConfig, prefs.defaultChatModelId)
    : null;
  if (preferredConfig && resolvedPreferredModel) {
    return buildResult(
      preferredConfig,
      resolvedPreferredModel,
      preferredModel == null,
      preferredModel == null
        ? `Stored default model is no longer available for ${preferredConfig.kind}; using ${resolvedPreferredModel.displayName}`
        : null,
    );
  }

  const storedConfig = modelRegistries.find((config) => config.kind === prefs.defaultChatAgentKind);
  const storedModel = storedConfig?.models.find((model) => model.id === prefs.defaultChatModelId);
  if (storedConfig && storedModel && !readyKinds.has(storedConfig.kind)) {
    const fallback = findFirstReadyDefault(readyRegistries);
    if (fallback) {
      return buildResult(
        fallback.config,
        fallback.model,
        true,
        `${storedConfig.kind} is not ready; using ${fallback.config.kind} as fallback`,
      );
    }
  }

  const fallback = findFirstReadyDefault(readyRegistries);
  if (fallback) {
    const degraded = Boolean(prefs.defaultChatAgentKind && prefs.defaultChatModelId);
    return buildResult(
      fallback.config,
      fallback.model,
      degraded,
      degraded ? "Stored default is no longer available" : null,
    );
  }

  return {
    agentKind: prefs.defaultChatAgentKind || "",
    modelId: prefs.defaultChatModelId || "",
    modelDisplayName: "No agents available",
    degraded: true,
    degradedReason: "No ready agents found",
  };
}

export function resolveConfiguredLaunchSelection(
  launchAgents: WorkspaceSessionLaunchAgent[],
  prefs: ChatDefaultPreferences,
  providerConfigs: ProviderConfig[],
): ConfiguredLaunchResolution {
  if (!prefs.defaultChatAgentKind || !prefs.defaultChatModelId) {
    return {
      selection: null,
      displayName: null,
      reason: "Choose a default agent and model before starting a chat.",
      status: "missing",
    };
  }

  const configuredProvider = providerConfigs.find(
    (config) => config.kind === prefs.defaultChatAgentKind,
  ) ?? null;
  const configuredProviderModel = configuredProvider
    ? findModelById(configuredProvider.models, prefs.defaultChatModelId)
    : null;
  const launchAgent = launchAgents.find(
    (agent) => agent.kind === prefs.defaultChatAgentKind,
  ) ?? null;
  const launchModel = launchAgent
    ? findModelById(launchAgent.models, prefs.defaultChatModelId)
    : null;
  const displayName = launchModel?.displayName
    ?? configuredProviderModel?.displayName
    ?? prefs.defaultChatModelId;

  if (launchAgent && launchModel) {
    return {
      selection: {
        kind: launchAgent.kind,
        modelId: launchModel.id,
      },
      displayName,
      reason: null,
      status: "ready",
    };
  }

  if (configuredProvider && !configuredProviderModel) {
    return {
      selection: null,
      displayName: null,
      reason: `The stored default model is no longer available for ${configuredProvider.displayName}.`,
      status: "unavailable",
    };
  }

  return {
    selection: null,
    displayName,
    reason: `${configuredProvider?.displayName ?? prefs.defaultChatAgentKind} is not ready yet.`,
    status: "unavailable",
  };
}

function buildResult(
  config: ModelRegistry,
  model: ModelRegistryModel,
  degraded: boolean,
  degradedReason: string | null,
): EffectiveChatDefaults {
  return {
    agentKind: config.kind,
    modelId: model.id,
    modelDisplayName: model.displayName,
    degraded,
    degradedReason,
  };
}

function findFirstReadyDefault(
  readyConfigs: ModelRegistry[],
): { config: ModelRegistry; model: ModelRegistryModel } | null {
  for (const config of readyConfigs) {
    const model = config.models.find((entry) => entry.id === config.defaultModelId)
      ?? config.models.find((entry) => entry.isDefault)
      ?? config.models[0];
    if (model) {
      return { config, model };
    }
  }
  return null;
}

export function resolvePreferredOpenTarget(
  targets: OpenTarget[],
  prefs: Pick<UserPreferences, "defaultOpenInTargetId">,
): OpenTarget | null {
  const preferred = targets.find((target) => target.id === prefs.defaultOpenInTargetId);
  if (preferred) return preferred;
  return targets.find((target) => target.kind === "editor") ?? targets[0] ?? null;
}
