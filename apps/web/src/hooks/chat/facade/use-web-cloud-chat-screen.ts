import { useRef, useState } from "react";
import type { CloudChatSurfaceProps } from "@proliferate/product-ui/chat/CloudChatSurface";
import {
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import { shouldSuppressWorkspaceSessionRedirect } from "../../../lib/domain/chat/cloud-chat-session-model";
import { loadPendingHomePrompt, type PendingHomePrompt } from "../../../lib/access/cloud/pending-home-prompt-store";
import {
  loadWebCloudPromptIntents,
  type WebCloudPromptIntent,
} from "../../../stores/cloud/web-cloud-prompt-intent-store";
import {
  loadWebCloudPendingConfigChanges,
} from "../../../stores/cloud/web-cloud-pending-config-change-store";
import {
  loadWebCloudSessionDraftFromSearch,
  type WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-session-draft-store";
import { useWebCloudHarnessAvailability } from "../derived/use-web-cloud-harness-availability";
import { useWebCloudLaunchSelection } from "../derived/use-web-cloud-launch-selection";
import { useWebCloudTranscriptProjection } from "../derived/use-web-cloud-transcript-projection";
import { buildWebCloudChatSurfaceProps } from "./build-web-cloud-chat-surface-props";
import { useWebCloudChatData } from "./use-web-cloud-chat-data";
import {
  useWebCloudChatLocalStateLifecycle,
  type PendingHomePromptDispatchRun,
} from "../lifecycle/use-web-cloud-chat-local-state-lifecycle";
import { useWebCloudPendingHomePromptLifecycle } from "../lifecycle/use-web-cloud-pending-home-prompt-lifecycle";
import { useWebCloudTranscriptLifecycle } from "../lifecycle/use-web-cloud-transcript-lifecycle";
import { useWebCloudComposerControls } from "../ui/use-web-cloud-composer-controls";
import { useWebCloudChatActions } from "../workflows/use-web-cloud-chat-actions";
import { useAuthToken } from "../../../providers/WebCloudProvider";

export type WebCloudChatScreenState =
  | { kind: "missing"; title: string }
  | { kind: "workspace-loading" }
  | { kind: "ready"; surface: CloudChatSurfaceProps };

export function useWebCloudChatScreen(): WebCloudChatScreenState {
  const {
    workspaceId,
    chatId,
    navigate,
    location,
    client,
    workspaceQuery,
    agentCatalog,
    cloudCapabilities,
    agentAuthCredentials,
    snapshot,
    workspace,
    workspaceStatus,
    sessions,
    routeSessionDraftId,
    session,
    activeTranscriptSessionId,
    sessionLive,
    transcriptQuery,
    sessionEventsQuery,
    transcriptItems,
    pendingInteractions,
    sessionEvents,
  } = useWebCloudChatData();
  const { token: productToken } = useAuthToken();
  const [draft, setDraft] = useState("");
  const [launchSelection, setLaunchSelection] = useState<CloudLaunchComposerSelection>({
    agentKind: DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: DEFAULT_DIRECT_PROMPT_MODEL_ID,
    modeId: null,
    controlValues: {},
  });
  const [directPromptDispatching, setDirectPromptDispatching] = useState(false);
  const [optimisticPrompts, setOptimisticPrompts] = useState<WebCloudPromptIntent[]>(() =>
    workspaceId ? loadWebCloudPromptIntents(workspaceId) : []
  );
  const [pendingConfigChanges, setPendingConfigChanges] = useState<
    Record<string, PendingConfigChange>
  >(() => workspaceId ? loadWebCloudPendingConfigChanges(workspaceId) : {});
  const [pendingSessionDraft, setPendingSessionDraft] = useState<WebCloudSessionDraft | null>(() =>
    workspaceId ? loadWebCloudSessionDraftFromSearch(workspaceId, location.search) : null
  );
  const [pendingHomePrompt, setPendingHomePrompt] = useState<PendingHomePrompt | null>(() =>
    workspaceId ? loadPendingHomePrompt(workspaceId) : null
  );
  const [pendingHomePromptStatus, setPendingHomePromptStatus] = useState<string | null>(null);
  const pendingHomePromptDispatchRunRef = useRef<PendingHomePromptDispatchRun | null>(null);
  const pendingHomePromptResumeAttemptsRef = useRef<Set<string>>(new Set());
  const pendingConfigMutationIdRef = useRef(0);
  const mountedRef = useRef(true);
  const suppressSessionRedirect = Boolean(routeSessionDraftId && pendingSessionDraft)
    || shouldSuppressWorkspaceSessionRedirect(location.state);
  const {
    visiblePendingHomePromptStatus,
    pendingPromptCommandId,
    transcriptView,
    sharedTranscriptState,
    visibleTranscriptRows,
  } = useWebCloudTranscriptProjection({
    workspace,
    session,
    activeTranscriptSessionId,
    sessionEvents,
    transcriptItems,
    pendingInteractions,
    optimisticPrompts,
    pendingHomePrompt,
    pendingSessionDraft,
    pendingHomePromptStatus,
    pendingConfigChanges,
  });
  const isUnclaimed = false;
  const {
    workspaceAllowedAgentKindsKey,
    workspaceReadyAgentKindsKey,
    workspaceHarnessAvailability,
    workspaceLaunchableAgentKinds,
    canStartNewSession,
  } = useWebCloudHarnessAvailability({
    workspace,
    agentCatalog: agentCatalog.data,
    agentGateway: cloudCapabilities.data?.agentGateway,
    agentAuthCredentials: agentAuthCredentials.data,
  });
  const {
    liveConfig,
    resolvedLaunchSelection,
  } = useWebCloudLaunchSelection({
    session,
    agentCatalog: agentCatalog.data,
    workspaceLaunchableAgentKinds,
    launchSelection,
  });
  const {
    submitPrompt,
    submitSessionConfig,
    transcriptPlanActions,
    claimCurrentWorkspace,
    copyComposerFooterValue,
    openNewSessionDraft,
  } = useWebCloudChatActions({
    client,
    productToken,
    workspace,
    session,
    draft,
    setDraft,
    isUnclaimed,
    canStartNewSession,
    workspaceStatus,
    workspaceHarnessAvailability,
    directPromptDispatching,
    setDirectPromptDispatching,
    setPendingHomePromptStatus,
    setOptimisticPrompts,
    setPendingHomePrompt,
    setPendingSessionDraft,
    pendingSessionDraft,
    routeSessionDraftId,
    setPendingConfigChanges,
    pendingConfigMutationIdRef,
    setLaunchSelection,
    agentCatalog: agentCatalog.data,
    workspaceLaunchableAgentKinds,
    resolvedLaunchSelection,
    mountedRef,
    workspaceRefetch: workspaceQuery.refetch,
    transcriptRefetch: transcriptQuery.refetch,
    sessionEventsRefetch: sessionEventsQuery.refetch,
    transcriptItems,
    transcriptRows: transcriptView.rows,
    navigate,
  });
  const composerControls = useWebCloudComposerControls({
    session,
    liveConfig,
    pendingConfigChanges,
    launchCatalog: agentCatalog.data,
    workspaceLaunchableAgentKinds,
    resolvedLaunchSelection,
    setLaunchSelection,
    submitSessionConfig,
    openNewSessionDraft,
  });

  useWebCloudChatLocalStateLifecycle({
    workspaceId,
    chatId,
    locationSearch: location.search,
    routeSessionDraftId,
    pendingSessionDraft,
    setPendingSessionDraft,
    pendingHomePrompt,
    setPendingHomePrompt,
    setPendingHomePromptStatus,
    optimisticPrompts,
    setOptimisticPrompts,
    pendingConfigChanges,
    setPendingConfigChanges,
    pendingHomePromptDispatchRunRef,
    pendingHomePromptResumeAttemptsRef,
    mountedRef,
    setLaunchSelection,
    launchSelection,
    canStartNewSession,
    launchCatalog: agentCatalog.data,
    workspaceLaunchableAgentKinds,
    workspace,
    workspaceStatus,
    workspaceRefetch: workspaceQuery.refetch,
    directPromptDispatching,
    suppressSessionRedirect,
    sessions,
    navigate,
  });

  useWebCloudPendingHomePromptLifecycle({
    client,
    productToken,
    workspace,
    workspaceStatus,
    workspaceAllowedAgentKindsKey,
    workspaceReadyAgentKindsKey,
    chatId,
    pendingHomePrompt,
    setPendingHomePrompt,
    setPendingHomePromptStatus,
    setOptimisticPrompts,
    setDraft,
    setPendingSessionDraft,
    pendingSessionDraft,
    routeSessionDraftId,
    pendingHomePromptDispatchRunRef,
    pendingHomePromptResumeAttemptsRef,
    mountedRef,
    directPromptDispatching,
    sessions,
    workspaceRefetch: workspaceQuery.refetch,
    navigate,
  });

  useWebCloudTranscriptLifecycle({
    session,
    sessionLiveLastPatchAt: sessionLive.lastPatchAt,
    transcriptRefetch: transcriptQuery.refetch,
    sessionEventsRefetch: sessionEventsQuery.refetch,
    pendingHomePrompt,
    directPromptDispatching,
    setPendingHomePromptStatus,
    setOptimisticPrompts,
    transcriptItems,
    transcriptRows: transcriptView.rows,
    liveConfig,
    setPendingConfigChanges,
  });

  if (!workspaceId) {
    return { kind: "missing", title: "Workspace not found" };
  }

  if (workspaceQuery.isLoading && !snapshot) {
    return { kind: "workspace-loading" };
  }

  if (workspaceQuery.error || !workspace) {
    return { kind: "missing", title: "Workspace not available" };
  }

  return {
    kind: "ready",
    surface: buildWebCloudChatSurfaceProps({
      workspace,
      session,
      sessions,
      pendingSessionDraft,
      pendingInteractions,
      workspaceStatus,
      isUnclaimed,
      canStartNewSession,
      workspaceHarnessAvailability,
      visiblePendingHomePromptStatus,
      pendingPromptCommandId,
      commandStatus: undefined,
      sessionLiveConnected: sessionLive.isConnected,
      transcriptSource: transcriptView.source,
      sessionEventsLoading: sessionEventsQuery.isLoading,
      transcriptSnapshotLoading: transcriptQuery.isLoading,
      visibleTranscriptRows,
      sharedTranscriptState,
      transcriptPlanActions,
      draft,
      onDraftChange: setDraft,
      onSubmitPrompt: () => void submitPrompt(),
      composerControls,
      directPromptDispatching,
      promptCommandPending: directPromptDispatching,
      claimWorkspacePending: false,
      onClaimWorkspace: () => void claimCurrentWorkspace(),
      onCopyComposerFooterValue: copyComposerFooterValue,
      onOpenNewSessionDraft: () => openNewSessionDraft(),
      navigate,
    }),
  };
}
