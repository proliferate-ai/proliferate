import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { createTranscriptState } from "@anyharness/sdk";
import type { CloudPendingInteraction, CloudSessionEvent, CloudTranscriptItem } from "@proliferate/cloud-sdk";
import {
  useClaimCloudWorkspace,
  useCloudAgentCatalog,
  useCloudCapabilities,
  useCloudClient,
  useCloudSessionEvents,
  useCloudTranscriptSnapshot,
  useCloudWorkspaceSnapshot,
  useCommandStatus,
  useEnqueueCloudCommand,
  useSessionLive,
  useWorkspaceLive,
  useAgentAuthCredentials,
} from "@proliferate/cloud-sdk-react";
import type { CloudChatSurfaceProps } from "@proliferate/product-ui/chat/CloudChatSurface";
import type { ChatTranscriptState } from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import {
  buildCloudTranscriptState,
  buildCloudTranscriptView,
  cloudPendingInteractionsRequireProjectedRows,
} from "@proliferate/product-domain/chats/cloud/transcript-view";
import {
  buildCloudChatComposerControls,
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  getLiveConfigControlValue,
  readSessionLiveConfig,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import {
  readySyncedCloudAgentKinds,
  resolveCloudHarnessAvailability,
} from "@proliferate/product-domain/chats/cloud/harness-availability";

import { friendlyCommandStatusMessage } from "../../../lib/domain/chat/cloud-chat-command-presentation";
import {
  latestPendingPromptCommandId,
  optimisticPromptCommandIdsFromPrompts,
  pendingConfigCommandIdsFromChanges,
  pendingPromptCommandIdsFromInteractions,
} from "../../../lib/domain/chat/cloud-chat-command-tracking";
import {
  buildCloudPromptOutboxEntries,
  buildOptimisticPromptRows,
  buildPendingHomePromptRows,
} from "../../../lib/domain/chat/cloud-chat-prompt-projection";
import {
  compareSessions,
  effectiveWorkspaceStatus,
  mergeWorkspaceSnapshot,
  shouldSuppressWorkspaceSessionRedirect,
} from "../../../lib/domain/chat/cloud-chat-session-model";
import { resolveCloudTranscriptSessionViewState } from "../../../lib/domain/chat/cloud-chat-transcript-session-state";
import type { SendPromptPayload, StartSessionPayload, UpdateSessionConfigPayload } from "../../../lib/access/cloud/pending-home-prompt-dispatch";
import { loadPendingHomePrompt, type PendingHomePrompt } from "../../../lib/access/cloud/pending-home-prompt-store";
import {
  loadWebCloudPendingConfigChanges,
  loadWebCloudPromptIntents,
  loadWebCloudSessionDraftFromSearch,
  webCloudSessionDraftIdFromOptionId,
  webCloudSessionDraftIdFromSearch,
  type WebCloudPromptIntent,
  type WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-chat-state-store";
import { buildWebCloudChatSurfaceProps } from "./build-web-cloud-chat-surface-props";
import { useWebCloudCommandLifecycle } from "../lifecycle/use-web-cloud-command-lifecycle";
import {
  useWebCloudChatLocalStateLifecycle,
  type PendingHomePromptDispatchRun,
} from "../lifecycle/use-web-cloud-chat-local-state-lifecycle";
import { useWebCloudPendingHomePromptLifecycle } from "../lifecycle/use-web-cloud-pending-home-prompt-lifecycle";
import { useWebCloudTranscriptLifecycle } from "../lifecycle/use-web-cloud-transcript-lifecycle";
import { useWebCloudChatActions } from "../workflows/use-web-cloud-chat-actions";

export type WebCloudChatScreenState =
  | { kind: "missing"; title: string }
  | { kind: "workspace-loading" }
  | { kind: "ready"; surface: CloudChatSurfaceProps };

type PlanDecisionPayload = { workspaceId: string; planId: string; decision: "approve" | "reject"; expectedDecisionVersion: number };

const EMPTY_SESSION_EVENTS: CloudSessionEvent[] = [];
const EMPTY_TRANSCRIPT_ITEMS: CloudTranscriptItem[] = [];
const EMPTY_PENDING_INTERACTIONS: CloudPendingInteraction[] = [];

export function useWebCloudChatScreen(): WebCloudChatScreenState {
  const { workspaceId, chatId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useCloudClient();
  const [draft, setDraft] = useState("");
  const [launchSelection, setLaunchSelection] = useState<CloudLaunchComposerSelection>({
    agentKind: DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: DEFAULT_DIRECT_PROMPT_MODEL_ID,
    modeId: null,
    controlValues: {},
  });
  const [latestCommandId, setLatestCommandId] = useState<string | null>(null);
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
  const workspaceQuery = useCloudWorkspaceSnapshot(workspaceId ?? null, Boolean(workspaceId));
  const agentCatalog = useCloudAgentCatalog();
  const cloudCapabilities = useCloudCapabilities();
  const agentAuthCredentials = useAgentAuthCredentials();
  const workspaceLive = useWorkspaceLive(workspaceId ?? null, { enabled: Boolean(workspaceId) });
  const snapshot = useMemo(
    () => mergeWorkspaceSnapshot(workspaceQuery.data, workspaceLive.snapshot),
    [workspaceLive.snapshot, workspaceQuery.data],
  );
  const workspace = snapshot?.workspace ?? null;
  const workspaceStatus = workspace ? effectiveWorkspaceStatus(workspace) : null;
  const sessions = useMemo(
    () => [...(snapshot?.sessions ?? [])].sort(compareSessions),
    [snapshot?.sessions],
  );
  const routeSessionDraftId = workspaceId ? webCloudSessionDraftIdFromSearch(location.search) : null;
  const suppressSessionRedirect = Boolean(routeSessionDraftId && pendingSessionDraft)
    || shouldSuppressWorkspaceSessionRedirect(location.state);
  const session = chatId
    ? sessions.find((candidate) => candidate.sessionId === chatId) ?? null
    : null;
  const activeTranscriptSessionId = session?.sessionId ?? chatId ?? null;
  const sessionLive = useSessionLive(session?.sessionId ?? null, {
    targetId: session?.targetId ?? null,
    enabled: Boolean(session),
  });
  const transcriptQuery = useCloudTranscriptSnapshot(
    session?.targetId ?? null,
    session?.sessionId ?? null,
    Boolean(session),
  );
  const sessionEventsQuery = useCloudSessionEvents(
    session?.targetId ?? null,
    session?.sessionId ?? null,
    Boolean(session),
  );
  const transcriptItems = sessionLive.snapshot?.transcriptItems
    ?? transcriptQuery.data?.transcriptItems
    ?? EMPTY_TRANSCRIPT_ITEMS;
  const pendingInteractions = sessionLive.snapshot?.pendingInteractions
    ?? transcriptQuery.data?.pendingInteractions
    ?? EMPTY_PENDING_INTERACTIONS;
  const pendingInteractionsRequireProjectedRows = useMemo(
    () => cloudPendingInteractionsRequireProjectedRows(pendingInteractions),
    [pendingInteractions],
  );
  const visiblePendingHomePromptStatus =
    friendlyCommandStatusMessage(pendingHomePromptStatus) ?? pendingHomePromptStatus;
  const pendingPromptCommandId = useMemo(
    () => latestPendingPromptCommandId(pendingInteractions),
    [pendingInteractions],
  );
  const pendingPromptCommandIds = useMemo(
    () => pendingPromptCommandIdsFromInteractions(pendingInteractions),
    [pendingInteractions],
  );
  const pendingPromptCommandIdsKey = pendingPromptCommandIds.join("\0");
  const optimisticPromptCommandIds = useMemo(
    () => optimisticPromptCommandIdsFromPrompts(optimisticPrompts),
    [optimisticPrompts],
  );
  const optimisticPromptCommandIdsKey = optimisticPromptCommandIds.join("\0");
  const pendingConfigCommandIds = useMemo(
    () => pendingConfigCommandIdsFromChanges(pendingConfigChanges),
    [pendingConfigChanges],
  );
  const pendingConfigCommandIdsKey = pendingConfigCommandIds.join("\0");
  const sessionEvents = sessionEventsQuery.data?.events ?? EMPTY_SESSION_EVENTS;
  const transcriptState = useMemo(
    () => buildCloudTranscriptState({
      sessionId: session?.sessionId ?? null,
      events: sessionEvents,
      fallbackItems: transcriptItems,
    }),
    [session?.sessionId, sessionEvents, transcriptItems],
  );
  const transcriptView = useMemo(
    () => buildCloudTranscriptView({
      sessionId: session?.sessionId ?? null,
      events: sessionEvents,
      fallbackItems: transcriptItems,
      pendingInteractions,
    }),
    [pendingInteractions, session?.sessionId, sessionEvents, transcriptItems],
  );
  const sharedOutboxEntries = useMemo(
    () => buildCloudPromptOutboxEntries({
      prompts: optimisticPrompts,
      pendingHomePrompt,
      workspaceId: workspace?.id ?? null,
      sessionId: activeTranscriptSessionId,
      pendingInteractions,
      status: visiblePendingHomePromptStatus,
    }),
    [
      activeTranscriptSessionId,
      optimisticPrompts,
      pendingHomePrompt,
      pendingInteractions,
      visiblePendingHomePromptStatus,
      workspace?.id,
    ],
  );
  const sharedTranscriptState = useMemo<ChatTranscriptState | null>(() => {
    const syntheticSessionId = activeTranscriptSessionId
      ?? session?.sessionId
      ?? pendingSessionDraft?.id
      ?? pendingHomePrompt?.id
      ?? optimisticPrompts[0]?.id
      ?? null;
    const transcript = pendingInteractionsRequireProjectedRows
      ? null
      : transcriptState.transcript
      ?? (
        syntheticSessionId && transcriptView.rows.length === 0 && sharedOutboxEntries.length > 0
          ? createTranscriptState(`web-draft:${syntheticSessionId}`)
          : null
      );
    if (!transcript) {
      return null;
    }
    return {
      activeSessionId: activeTranscriptSessionId
        ?? session?.sessionId
        ?? transcript.sessionMeta.sessionId,
      selectedWorkspaceId: workspace?.id ?? null,
      transcript,
      sessionViewState: resolveCloudTranscriptSessionViewState({
        status: session?.status ?? null,
        pendingInteractions,
        isStreaming: transcript.isStreaming,
      }),
      outboxEntries: sharedOutboxEntries,
    };
  }, [
    activeTranscriptSessionId,
    optimisticPrompts,
    pendingHomePrompt,
    pendingSessionDraft?.id,
    pendingInteractionsRequireProjectedRows,
    pendingInteractions,
    session?.sessionId,
    session?.status,
    transcriptState.transcript,
    transcriptView.rows.length,
    sharedOutboxEntries,
    workspace?.id,
  ]);
  const visibleTranscriptRows = useMemo(
    () => [
      ...transcriptView.rows,
      ...buildOptimisticPromptRows({
        prompts: optimisticPrompts,
        workspaceId: workspace?.id ?? null,
        sessionId: activeTranscriptSessionId,
        status: visiblePendingHomePromptStatus,
        transcriptItems,
        transcriptRows: transcriptView.rows,
        pendingInteractions,
        allowTextOnlyRowFallback: false,
      }),
      ...buildPendingHomePromptRows({
        pendingPrompt: pendingHomePrompt,
        workspaceId: workspace?.id ?? null,
        sessionId: activeTranscriptSessionId,
        status: visiblePendingHomePromptStatus,
        optimisticPrompts,
      }),
    ],
    [
      optimisticPrompts,
      pendingHomePrompt,
      visiblePendingHomePromptStatus,
      pendingInteractions,
      activeTranscriptSessionId,
      transcriptItems,
      transcriptView.rows,
      workspace?.id,
    ],
  );
  const enqueuePrompt = useEnqueueCloudCommand<SendPromptPayload>();
  const enqueueStartSession = useEnqueueCloudCommand<StartSessionPayload>();
  const enqueueConfig = useEnqueueCloudCommand<UpdateSessionConfigPayload>();
  const enqueuePlanDecision = useEnqueueCloudCommand<PlanDecisionPayload>();
  const claimWorkspace = useClaimCloudWorkspace();
  const observedPromptCommandId = pendingPromptCommandId ?? latestCommandId;
  const commandStatus = useCommandStatus(observedPromptCommandId);
  const isUnclaimed = workspace?.visibility === "shared_unclaimed";
  const workspaceReadyAgentKindsKey = workspace?.readyAgentKinds?.join("\0") ?? "";
  const workspaceAllowedAgentKindsKey = workspace?.allowedAgentKinds?.join("\0") ?? "";
  const workspaceUsesManagedRuntime =
    !workspace || workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared";
  const agentGateway = cloudCapabilities.data?.agentGateway;
  const readySyncedAgentKinds = useMemo(
    () => readySyncedCloudAgentKinds(agentAuthCredentials.data),
    [agentAuthCredentials.data],
  );
  const readySyncedAgentKindsKey = readySyncedAgentKinds.join("\0");
  const agentGatewayManagedCreditKindsKey = agentGateway?.managedCreditAgentKinds?.join("\0") ?? "";
  const catalogAgentKindsKey = agentCatalog.data?.agents.map((agent) => agent.kind).join("\0") ?? "";
  const workspaceHarnessAvailability = useMemo(() => resolveCloudHarnessAvailability({
    catalogAgentKinds: agentCatalog.data?.agents.map((agent) => agent.kind),
    allowedAgentKinds: workspace?.allowedAgentKinds,
    readyAgentKinds: workspace?.readyAgentKinds
      ?? (workspaceUsesManagedRuntime
        ? readySyncedAgentKinds
        : agentCatalog.data?.agents.map((agent) => agent.kind)),
    agentGateway: workspaceUsesManagedRuntime ? agentGateway : null,
    assumeFallbackAgentKindsLaunchable: !workspaceUsesManagedRuntime,
  }), [
    agentCatalog.data,
    readySyncedAgentKindsKey,
    agentGateway?.enabled,
    agentGateway?.managedCreditsOrganizationEnabled,
    agentGateway?.managedCreditsPersonalEnabled,
    agentGateway?.opencodeGatewayEnabled,
    agentGatewayManagedCreditKindsKey,
    catalogAgentKindsKey,
    workspaceAllowedAgentKindsKey,
    workspaceReadyAgentKindsKey,
    workspaceUsesManagedRuntime,
  ]);
  const workspaceLaunchableAgentKinds = workspaceHarnessAvailability.launchableAgentKinds;
  const canStartNewSession = workspaceLaunchableAgentKinds.length > 0;
  const liveConfig = readSessionLiveConfig(session);
  const resolvedLaunchSelection = useMemo(
    () => resolveCloudLaunchSelection({
      catalog: agentCatalog.data,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection: launchSelection,
    }),
    [agentCatalog.data, launchSelection, workspaceLaunchableAgentKinds],
  );
  const sessionModelId = session && liveConfig ? getLiveConfigControlValue(liveConfig, "model") : null;
  const {
    activePlanDecision,
    setActivePlanDecision,
    submitPrompt,
    submitSessionConfig,
    transcriptPlanActions,
    claimCurrentWorkspace,
    copyComposerFooterValue,
    openNewSessionDraft,
  } = useWebCloudChatActions({
    client,
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
    sessionModelId,
    mountedRef,
    setLatestCommandId,
    enqueuePrompt: enqueuePrompt.mutateAsync,
    enqueueStartSession: enqueueStartSession.mutateAsync,
    enqueueConfig: enqueueConfig.mutateAsync,
    enqueuePlanDecision: enqueuePlanDecision.mutateAsync,
    workspaceRefetch: workspaceQuery.refetch,
    transcriptRefetch: transcriptQuery.refetch,
    sessionEventsRefetch: sessionEventsQuery.refetch,
    transcriptItems,
    transcriptRows: transcriptView.rows,
    claimWorkspace,
    navigate,
  });
  const composerControls = buildCloudChatComposerControls({
    session,
    liveConfig,
    pendingConfigChanges,
    launchCatalog: agentCatalog.data,
    launchableAgentKinds: workspaceLaunchableAgentKinds,
    launchSelection: resolvedLaunchSelection,
    launchModelId: resolvedLaunchSelection.modelId ?? DEFAULT_DIRECT_PROMPT_MODEL_ID,
    onLaunchAgentModelSelect: (agentKind, modelId) => {
      setLaunchSelection((current) => ({
        agentKind,
        modelId,
        modeId: current.agentKind === agentKind ? current.modeId : null,
        controlValues: current.agentKind === agentKind ? current.controlValues : {},
      }));
    },
    onLaunchControlSelect: ({ controlKey, value }) => {
      setLaunchSelection((current) => {
        if (controlKey === "mode") {
          return { ...current, modeId: value };
        }
        return {
          ...current,
          controlValues: {
            ...current.controlValues,
            [controlKey]: value,
          },
        };
      });
    },
    onLaunchModelSelect: (modelId) => {
      setLaunchSelection((current) => ({ ...current, modelId }));
    },
    onSessionConfigSelect: (rawConfigId, value) => {
      void submitSessionConfig(rawConfigId, value);
    },
    onSessionAgentModelSelect: ({ agentKind, modelId }) => {
      openNewSessionDraft({
        agentKind,
        modelId,
        modeId: null,
        controlValues: {},
      });
    },
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
    setLatestCommandId,
    setPendingSessionDraft,
    pendingSessionDraft,
    routeSessionDraftId,
    pendingHomePromptDispatchRunRef,
    pendingHomePromptResumeAttemptsRef,
    mountedRef,
    directPromptDispatching,
    sessions,
    enqueueStartSession: enqueueStartSession.mutateAsync,
    enqueueConfig: enqueueConfig.mutateAsync,
    enqueuePrompt: enqueuePrompt.mutateAsync,
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

  useWebCloudCommandLifecycle({
    client,
    commandStatus: commandStatus.data,
    pendingPromptCommandId,
    pendingPromptCommandIds,
    pendingPromptCommandIdsKey,
    optimisticPrompts,
    optimisticPromptCommandIds,
    optimisticPromptCommandIdsKey,
    pendingConfigCommandIds,
    pendingConfigCommandIdsKey,
    activePlanDecision,
    visibleTranscriptRows,
    setOptimisticPrompts,
    setPendingConfigChanges,
    setPendingHomePromptStatus,
    setActivePlanDecision,
    transcriptRefetch: transcriptQuery.refetch,
    sessionEventsRefetch: sessionEventsQuery.refetch,
    workspaceRefetch: workspaceQuery.refetch,
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
      commandStatus: commandStatus.data,
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
      promptCommandPending: enqueuePrompt.isPending,
      claimWorkspacePending: claimWorkspace.isPending,
      onClaimWorkspace: () => void claimCurrentWorkspace(),
      onCopyComposerFooterValue: copyComposerFooterValue,
      onOpenNewSessionDraft: () => openNewSessionDraft(),
      navigate,
    }),
  };
}
