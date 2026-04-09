import { useMemo } from "react";
import { useProviderConfigsQuery } from "@anyharness/sdk-react";
import type { ProviderConfig } from "@anyharness/sdk";
import { useShallow } from "zustand/react/shallow";
import { AGENT_READINESS_LABELS } from "@/config/agents";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { resolveConfiguredLaunchSelection } from "@/lib/domain/chat/preference-resolvers";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import type { ModelSelectorSelection } from "@/lib/domain/chat/model-selection";
import { useChatLaunchCatalog } from "./use-chat-launch-catalog";

const EMPTY_PROVIDER_CONFIGS: ProviderConfig[] = [];

export function useConfiguredLaunchReadiness(
  activeSelection: ModelSelectorSelection | null = null,
) {
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelId: state.defaultChatModelId,
  })));
  const launchCatalog = useChatLaunchCatalog({ activeSelection });
  const { data: providerConfigs = EMPTY_PROVIDER_CONFIGS, isLoading: providerConfigsLoading } = useProviderConfigsQuery();
  const { agentsByKind } = useAgentCatalog();

  const resolution = useMemo(
    () => resolveConfiguredLaunchSelection(
      launchCatalog.launchAgents,
      preferences,
      providerConfigs,
    ),
    [launchCatalog.launchAgents, preferences, providerConfigs],
  );

  const configuredAgent = preferences.defaultChatAgentKind
    ? agentsByKind.get(preferences.defaultChatAgentKind) ?? null
    : null;

  const disabledReason = resolution.status === "unavailable" && configuredAgent && configuredAgent.readiness !== "ready"
    ? `${configuredAgent.displayName} is ${AGENT_READINESS_LABELS[configuredAgent.readiness].toLowerCase()}.`
    : resolution.reason;

  return {
    configuredKind: preferences.defaultChatAgentKind || null,
    selection: resolution.selection,
    displayName: resolution.displayName,
    disabledReason,
    status: resolution.status,
    isLoading: launchCatalog.isLoading || providerConfigsLoading,
    isReady: resolution.status === "ready",
    launchCatalog,
  };
}
