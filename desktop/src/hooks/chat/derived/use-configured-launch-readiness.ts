import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { AGENT_READINESS_LABELS } from "@/lib/domain/agents/readiness-presentation";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { resolveConfiguredLaunchSelection } from "@/lib/domain/chat/composer/preference-resolvers";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import type { ModelSelectorSelection } from "@/lib/domain/chat/models/model-selection";
import { useChatLaunchCatalog } from "@/hooks/chat/derived/use-chat-launch-catalog";
import { resolveCurrentModelDisplayName } from "@/lib/domain/chat/models/model-selector-current";

export function useConfiguredLaunchReadiness(
  activeSelection: ModelSelectorSelection | null = null,
) {
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    chatModelVisibilityOverridesByAgentKind: state.chatModelVisibilityOverridesByAgentKind,
  })));
  const launchCatalog = useChatLaunchCatalog({ activeSelection });
  const { agentsByKind } = useAgentCatalog();
  const hasLaunchReadinessError = Boolean(launchCatalog.error);
  const launchReadinessErrorReason = launchCatalog.targetReadinessError
    ? "Couldn't load target agent readiness. Retry once AnyHarness is reachable."
    : "Couldn't load the agent catalog. Retry once cloud is reachable.";

  const resolution = useMemo(
    () => hasLaunchReadinessError
      ? {
        selection: null,
        displayName: null,
        reason: launchReadinessErrorReason,
        status: "unavailable" as const,
      }
      : resolveConfiguredLaunchSelection(
        launchCatalog.launchAgents,
        preferences,
      ),
    [
      hasLaunchReadinessError,
      launchCatalog.launchAgents,
      launchReadinessErrorReason,
      preferences,
    ],
  );

  const configuredAgent = preferences.defaultChatAgentKind
    ? agentsByKind.get(preferences.defaultChatAgentKind) ?? null
    : null;

  const isConfiguredAgentMissing =
    !hasLaunchReadinessError
    && !launchCatalog.isLoading
    && Boolean(preferences.defaultChatAgentKind)
    && configuredAgent === null;
  const isConfiguredAgentNotReady =
    !hasLaunchReadinessError
    && !launchCatalog.isLoading
    && Boolean(preferences.defaultChatAgentKind)
    && configuredAgent !== null
    && configuredAgent.readiness !== "ready";
  const effectiveStatus = isConfiguredAgentMissing || isConfiguredAgentNotReady
    ? "unavailable"
    : resolution.status;
  const disabledReason = isConfiguredAgentNotReady
    ? `${configuredAgent.displayName} is ${AGENT_READINESS_LABELS[configuredAgent.readiness].toLowerCase()}.`
    : isConfiguredAgentMissing
      ? `${preferences.defaultChatAgentKind} isn't supported by this runtime yet.`
    : resolution.reason;
  const isBlockedByReadiness = isConfiguredAgentMissing || isConfiguredAgentNotReady;
  const fallbackSelection = isBlockedByReadiness
    ? launchCatalog.defaultLaunchSelection ?? null
    : null;
  const selection = fallbackSelection ?? (isBlockedByReadiness ? null : resolution.selection);
  const displayName = fallbackSelection
    ? resolveCurrentModelDisplayName({
      activeLaunchIdentity: null,
      defaultLaunchSelection: fallbackSelection,
      launchAgents: launchCatalog.launchAgents,
      liveConfigLabel: null,
    })
    : resolution.displayName;
  const status = fallbackSelection ? "ready" : effectiveStatus;

  return {
    configuredKind: preferences.defaultChatAgentKind || null,
    selection,
    displayName,
    disabledReason: fallbackSelection ? null : disabledReason,
    status,
    isLoading: !hasLaunchReadinessError && launchCatalog.isLoading,
    isReady: status === "ready",
    launchCatalog,
  };
}
