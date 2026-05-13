import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { AGENT_READINESS_LABELS } from "@/lib/domain/agents/readiness-presentation";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { resolveConfiguredLaunchSelection } from "@/lib/domain/chat/composer/preference-resolvers";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import type { ModelSelectorSelection } from "@/lib/domain/chat/models/model-selection";
import { useChatLaunchCatalog } from "@/hooks/chat/derived/use-chat-launch-catalog";

export function useConfiguredLaunchReadiness(
  activeSelection: ModelSelectorSelection | null = null,
) {
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
  })));
  const launchCatalog = useChatLaunchCatalog({ activeSelection });
  const { agentsByKind } = useAgentCatalog();
  const hasCatalogLoadError = Boolean(launchCatalog.error && !launchCatalog.data);

  const resolution = useMemo(
    () => hasCatalogLoadError
      ? {
        selection: null,
        displayName: null,
        reason: "Couldn't load the agent catalog. Retry once cloud is reachable.",
        status: "unavailable" as const,
      }
      : resolveConfiguredLaunchSelection(
        launchCatalog.launchAgents,
        preferences,
      ),
    [hasCatalogLoadError, launchCatalog.launchAgents, preferences],
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
    isLoading: !hasCatalogLoadError && launchCatalog.isLoading,
    isReady: resolution.status === "ready",
    launchCatalog,
  };
}
