import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { AGENT_READINESS_LABELS } from "@/lib/domain/agents/readiness-presentation";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { resolveConfiguredLaunchSelection } from "@/lib/domain/chat/composer/preference-resolvers";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import type { ModelSelectorSelection } from "@/lib/domain/chat/models/model-selection";
import { useChatLaunchCatalog } from "@/hooks/chat/derived/use-chat-launch-catalog";
import { resolveModelDisplayName } from "@/lib/domain/chat/models/model-display";

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

  const preferredResolution = useMemo(
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
  const effectiveSelection = preferredResolution.selection ?? launchCatalog.defaultLaunchSelection;
  const effectiveDisplayName = useMemo(() => {
    if (!effectiveSelection) {
      return preferredResolution.displayName;
    }
    const agent = launchCatalog.launchAgents.find((candidate) =>
      candidate.kind === effectiveSelection.kind
    );
    const model = agent?.models.find((candidate) =>
      candidate.id === effectiveSelection.modelId
      || candidate.aliases.includes(effectiveSelection.modelId)
    );
    return resolveModelDisplayName({
      agentKind: effectiveSelection.kind,
      modelId: effectiveSelection.modelId,
      sourceLabels: [
        model?.displayName,
        preferredResolution.selection?.kind === effectiveSelection.kind
          ? preferredResolution.displayName
          : null,
      ],
      preferKnownAlias: true,
    }) ?? preferredResolution.displayName;
  }, [
    effectiveSelection,
    launchCatalog.launchAgents,
    preferredResolution.displayName,
    preferredResolution.selection?.kind,
  ]);

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
  const hasReadyFallback = Boolean(effectiveSelection)
    && (
      effectiveSelection?.kind !== preferences.defaultChatAgentKind
      || (!isConfiguredAgentMissing && !isConfiguredAgentNotReady)
    );
  const effectiveStatus = hasReadyFallback
    ? "ready"
    : isConfiguredAgentMissing || isConfiguredAgentNotReady
      ? "unavailable"
      : preferredResolution.status;
  const disabledReason = isConfiguredAgentNotReady
    ? `${configuredAgent.displayName} is ${AGENT_READINESS_LABELS[configuredAgent.readiness].toLowerCase()}.`
    : isConfiguredAgentMissing
      ? `${preferences.defaultChatAgentKind} isn't supported by this runtime yet.`
    : preferredResolution.reason;
  const isBlockedByReadiness =
    !hasReadyFallback
    && (isConfiguredAgentMissing || isConfiguredAgentNotReady);

  return {
    configuredKind: (effectiveSelection?.kind ?? preferences.defaultChatAgentKind) || null,
    selection: isBlockedByReadiness ? null : effectiveSelection,
    displayName: effectiveDisplayName,
    disabledReason,
    status: effectiveStatus,
    isLoading: !hasLaunchReadinessError && launchCatalog.isLoading,
    isReady: effectiveStatus === "ready",
    launchCatalog,
  };
}
