import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  desktopWorkspaceDeepLink,
  getCommandStatus,
  type CloudCommandResponse,
  type CloudCommandStatus,
  type CloudPendingInteraction,
  type CloudSessionEvent,
  type CloudSessionProjection,
  type CloudTranscriptItem,
  type CloudWorkspaceSnapshot,
} from "@proliferate/cloud-sdk";
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
import {
  CloudChatSurface,
} from "@proliferate/product-ui/chat/CloudChatSurface";
import type {
  CloudChatComposerFooterControlView,
} from "@proliferate/product-ui/chat/CloudChatComposer";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  buildCloudTranscriptView,
  cloudTranscriptHasAgentProgressAfterPrompt,
  cloudTranscriptHasUserPrompt,
  latestCloudTranscriptSeq,
  type CloudChatTranscriptRowView,
} from "@proliferate/product-model/chats/cloud/transcript-view";
import {
  buildCloudChatComposerControls,
  buildLaunchSessionConfigUpdates,
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  getLiveConfigControlValue,
  pendingConfigChangeKey,
  readSessionLiveConfig,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-model/chats/cloud/composer-controls";
import {
  readySyncedCloudAgentKinds,
  resolveCloudHarnessAvailability,
} from "@proliferate/product-model/chats/cloud/harness-availability";
import {
  cloudCommandReadiness,
  recentWorkCloudAccessState,
  recentWorkCommandability,
  recentWorkRuntimeLocationForWorkspace,
} from "@proliferate/product-model/workspaces/cloud-work-inventory";

import { routes } from "../../../config/routes";
import {
  dispatchPendingHomePrompt,
  enqueuePromptCommandWithRetry,
  prepareManagedWorkspaceForCloudCommands,
  resumePendingHomePromptInSession,
  type SendPromptPayload,
  type StartSessionPayload,
  type UpdateSessionConfigPayload,
} from "../../../lib/access/cloud/pending-home-prompt-dispatch";
import {
  clearPendingHomePrompt,
  loadPendingHomePrompt,
  savePendingHomePrompt,
  type PendingHomePrompt,
} from "../../../lib/access/cloud/pending-home-prompt-store";
import {
  clearWebCloudSessionDraft,
  createWebCloudSessionDraft,
  loadWebCloudPendingConfigChanges,
  loadWebCloudPromptIntents,
  loadWebCloudSessionDraftFromSearch,
  saveWebCloudPendingConfigChanges,
  saveWebCloudPromptIntents,
  saveWebCloudSessionDraft,
  webCloudSessionDraftIdFromOptionId,
  webCloudSessionDraftIdFromSearch,
  webCloudSessionDraftOptionId,
  webCloudSessionDraftSearch,
  type WebCloudPromptIntent,
  type WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-chat-state-store";

type PendingHomePromptDispatchRun = {
  key: string;
  active: boolean;
  started: boolean;
};

type OptimisticPrompt = WebCloudPromptIntent;

const EMPTY_SESSION_EVENTS: CloudSessionEvent[] = [];
const EMPTY_TRANSCRIPT_ITEMS: CloudTranscriptItem[] = [];
const EMPTY_PENDING_INTERACTIONS: CloudPendingInteraction[] = [];

export function ChatScreen() {
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
  const [optimisticPrompts, setOptimisticPrompts] = useState<OptimisticPrompt[]>(() =>
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
  const workspace = snapshot?.workspace;
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
  const visiblePendingHomePromptStatus = isCopyFeedbackStatus(pendingHomePromptStatus)
    ? null
    : friendlyCommandStatusMessage(pendingHomePromptStatus) ?? pendingHomePromptStatus;
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
  const transcriptView = useMemo(
    () => buildCloudTranscriptView({
      sessionId: session?.sessionId ?? null,
      events: sessionEvents,
      fallbackItems: transcriptItems,
      pendingInteractions,
    }),
    [pendingInteractions, session?.sessionId, sessionEvents, transcriptItems],
  );
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pendingHomePromptDispatchRunRef.current) {
        pendingHomePromptDispatchRunRef.current.active = false;
      }
    };
  }, []);

  useEffect(() => {
    setPendingHomePrompt(workspaceId ? loadPendingHomePrompt(workspaceId) : null);
    setPendingHomePromptStatus(null);
    setOptimisticPrompts(workspaceId ? loadWebCloudPromptIntents(workspaceId) : []);
    setPendingConfigChanges(workspaceId ? loadWebCloudPendingConfigChanges(workspaceId) : {});
    pendingHomePromptResumeAttemptsRef.current.clear();
  }, [workspaceId]);

  useEffect(() => {
    setPendingSessionDraft(
      workspaceId ? loadWebCloudSessionDraftFromSearch(workspaceId, location.search) : null,
    );
  }, [location.search, workspaceId]);

  useEffect(() => {
    if (!workspaceId || optimisticPrompts.some((prompt) => prompt.workspaceId !== workspaceId)) {
      return;
    }
    saveWebCloudPromptIntents(workspaceId, optimisticPrompts);
  }, [optimisticPrompts, workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    saveWebCloudPendingConfigChanges(workspaceId, pendingConfigChanges);
  }, [pendingConfigChanges, workspaceId]);

  useEffect(() => {
    if (!pendingSessionDraft) {
      return;
    }
    setLaunchSelection(pendingSessionDraft.selection);
  }, [pendingSessionDraft?.id]);

  useEffect(() => {
    if (!workspaceId || !routeSessionDraftId || pendingSessionDraft) {
      return;
    }
    clearWebCloudSessionDraft(workspaceId, routeSessionDraftId);
    navigate(routes.workspace(workspaceId), { replace: true });
  }, [navigate, pendingSessionDraft, routeSessionDraftId, workspaceId]);

  useEffect(() => {
    if (!pendingSessionDraft) {
      return;
    }
    if (!canStartNewSession) {
      return;
    }
    const resolvedSelection = resolveCloudLaunchSelection({
      catalog: agentCatalog.data,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection: launchSelection,
    });
    const sessionConfigUpdates = buildLaunchSessionConfigUpdates({
      catalog: agentCatalog.data,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection: resolvedSelection,
    });
    if (sessionDraftMatchesSelection(pendingSessionDraft, resolvedSelection, sessionConfigUpdates)) {
      return;
    }
    const nextDraft = {
      ...pendingSessionDraft,
      selection: resolvedSelection,
      sessionConfigUpdates,
    };
    saveWebCloudSessionDraft(nextDraft);
    setPendingSessionDraft(nextDraft);
  }, [
    agentCatalog.data,
    launchSelection,
    pendingSessionDraft?.id,
    pendingSessionDraft?.workspaceId,
    canStartNewSession,
    workspaceLaunchableAgentKinds,
  ]);

  useEffect(() => {
    if (!workspaceId || !workspace || workspaceStatus === "ready" || workspaceStatus === "error") {
      return;
    }
    const interval = window.setInterval(() => {
      void workspaceQuery.refetch();
    }, 2500);
    return () => {
      window.clearInterval(interval);
    };
  }, [workspace, workspaceStatus, workspaceId, workspaceQuery.refetch]);

  useEffect(() => {
    if (
      !workspaceId
      || chatId
      || pendingHomePrompt
      || directPromptDispatching
      || suppressSessionRedirect
    ) {
      return;
    }
    const latestSession = sessions[0];
    if (!latestSession) {
      return;
    }
    navigate(routes.chat(workspaceId, latestSession.sessionId), { replace: true });
  }, [
    chatId,
    directPromptDispatching,
    navigate,
    pendingHomePrompt,
    sessions,
    suppressSessionRedirect,
    workspaceId,
  ]);

  useEffect(() => {
    if (!pendingHomePrompt || !workspace) {
      return;
    }
    const workspaceFailureMessage = workspaceFailureStatusMessage(workspace);
    if (pendingHomePrompt.status === "failed") {
      setPendingHomePromptStatus(
        workspaceFailureMessage
          ?? pendingHomePrompt.errorMessage
          ?? "Prompt could not be sent.",
      );
      setDraft((current) => current.trim() ? current : pendingHomePrompt.text);
      return;
    }
    if (workspaceStatus === "error" || workspaceStatus === "archived") {
      setPendingHomePromptStatus(
        workspaceFailureMessage ?? "Workspace creation failed before the prompt could be sent.",
      );
      return;
    }
    if (workspaceStatus !== "ready") {
      setPendingHomePromptStatus("Workspace is provisioning; the prompt will send when ready.");
      return;
    }

    const runKey = `${workspace.id}:${pendingHomePrompt.id}`;
    const currentRun = pendingHomePromptDispatchRunRef.current;
    if (currentRun?.key === runKey && currentRun.active) {
      return;
    }

    const run: PendingHomePromptDispatchRun = { key: runKey, active: true, started: false };
    pendingHomePromptDispatchRunRef.current = run;
    const isCurrentRun = () =>
      mountedRef.current && pendingHomePromptDispatchRunRef.current === run && run.active;
    const setCurrentStatus = (status: string) => {
      if (isCurrentRun()) {
        setPendingHomePromptStatus(status);
      }
    };

    setPendingHomePromptStatus("Starting a session for this prompt.");
    const timeoutId = window.setTimeout(() => {
      if (!isCurrentRun()) {
        return;
      }
      run.started = true;
      void dispatchPendingHomePrompt({
        client,
        workspace,
        pendingPrompt: pendingHomePrompt,
        modelId: pendingHomePrompt.modelId,
        enqueueStartSession: enqueueStartSession.mutateAsync,
        enqueueConfig: enqueueConfig.mutateAsync,
        enqueuePrompt: enqueuePrompt.mutateAsync,
        setLatestCommandId: (commandId) => {
          if (isCurrentRun()) {
            setLatestCommandId(commandId);
          }
        },
        onStatus: setCurrentStatus,
        shouldContinue: isCurrentRun,
      })
          .then((result) => {
            if (!isCurrentRun()) {
              return;
            }
            setOptimisticPrompts((current) =>
              current.some((prompt) => prompt.id === pendingHomePrompt.id)
              ? current
              : [
                ...current,
                {
                  id: pendingHomePrompt.id,
                  workspaceId: workspace.id,
                  sessionId: result.sessionId,
                  text: pendingHomePrompt.text,
                  baseTranscriptSeq: 0,
                  status: "queued",
                  commandId: result.sendCommandId,
                  createdAt: Date.now(),
                },
              ]
          );
          clearPendingHomePrompt(workspace.id);
          clearWebCloudSessionDraft(workspace.id, pendingSessionDraft?.id ?? routeSessionDraftId);
          setPendingSessionDraft(null);
          setPendingHomePrompt(null);
          setPendingHomePromptStatus(null);
          void workspaceQuery.refetch();
          navigate(routes.chat(workspace.id, result.sessionId), { replace: true });
        })
        .catch((error: unknown) => {
          if (!isCurrentRun()) {
            return;
          }
          const message = error instanceof Error ? error.message : "Prompt could not be sent.";
          const prompt: PendingHomePrompt = isWorkspacePreparationStatus(message)
            ? {
              ...pendingHomePrompt,
              status: "pending",
              errorMessage: message,
            }
            : {
              ...pendingHomePrompt,
              status: "failed",
              errorMessage: message,
            };
          savePendingHomePrompt(workspace.id, prompt);
          setPendingHomePrompt(prompt);
          setPendingHomePromptStatus(message);
          setDraft((current) => current.trim() ? current : pendingHomePrompt.text);
        })
        .finally(() => {
          if (pendingHomePromptDispatchRunRef.current === run) {
            pendingHomePromptDispatchRunRef.current = null;
          }
        });
    }, 0);
    return () => {
      if (!run.started) {
        run.active = false;
      }
      window.clearTimeout(timeoutId);
    };
  }, [
    client,
    enqueuePrompt.mutateAsync,
    enqueueStartSession.mutateAsync,
    enqueueConfig.mutateAsync,
    navigate,
    pendingHomePrompt,
    routeSessionDraftId,
    workspace?.anyharnessWorkspaceId,
    workspace?.id,
    workspace?.targetId,
    workspaceStatus,
    workspaceAllowedAgentKindsKey,
    workspaceReadyAgentKindsKey,
    workspaceQuery.refetch,
  ]);

  useEffect(() => {
    if (
      !workspace
      || chatId
      || !pendingHomePrompt
      || pendingHomePrompt.status !== "failed"
      || directPromptDispatching
    ) {
      return;
    }
    const recoverableSession = findRecoverableSessionForPendingPrompt(sessions, pendingHomePrompt);
    if (!recoverableSession) {
      return;
    }
    const runKey = `${workspace.id}:${pendingHomePrompt.id}:resume:${recoverableSession.sessionId}`;
    if (pendingHomePromptResumeAttemptsRef.current.has(runKey)) {
      return;
    }
    const currentRun = pendingHomePromptDispatchRunRef.current;
    if (currentRun?.key === runKey && currentRun.active) {
      return;
    }

    pendingHomePromptResumeAttemptsRef.current.add(runKey);
    const run: PendingHomePromptDispatchRun = { key: runKey, active: true, started: true };
    pendingHomePromptDispatchRunRef.current = run;
    const isCurrentRun = () =>
      mountedRef.current && pendingHomePromptDispatchRunRef.current === run && run.active;
    const setCurrentStatus = (status: string) => {
      if (isCurrentRun()) {
        setPendingHomePromptStatus(status);
      }
    };

    setPendingHomePromptStatus("Session started; sending prompt.");
    void resumePendingHomePromptInSession({
      client,
      workspace,
      session: recoverableSession,
      pendingPrompt: pendingHomePrompt,
      enqueueConfig: enqueueConfig.mutateAsync,
      enqueuePrompt: enqueuePrompt.mutateAsync,
      setLatestCommandId: (commandId) => {
        if (isCurrentRun()) {
          setLatestCommandId(commandId);
        }
      },
      onStatus: setCurrentStatus,
      shouldContinue: isCurrentRun,
    })
      .then((result) => {
        if (!isCurrentRun()) {
          return;
        }
        setOptimisticPrompts((current) => {
          const updated = current.map((prompt) =>
            prompt.id === pendingHomePrompt.id
              ? {
                ...prompt,
                sessionId: result.sessionId,
                status: "queued" as const,
                commandId: result.sendCommandId,
                errorMessage: null,
              }
              : prompt
          );
          return updated.some((prompt) => prompt.id === pendingHomePrompt.id)
            ? updated
            : [
              ...updated,
              {
                id: pendingHomePrompt.id,
                workspaceId: workspace.id,
                sessionId: result.sessionId,
                text: pendingHomePrompt.text,
                baseTranscriptSeq: 0,
                status: "queued",
                commandId: result.sendCommandId,
                createdAt: Date.now(),
              },
            ];
        });
        clearPendingHomePrompt(workspace.id);
        setPendingHomePrompt(null);
        setPendingHomePromptStatus(null);
        setDraft((current) => textMatches(current, pendingHomePrompt.text) ? "" : current);
        void workspaceQuery.refetch();
        navigate(routes.chat(workspace.id, result.sessionId), { replace: true });
      })
      .catch((error: unknown) => {
        if (!isCurrentRun()) {
          return;
        }
        const message = error instanceof Error ? error.message : "Prompt could not be sent.";
        const prompt: PendingHomePrompt = {
          ...pendingHomePrompt,
          status: "failed",
          errorMessage: message,
        };
        savePendingHomePrompt(workspace.id, prompt);
        setPendingHomePrompt(prompt);
        setPendingHomePromptStatus(message);
        setDraft((current) => current.trim() ? current : pendingHomePrompt.text);
      })
      .finally(() => {
        if (pendingHomePromptDispatchRunRef.current === run) {
          pendingHomePromptDispatchRunRef.current = null;
        }
      });
    return () => {
      if (!run.started) {
        run.active = false;
      }
    };
  }, [
    chatId,
    client,
    directPromptDispatching,
    enqueueConfig.mutateAsync,
    enqueuePrompt.mutateAsync,
    navigate,
    pendingHomePrompt,
    sessions,
    workspace,
    workspaceQuery.refetch,
  ]);

  useEffect(() => {
    if (!session || !sessionLive.lastPatchAt) {
      return;
    }
    void transcriptQuery.refetch();
    void sessionEventsQuery.refetch();
  }, [
    session?.sessionId,
    sessionLive.lastPatchAt,
    sessionEventsQuery.refetch,
    transcriptQuery.refetch,
  ]);

  useEffect(() => {
    if (session && !pendingHomePrompt && !directPromptDispatching) {
      setPendingHomePromptStatus(null);
    }
  }, [directPromptDispatching, pendingHomePrompt, session?.sessionId]);

  useEffect(() => {
    if (!session) {
      return;
    }
    setOptimisticPrompts((current) =>
      current.filter((prompt) =>
        prompt.sessionId !== session.sessionId
        || prompt.status === "failed"
        || !cloudTranscriptHasAgentProgressAfterPrompt({
          prompt,
          transcriptItems,
          transcriptRows: transcriptView.rows,
        })
      )
    );
  }, [session?.sessionId, transcriptItems, transcriptView.rows]);

  useEffect(() => {
    if (!session || !liveConfig) {
      return;
    }
    setPendingConfigChanges((current) => {
      let changed = false;
      const next = { ...current };
      for (const [key, pendingChange] of Object.entries(current)) {
        if (pendingChange.sessionId !== session.sessionId) {
          continue;
        }
        if (getLiveConfigControlValue(liveConfig, pendingChange.rawConfigId) === pendingChange.value) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [liveConfig, session?.sessionId]);

  useEffect(() => {
    const command = commandStatus.data;
    if (!command || !isRejectedCommandStatus(command.status)) {
      return;
    }
    const hasMatchingOptimisticPrompt = optimisticPrompts.some((prompt) =>
      prompt.commandId === command.commandId && prompt.status !== "failed"
    );
    const isPersistedPendingPromptCommand = pendingPromptCommandId === command.commandId;
    if (!hasMatchingOptimisticPrompt && !isPersistedPendingPromptCommand) {
      return;
    }
    const message = commandStatusFailureMessage(
      command,
      promptCommandFailureMessage(command.status),
    ) ?? promptCommandFailureMessage(command.status);
    const isPreparing = isWorkspacePreparationStatus(message);
    if (hasMatchingOptimisticPrompt) {
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.commandId === command.commandId
            ? { ...prompt, status: isPreparing ? "queued" : "failed" }
            : prompt
        )
      );
    }
    if (hasMatchingOptimisticPrompt) {
      setPendingHomePromptStatus(message);
    }
    if (isPersistedPendingPromptCommand) {
      void transcriptQuery.refetch();
      void sessionEventsQuery.refetch();
    }
  }, [
    commandStatus.data?.commandId,
    commandStatus.data?.errorCode,
    commandStatus.data?.errorMessage,
    commandStatus.data?.status,
    pendingPromptCommandId,
    optimisticPrompts,
    sessionEventsQuery.refetch,
    transcriptQuery.refetch,
  ]);

  useEffect(() => {
    if (pendingPromptCommandIds.length === 0) {
      return;
    }
    let active = true;
    let timeoutId: number | undefined;

    const pollPendingCommands = async () => {
      let sawTerminalCommand = false;
      for (const commandId of pendingPromptCommandIds) {
        try {
          const command = await getCommandStatus(commandId, client);
          if (isTerminalCommandStatus(command.status)) {
            sawTerminalCommand = true;
          }
        } catch {
          // Keep polling other pending commands; transient status reads should not stop transcript updates.
        }
      }
      if (!active) {
        return;
      }
      if (sawTerminalCommand) {
        void transcriptQuery.refetch();
        void sessionEventsQuery.refetch();
      }
      timeoutId = window.setTimeout(pollPendingCommands, 3000);
    };

    timeoutId = window.setTimeout(pollPendingCommands, 0);
    return () => {
      active = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    client,
    pendingPromptCommandIdsKey,
    sessionEventsQuery.refetch,
    transcriptQuery.refetch,
  ]);

  useEffect(() => {
    if (optimisticPromptCommandIds.length === 0) {
      return;
    }
    let active = true;
    let timeoutId: number | undefined;

    const pollOptimisticPromptCommands = async () => {
      let sawTerminalCommand = false;
      let failureMessage: string | null = null;
      for (const commandId of optimisticPromptCommandIds) {
        try {
          const command = await getCommandStatus(commandId, client);
          if (isTerminalCommandStatus(command.status)) {
            sawTerminalCommand = true;
          }
          if (isRejectedCommandStatus(command.status)) {
            const message = commandStatusFailureMessage(
              command,
              promptCommandFailureMessage(command.status),
            );
            failureMessage = failureMessage ?? message;
            setOptimisticPrompts((current) =>
              current.map((prompt) =>
                prompt.commandId === command.commandId
                  ? { ...prompt, status: "failed", errorMessage: message }
                  : prompt
              )
            );
          } else if (command.status === "accepted" || command.status === "accepted_but_queued") {
            setOptimisticPrompts((current) =>
              current.map((prompt) =>
                prompt.commandId === command.commandId && prompt.status === "sending"
                  ? { ...prompt, status: "queued" }
                  : prompt
              )
            );
          }
        } catch {
          // Keep polling other commands; a transient read should not strand prompt echoes.
        }
      }
      if (!active) {
        return;
      }
      if (failureMessage) {
        setPendingHomePromptStatus(failureMessage);
      }
      if (sawTerminalCommand) {
        void transcriptQuery.refetch();
        void sessionEventsQuery.refetch();
      }
      timeoutId = window.setTimeout(pollOptimisticPromptCommands, 3000);
    };

    timeoutId = window.setTimeout(pollOptimisticPromptCommands, 0);
    return () => {
      active = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    client,
    optimisticPromptCommandIdsKey,
    sessionEventsQuery.refetch,
    transcriptQuery.refetch,
  ]);

  useEffect(() => {
    const command = commandStatus.data;
    if (!command || command.commandId !== pendingPromptCommandId) {
      return;
    }
    if (!isTerminalCommandStatus(command.status)) {
      return;
    }
    void transcriptQuery.refetch();
    void sessionEventsQuery.refetch();
  }, [
    commandStatus.data?.commandId,
    commandStatus.data?.status,
    pendingPromptCommandId,
    sessionEventsQuery.refetch,
    transcriptQuery.refetch,
  ]);

  useEffect(() => {
    if (pendingConfigCommandIds.length === 0) {
      return;
    }
    let active = true;
    let timeoutId: number | undefined;

    const pollPendingConfigCommands = async () => {
      let sawTerminalCommand = false;
      for (const commandId of pendingConfigCommandIds) {
        try {
          const command = await getCommandStatus(commandId, client);
          if (isTerminalCommandStatus(command.status)) {
            sawTerminalCommand = true;
          }
          if (isRejectedCommandStatus(command.status)) {
            setPendingConfigChanges((current) =>
              removePendingConfigCommand(current, command.commandId)
            );
            setPendingHomePromptStatus(
              commandStatusFailureMessage(
                command,
                sessionConfigCommandFailureMessage(command.status),
              ) ?? sessionConfigCommandFailureMessage(command.status),
            );
          }
        } catch {
          // Keep polling other pending config commands; transient reads should not strand indicators.
        }
      }
      if (!active) {
        return;
      }
      if (sawTerminalCommand) {
        void workspaceQuery.refetch();
      }
      timeoutId = window.setTimeout(pollPendingConfigCommands, 1000);
    };

    timeoutId = window.setTimeout(pollPendingConfigCommands, 0);
    return () => {
      active = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    client,
    pendingConfigCommandIdsKey,
    workspaceQuery.refetch,
  ]);

  useEffect(() => {
    const command = commandStatus.data;
    if (!command || !isRejectedCommandStatus(command.status)) {
      return;
    }
    if (!optimisticPrompts.some((prompt) =>
      prompt.commandId === command.commandId && prompt.status !== "failed"
    )) {
      return;
    }
    const message = commandStatusFailureMessage(
      command,
      promptCommandFailureMessage(command.status),
    ) ?? promptCommandFailureMessage(command.status);
    const isPreparing = isWorkspacePreparationStatus(message);
    setOptimisticPrompts((current) =>
      current.map((prompt) =>
        prompt.commandId === command.commandId && prompt.status !== "failed"
          ? { ...prompt, status: isPreparing ? "queued" : "failed" }
          : prompt
      ),
    );
    setPendingHomePromptStatus(message);
  }, [
    commandStatus.data?.commandId,
    commandStatus.data?.errorCode,
    commandStatus.data?.errorMessage,
    commandStatus.data?.status,
    optimisticPrompts,
  ]);

  async function submitPrompt() {
    const text = draft.trim();
    if (!text || !workspace) {
      return;
    }
    if (isUnclaimed) {
      setPendingHomePromptStatus("Claim this shared workspace before sending prompts.");
      return;
    }
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPendingHomePromptStatus(readiness.message ?? "This workspace cannot accept cloud commands right now.");
      return;
    }
    if (!session) {
      if (!canStartNewSession) {
        setPendingHomePromptStatus(
          workspaceHarnessAvailability.message
            ?? "No cloud agent is ready to start a new session in this workspace.",
        );
        return;
      }
      if (workspaceStatus !== "ready") {
        setPendingHomePromptStatus("Workspace is provisioning; the prompt will send when ready.");
        return;
      }
      if (directPromptDispatching) {
        return;
      }
      const promptId = `web-chat:${workspace.id}:${Date.now().toString(36)}`;
      const optimisticPrompt: OptimisticPrompt = {
        id: promptId,
        workspaceId: workspace.id,
        sessionId: null,
        text,
        baseTranscriptSeq: 0,
        status: "sending",
        createdAt: Date.now(),
      };
      setOptimisticPrompts((current) => [
        ...removeRetryReplacedFailedPrompts(current, optimisticPrompt),
        optimisticPrompt,
      ]);
      setDraft("");
      setDirectPromptDispatching(true);
      setPendingHomePromptStatus("Starting a session for this prompt.");
      const promptSelection = resolveCloudLaunchSelection({
        catalog: agentCatalog.data,
        launchableAgentKinds: workspaceLaunchableAgentKinds,
        selection: pendingSessionDraft?.selection ?? resolvedLaunchSelection,
      });
      const promptConfigUpdates = pendingSessionDraft?.sessionConfigUpdates
        ?? buildLaunchSessionConfigUpdates({
          catalog: agentCatalog.data,
          launchableAgentKinds: workspaceLaunchableAgentKinds,
          selection: promptSelection,
        });
      const pendingPrompt: PendingHomePrompt = {
        id: promptId,
        text,
        agentKind: promptSelection.agentKind,
        modelId: promptSelection.modelId,
        modeId: promptSelection.modeId,
        sessionConfigUpdates: promptConfigUpdates,
        createdAt: Date.now(),
      };
      savePendingHomePrompt(workspace.id, pendingPrompt);
      try {
        const result = await dispatchPendingHomePrompt({
          client,
          workspace,
          pendingPrompt,
          modelId: pendingPrompt.modelId,
          enqueueStartSession: enqueueStartSession.mutateAsync,
          enqueueConfig: enqueueConfig.mutateAsync,
          enqueuePrompt: enqueuePrompt.mutateAsync,
          setLatestCommandId,
          onStatus: setPendingHomePromptStatus,
          shouldContinue: () => mountedRef.current,
        });
        setOptimisticPrompts((current) =>
          current.map((prompt) =>
            prompt.id === optimisticPrompt.id
              ? {
                ...prompt,
                sessionId: result.sessionId,
                status: "queued",
                commandId: result.sendCommandId,
              }
              : prompt
          )
        );
        clearPendingHomePrompt(workspace.id);
        clearWebCloudSessionDraft(workspace.id, pendingSessionDraft?.id ?? routeSessionDraftId);
        setPendingSessionDraft(null);
        setPendingHomePrompt(null);
        setPendingHomePromptStatus(null);
        await workspaceQuery.refetch();
        navigate(routes.chat(workspace.id, result.sessionId));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Prompt could not be sent.";
        const isPreparing = isWorkspacePreparationStatus(message);
        setOptimisticPrompts((current) =>
          current.map((prompt) =>
            prompt.id === optimisticPrompt.id
              ? { ...prompt, status: isPreparing ? "queued" : "failed" }
              : prompt
          )
        );
        setDraft((current) => current.trim() ? current : text);
        const prompt: PendingHomePrompt = {
          ...pendingPrompt,
          status: isPreparing ? "pending" : "failed",
          errorMessage: message,
        };
        savePendingHomePrompt(workspace.id, prompt);
        setPendingHomePrompt(prompt);
        setPendingHomePromptStatus(message);
      } finally {
        setDirectPromptDispatching(false);
      }
      return;
    }
    const optimisticPrompt: OptimisticPrompt = {
      id: `web:${workspace.id}:${session.sessionId}:${Date.now()}`,
      workspaceId: workspace.id,
      sessionId: session.sessionId,
      text,
      baseTranscriptSeq: latestCloudTranscriptSeq(transcriptItems, transcriptView.rows),
      status: "sending",
      createdAt: Date.now(),
    };
    setOptimisticPrompts((current) => [
      ...removeRetryReplacedFailedPrompts(current, optimisticPrompt),
      optimisticPrompt,
    ]);
    setDraft("");
    setPendingHomePromptStatus(null);
    try {
      const commandWorkspace = await prepareManagedWorkspaceForCloudCommands({
        client,
        workspace,
        agentKind: session.sourceAgentKind ?? resolvedLaunchSelection.agentKind,
        modelId: sessionModelId,
        idempotencyKey: `${optimisticPrompt.id}:target-config`,
        setLatestCommandId,
        onStatus: setPendingHomePromptStatus,
        shouldContinue: () => mountedRef.current,
      });
      const command = await enqueuePromptCommandWithRetry({
        envelope: {
          idempotencyKey: optimisticPrompt.id,
          targetId: session.targetId,
          workspaceId: session.workspaceId,
          cloudWorkspaceId: commandWorkspace.id,
          sessionId: session.sessionId,
          kind: "send_prompt",
          source: "web",
          payload: { text, promptId: optimisticPrompt.id },
        },
        enqueuePrompt: enqueuePrompt.mutateAsync,
        shouldContinue: () => mountedRef.current,
      });
      if (!mountedRef.current) {
        return;
      }
      setLatestCommandId(command.commandId);
      if (isRejectedCommandStatus(command.status)) {
        throw new Error(
          commandStatusFailureMessage(command, promptCommandFailureMessage(command.status))
            ?? promptCommandFailureMessage(command.status),
        );
      }
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id
            ? { ...prompt, commandId: command.commandId, status: "queued" }
            : prompt
        )
      );
      setPendingHomePromptStatus(null);
      void transcriptQuery.refetch();
      void sessionEventsQuery.refetch();
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id ? { ...prompt, status: "failed" } : prompt
        )
      );
      setDraft((current) => current.trim() ? current : text);
      setPendingHomePromptStatus(
        error instanceof Error ? error.message : "Prompt could not be sent.",
      );
    }
  }

  async function submitSessionConfig(rawConfigId: string, value: string) {
    if (!workspace || !session) {
      return;
    }
    const mutationId = pendingConfigMutationIdRef.current + 1;
    pendingConfigMutationIdRef.current = mutationId;
    const changeKey = pendingConfigChangeKey(session.sessionId, rawConfigId);
    if (isUnclaimed) {
      setPendingHomePromptStatus("Claim this shared workspace before changing session settings.");
      return;
    }
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPendingHomePromptStatus(readiness.message ?? "This workspace cannot accept cloud commands right now.");
      return;
    }
    setPendingConfigChanges((current) => ({
      ...current,
      [changeKey]: {
        sessionId: session.sessionId,
        rawConfigId,
        value,
        status: "sending",
        mutationId,
      },
    }));
    try {
      const commandWorkspace = await prepareManagedWorkspaceForCloudCommands({
        client,
        workspace,
        agentKind: session.sourceAgentKind ?? resolvedLaunchSelection.agentKind,
        modelId: sessionModelId,
        idempotencyKey: `web:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${mutationId}:target-config`,
        setLatestCommandId,
        onStatus: setPendingHomePromptStatus,
        shouldContinue: () => mountedRef.current,
      });
      const command = await enqueueConfig.mutateAsync({
        idempotencyKey: `web:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${value}:${mutationId}`,
        targetId: session.targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: commandWorkspace.id,
        sessionId: session.sessionId,
        kind: "update_session_config",
        source: "web",
        observedEventSeq: session.lastEventSeq ?? null,
        payload: { configId: rawConfigId, value },
      });
      if (!mountedRef.current) {
        return;
      }
      setLatestCommandId(command.commandId);
      setPendingConfigChanges((current) => {
        const existing = current[changeKey];
        if (!existing || existing.mutationId !== mutationId) {
          return current;
        }
        return {
          ...current,
          [changeKey]: { ...existing, commandId: command.commandId, status: "queued" },
        };
      });
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setPendingConfigChanges((current) => {
        const existing = current[changeKey];
        if (!existing || existing.mutationId !== mutationId) {
          return current;
        }
        const { [changeKey]: _removed, ...rest } = current;
        return rest;
      });
      setPendingHomePromptStatus(
        error instanceof Error ? error.message : "Session configuration could not be updated.",
      );
    }
  }

  async function claimCurrentWorkspace() {
    if (!workspace || claimWorkspace.isPending) {
      return;
    }
    setPendingHomePromptStatus("Claiming workspace.");
    try {
      await claimWorkspace.mutateAsync({ workspaceId: workspace.id });
      await workspaceQuery.refetch();
      setPendingHomePromptStatus("Workspace claimed.");
    } catch (error) {
      setPendingHomePromptStatus(
        error instanceof Error ? error.message : "Workspace could not be claimed.",
      );
    }
  }

  async function copyComposerFooterValue(value: string, label: string) {
    setPendingHomePromptStatus((current) => isCopyFeedbackStatus(current) ? null : current);
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      console.warn(`${label} could not be copied.`);
    }
  }

  function openNewSessionDraft(selection: CloudLaunchComposerSelection = resolvedLaunchSelection) {
    if (!workspace) {
      return;
    }
    if (!canStartNewSession) {
      setPendingHomePromptStatus(
        workspaceHarnessAvailability.message
          ?? "No cloud agent is ready to start a new session in this workspace.",
      );
      return;
    }
    if (pendingSessionDraft) {
      clearWebCloudSessionDraft(workspace.id, pendingSessionDraft.id);
    }
    const resolvedSelection = resolveCloudLaunchSelection({
      catalog: agentCatalog.data,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection,
    });
    const draft = createWebCloudSessionDraft({
      workspaceId: workspace.id,
      selection: resolvedSelection,
      sessionConfigUpdates: buildLaunchSessionConfigUpdates({
        catalog: agentCatalog.data,
        launchableAgentKinds: workspaceLaunchableAgentKinds,
        selection: resolvedSelection,
      }),
    });
    saveWebCloudSessionDraft(draft);
    setPendingSessionDraft(draft);
    setLaunchSelection(resolvedSelection);
    setPendingConfigChanges({});
    setPendingHomePromptStatus(null);
    navigate(`${routes.workspace(workspace.id)}${webCloudSessionDraftSearch(draft.id)}`);
  }

  if (!workspaceId) {
    return <MissingState title="Workspace not found" />;
  }

  if (workspaceQuery.isLoading && !snapshot) {
    return <MissingState title="Loading workspace" />;
  }

  if (workspaceQuery.error || !workspace) {
    return <MissingState title="Workspace not available" />;
  }

  const workspaceCommandability = recentWorkCommandability(workspace);
  const commandReadiness = cloudCommandReadiness(workspace);
  const workspaceCommandReady = workspaceStatus === "ready"
    && Boolean(workspace.targetId)
    && Boolean(workspace.anyharnessWorkspaceId)
    && commandReadiness.commandable;
  const promptSubmitting = enqueuePrompt.isPending || directPromptDispatching;
  const canSubmit = Boolean(
    draft.trim()
      && !promptSubmitting
      && !isUnclaimed
      && workspaceCommandReady
      && (session || canStartNewSession),
  );
  const repoLabel = `${workspace.repo.owner}/${workspace.repo.name}`;
  const defaultBranchName = workspace.repo.baseBranch ?? "main";
  const branchName = workspace.repo.branch ?? defaultBranchName;
  const workspaceDisplayName = workspace.displayName?.trim() ?? "";
  const workspaceTitle = workspaceDisplayName || branchName || repoLabel;
  const showBranchChip = !workspaceDisplayName || branchName !== defaultBranchName;
  const activeSessionLabel = session
    ? sessionOptionLabel(session)
    : "New session";
  const commandStatusMessage = commandStatus.data?.commandId === pendingPromptCommandId
    ? null
    : commandStatusMessageForNotice(commandStatus.data);
  const commandabilityLabel = workspaceCommandabilityLabel(workspaceCommandability);
  const commandMessage =
    visiblePendingHomePromptStatus ??
    commandStatusMessage ??
    (!session && workspaceCommandReady && !canStartNewSession
      ? workspaceHarnessAvailability.message
      : null) ??
    (!workspaceCommandReady
      ? friendlyCommandStatusMessage(commandReadiness.message)
        ?? commandReadiness.message
        ?? commandabilityLabel
      : null);
  const workspaceStatusNotice = commandMessage && !isUnclaimed
    ? workspaceNoticeForCommandMessage(commandMessage)
    : null;
  const transcriptSourceLabel = transcriptView.source === "events"
    ? "Event transcript"
    : transcriptView.source === "projection"
      ? "Projection fallback"
      : "No transcript";
  const runtimeLabel = workspaceRuntimeLabel(recentWorkRuntimeLocationForWorkspace(workspace));
  const cloudAccessLabel = workspaceCloudAccessLabel(recentWorkCloudAccessState(workspace));
  const claimFooterControl: CloudChatComposerFooterControlView | null = isUnclaimed
    ? {
      id: "claim",
      label: "Claim workspace",
      detail: "Shared",
      icon: "users",
      active: true,
      pending: claimWorkspace.isPending,
      title: "Claim this shared workspace",
      onClick: () => void claimCurrentWorkspace(),
    }
    : null;
  const composerFooterControls: CloudChatComposerFooterControlView[] = [
    ...(claimFooterControl ? [claimFooterControl] : []),
    {
      id: "copy-branch",
      label: branchName,
      detail: "Branch",
      icon: "branch",
      title: "Copy branch name",
      onClick: () => void copyComposerFooterValue(branchName, "Branch name"),
    },
    {
      id: "copy-repo",
      label: repoLabel,
      detail: "Repo",
      icon: "repo",
      title: "Copy repository name",
      onClick: () => void copyComposerFooterValue(repoLabel, "Repository"),
    },
  ];
  const emptyTitle = !session
    ? `Start the first session in ${workspaceTitle}`
    : sessionEventsQuery.isLoading && transcriptView.source === "empty"
      ? "Loading transcript"
      : "No transcript yet";

  return (
    <CloudChatSurface
      title={workspaceTitle}
      eyebrowItems={[
        runtimeLabel,
        cloudAccessLabel,
        commandabilityLabel,
      ]}
      chips={[
        ...(showBranchChip
          ? [{
            id: "branch",
            label: branchName,
            icon: "branch" as const,
          }]
          : []),
        {
          id: "repo",
          label: repoLabel,
        },
        ...(workspace.visibility !== "private"
          ? [{ id: "visibility", label: workspace.visibility }]
          : []),
        {
          id: "live",
          label: sessionLive.isConnected ? "Live stream" : "Snapshot",
        },
        {
          id: "source",
          label: transcriptSourceLabel,
        },
        ...(session
          ? [{
            id: "session",
            label: `Session: ${activeSessionLabel}`,
          }]
          : []),
      ]}
      transcriptRows={visibleTranscriptRows}
      emptyTitle={emptyTitle}
      emptyDescription={
        !session ? `Send a message below to start the first session in ${workspaceTitle}.` : undefined
      }
      commandMessage={null}
      primaryAction={isUnclaimed
        ? {
          label: "Claim",
          kind: "claim",
          loading: claimWorkspace.isPending,
          onClick: () => void claimCurrentWorkspace(),
        }
        : null}
      sessionSwitcher={{
        workspaceLabel: workspaceTitle,
        activeSessionId: session?.sessionId
          ?? (pendingSessionDraft ? webCloudSessionDraftOptionId(pendingSessionDraft.id) : null),
        activeSessionLabel,
        sessions: [
          ...(pendingSessionDraft
            ? [{
              id: webCloudSessionDraftOptionId(pendingSessionDraft.id),
              label: "New session",
              detail: pendingSessionDraft.selection.agentKind,
              statusLabel: "Draft",
            }]
            : []),
          ...sessions.map((candidate) => ({
            id: candidate.sessionId,
            label: sessionOptionLabel(candidate),
            detail: relativeSessionTime(candidate.lastEventAt ?? candidate.startedAt ?? null),
            statusLabel: sessionStatusLabel(candidate.status),
          })),
        ],
        newSessionLabel: "New session",
        onSelectSession: (sessionId: string) => {
          const draftId = webCloudSessionDraftIdFromOptionId(sessionId);
          if (draftId) {
            navigate(`${routes.workspace(workspace.id)}${webCloudSessionDraftSearch(draftId)}`);
            return;
          }
          navigate(routes.chat(workspace.id, sessionId));
        },
        onNewSession: () => openNewSessionDraft(),
      }}
      topNotice={isUnclaimed
        ? {
          title: "Unclaimed shared workspace.",
          description: "Claim this workspace before sending prompts or changing session settings.",
          action: {
            label: "Claim",
            kind: "claim",
            loading: claimWorkspace.isPending,
            onClick: () => void claimCurrentWorkspace(),
          },
        }
        : workspaceStatusNotice}
      desktopHref={desktopWorkspaceDeepLink(workspace.id)}
      composer={{
        value: draft,
        onChange: setDraft,
        onSubmit: () => void submitPrompt(),
        controls: composerControls,
        footerControls: composerFooterControls,
        disabled: !workspaceCommandReady || isUnclaimed || (!session && !canStartNewSession),
        canSubmit,
        isSubmitting: promptSubmitting,
        placeholder: isUnclaimed
          ? "Claim this shared workspace to reply"
          : session
            ? "Describe a task"
            : workspaceCommandReady
              ? canStartNewSession
                ? "Describe a task"
                : "No cloud agents ready"
              : workspaceCommandability === "stale"
                ? "Desktop or remote runtime is offline"
                : "Waiting for workspace",
      }}
      onBack={() => navigate(routes.workspaces)}
    />
  );
}

function MissingState({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex h-full items-center justify-center">
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <Button className="mt-4" onClick={() => navigate(routes.workspaces)}>
          Go to workspaces
        </Button>
      </div>
    </div>
  );
}

function compareSessions(left: CloudSessionProjection, right: CloudSessionProjection): number {
  return sessionRecencyMs(right) - sessionRecencyMs(left)
    || (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0);
}

function sessionRecencyMs(
  session: Pick<CloudSessionProjection, "lastEventAt" | "startedAt">,
): number {
  return Date.parse(session.lastEventAt ?? session.startedAt ?? "") || 0;
}

function findRecoverableSessionForPendingPrompt(
  sessions: readonly CloudSessionProjection[],
  prompt: PendingHomePrompt,
): CloudSessionProjection | null {
  if (Date.now() - prompt.createdAt > 30 * 60 * 1000) {
    return null;
  }
  const earliestStartMs = prompt.createdAt - 30_000;
  return sessions
    .filter((session) =>
      sessionStartedMs(session) >= earliestStartMs
      && (
        !prompt.agentKind
        || !session.sourceAgentKind
        || session.sourceAgentKind === prompt.agentKind
      )
    )
    .sort(compareSessions)[0] ?? null;
}

function sessionStartedMs(
  session: Pick<CloudSessionProjection, "lastEventAt" | "startedAt">,
): number {
  return Date.parse(session.startedAt ?? "") || Date.parse(session.lastEventAt ?? "") || 0;
}

function sessionDraftMatchesSelection(
  draft: WebCloudSessionDraft,
  selection: CloudLaunchComposerSelection,
  sessionConfigUpdates: WebCloudSessionDraft["sessionConfigUpdates"],
): boolean {
  return launchSelectionsEqual(draft.selection, selection)
    && JSON.stringify(draft.sessionConfigUpdates) === JSON.stringify(sessionConfigUpdates);
}

function launchSelectionsEqual(
  left: CloudLaunchComposerSelection,
  right: CloudLaunchComposerSelection,
): boolean {
  return left.agentKind === right.agentKind
    && left.modelId === right.modelId
    && left.modeId === right.modeId
    && JSON.stringify(left.controlValues) === JSON.stringify(right.controlValues);
}

function sessionOptionLabel(session: Pick<CloudSessionProjection, "sessionId" | "title">): string {
  return cleanSessionTitle(session.title) ?? `Session ${session.sessionId.slice(0, 8)}`;
}

function cleanSessionTitle(title: string | null | undefined): string | null {
  const value = title?.trim();
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (
    normalized === "invalid input"
    || normalized === "unclear input"
    || normalized === "stray keystroke"
    || normalized === "single character input"
  ) {
    return null;
  }
  return value;
}

function sessionStatusLabel(status: string): string {
  return status
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Session";
}

function friendlyCommandStatusMessage(message: string | null | undefined): string | null {
  if (!message) {
    return null;
  }
  if (isManagedCloudWorkerBaseUrlMessage(message)) {
    return "Cloud sandbox setup cannot reach this local dev server. Configure a public HTTPS tunnel for CLOUD_WORKER_BASE_URL, then retry the workspace.";
  }
  if (isManagedTargetConfigMessage(message)) {
    return "Workspace accepted. Preparing the selected runtime so this session can start.";
  }
  if (isCloudRuntimeProfileMessage(message)) {
    return "Workspace accepted. Preparing cloud runtime access for this target.";
  }
  return message;
}

function isWorkspacePreparationStatus(message: string | null | undefined): boolean {
  return friendlyCommandStatusMessage(message)?.startsWith("Workspace accepted.") ?? false;
}

function workspaceNoticeForCommandMessage(message: string) {
  if (message.startsWith("Workspace accepted.")) {
    return {
      title: "Workspace accepted.",
      description: "Preparing the selected runtime so this session can start.",
    };
  }
  if (message.startsWith("Cloud sandbox setup cannot reach")) {
    return {
      title: "Workspace setup failed.",
      description: message,
    };
  }
  return {
    title: "Workspace is not ready yet",
    description: message,
  };
}

function commandStatusMessageForNotice(
  command: CloudCommandResponse | undefined,
): string | null {
  if (!command) {
    return null;
  }
  const failureMessage = commandStatusFailureMessage(command, null);
  if (failureMessage) {
    return failureMessage;
  }
  switch (command.status) {
    case "queued":
      return "Loading...";
    case "leased":
      return "Cloud runtime is picking up the command.";
    case "delivered":
      return "Command delivered; waiting for runtime acknowledgement.";
    case "rejected":
    case "expired":
    case "superseded":
    case "failed_delivery":
      return promptCommandFailureMessage(command.status);
    case "accepted":
    case "accepted_but_queued":
    default:
      return null;
  }
}

function commandStatusFailureMessage(
  command: Pick<CloudCommandResponse, "errorCode" | "errorMessage" | "status">,
  fallback: string | null,
): string | null {
  const codeMessage = friendlyCommandErrorCodeMessage(command.errorCode);
  if (codeMessage) {
    return codeMessage;
  }
  const errorMessage = friendlyCommandStatusMessage(command.errorMessage);
  if (errorMessage) {
    return errorMessage;
  }
  return fallback;
}

function friendlyCommandErrorCodeMessage(code: string | null | undefined): string | null {
  switch (code) {
    case "cloud_command_exposure_not_active":
    case "cloud_exposure_not_active":
      return "Workspace access is no longer active. Refresh the workspace, then retry.";
    case "cloud_command_exposure_not_commandable":
    case "cloud_exposure_not_commandable":
      return "This workspace is read-only from Cloud right now.";
    case "cloud_command_workspace_not_found":
      return "Workspace no longer exists.";
    case "cloud_command_workspace_target_mismatch":
    case "cloud_command_agent_auth_target_mismatch":
      return "Workspace is attached to a different runtime target. Refresh the workspace, then retry.";
    case "cloud_command_cloud_workspace_required":
    case "cloud_workspace_required":
      return "Workspace accepted. Preparing the selected runtime so this session can start.";
    case "runtime_config_not_ready":
      return "Workspace accepted. Preparing cloud runtime access for this target.";
    case "web_command_queue_timeout":
    case "client_command_queue_timeout":
      return "Cloud runtime did not pick up the command in time. Check that the runtime is online, then retry.";
    case "sandbox_wake_blocked":
      return "Cloud runtime needs billing or quota attention before it can wake.";
    case "sandbox_wake_failed":
      return "Cloud runtime wake failed. Retry after the runtime is healthy.";
    case "sandbox_wake_timeout":
      return "Cloud runtime did not wake in time. Retry shortly.";
    case "quota_exceeded":
    case "cloud_repo_limit_reached":
      return "Cloud limit reached. Disable another cloud repo or upgrade before creating this workspace.";
    case "missing_supported_credentials":
    case "agent_auth_credentials_missing":
      return "Add credentials for the selected agent before starting this session.";
    default:
      return null;
  }
}

function workspaceFailureStatusMessage(
  workspace: { lastError?: string | null; statusDetail?: string | null },
): string | null {
  return friendlyCommandStatusMessage(workspace.lastError)
    ?? friendlyWorkspaceStatusDetailMessage(workspace.statusDetail)
    ?? null;
}

function friendlyWorkspaceStatusDetailMessage(message: string | null | undefined): string | null {
  const trimmed = message?.trim();
  if (!trimmed || /^ready$/i.test(trimmed) || /^synced from target\.?$/i.test(trimmed)) {
    return null;
  }
  return friendlyCommandStatusMessage(trimmed);
}

function isManagedCloudWorkerBaseUrlMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("cloud_worker_base_url")
    && normalized.includes("public url")
    && normalized.includes("reachable from the sandbox");
}

function isManagedTargetConfigMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("managed targets require")
    && normalized.includes("materialized target config");
}

function isCloudRuntimeProfileMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (normalized.includes("agent auth sandbox profile")
    || normalized.includes("runtime config sandbox profile"))
    && (normalized.includes("not attached")
      || normalized.includes("does not match")
      || normalized.includes("target mismatch")
      || normalized.includes("target_mismatch"));
}

function isCopyFeedbackStatus(message: string | null): boolean {
  const normalized = message?.trim().toLowerCase() ?? "";
  return normalized === "branch name copied."
    || normalized === "branch name could not be copied."
    || normalized === "repository copied."
    || normalized === "repository could not be copied.";
}

function relativeSessionTime(value: string | null): string | null {
  const timestamp = value ? Date.parse(value) : 0;
  if (!timestamp) {
    return null;
  }
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  if (elapsedMs < 60_000) {
    return "now";
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

function workspaceRuntimeLabel(runtime: ReturnType<typeof recentWorkRuntimeLocationForWorkspace>): string {
  switch (runtime) {
    case "local_desktop":
      return "Local Desktop runtime";
    case "cloud_sandbox":
      return "Cloud runtime";
    case "ssh_remote":
      return "SSH runtime";
    case "offline":
      return "Runtime offline";
    case "unknown":
      return "Runtime unknown";
  }
}

function workspaceCloudAccessLabel(
  state: ReturnType<typeof recentWorkCloudAccessState>,
): string {
  switch (state) {
    case "enabled":
      return "Cloud access enabled";
    case "not_enabled":
      return "Cloud access off";
    case "unknown":
      return "Cloud access unknown";
  }
}

function workspaceCommandabilityLabel(
  commandability: ReturnType<typeof recentWorkCommandability>,
): string {
  switch (commandability) {
    case "commandable":
      return "Commands ready";
    case "not_commandable":
      return "Commands unavailable";
    case "stale":
      return "Runtime offline";
    case "unknown":
      return "Command status unknown";
  }
}

function shouldSuppressWorkspaceSessionRedirect(state: unknown): boolean {
  return Boolean(
    state
      && typeof state === "object"
      && "startNewSession" in state
      && (state as { startNewSession?: unknown }).startNewSession === true,
  );
}

function effectiveWorkspaceStatus(
  workspace: { status?: string | null; workspaceStatus?: string | null },
): string | null {
  return workspace.workspaceStatus ?? workspace.status ?? null;
}

function mergeWorkspaceSnapshot(
  querySnapshot: CloudWorkspaceSnapshot | undefined,
  liveSnapshot: CloudWorkspaceSnapshot | undefined,
): CloudWorkspaceSnapshot | undefined {
  if (!querySnapshot) {
    return liveSnapshot;
  }
  if (!liveSnapshot) {
    return querySnapshot;
  }
  return {
    ...liveSnapshot,
    workspace: querySnapshot.workspace,
    sessions: mergeSessionProjections(querySnapshot.sessions, liveSnapshot.sessions),
  };
}

function mergeSessionProjections(
  querySessions: readonly CloudSessionProjection[],
  liveSessions: readonly CloudSessionProjection[],
): CloudSessionProjection[] {
  const merged = new Map<string, CloudSessionProjection>();
  for (const session of querySessions) {
    merged.set(session.sessionId, session);
  }
  for (const session of liveSessions) {
    merged.set(session.sessionId, session);
  }
  return [...merged.values()];
}

function buildOptimisticPromptRows(input: {
  prompts: readonly OptimisticPrompt[];
  workspaceId: string | null;
  sessionId: string | null;
  status: string | null;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  pendingInteractions: readonly CloudPendingInteraction[];
  allowTextOnlyRowFallback: boolean;
}): CloudChatTranscriptRowView[] {
  if (!input.workspaceId) {
    return [];
  }
  const rows: CloudChatTranscriptRowView[] = [];
  for (const prompt of input.prompts) {
    if (prompt.workspaceId !== input.workspaceId) {
      continue;
    }
    if (input.sessionId) {
      if (prompt.sessionId !== input.sessionId) {
        continue;
      }
    } else if (prompt.sessionId !== null) {
      continue;
    }
    if (pendingInteractionMatchesOptimisticPrompt(prompt, input.pendingInteractions)) {
      continue;
    }
    const promptVisible = input.sessionId
      ? cloudTranscriptHasUserPrompt({
        prompt,
        transcriptItems: input.transcriptItems,
        transcriptRows: input.transcriptRows,
        allowTextOnlyRowFallback: input.allowTextOnlyRowFallback,
      })
      : false;
    const agentStarted = input.sessionId
      ? cloudTranscriptHasAgentProgressAfterPrompt({
        prompt,
        transcriptItems: input.transcriptItems,
        transcriptRows: input.transcriptRows,
        allowTextOnlyRowFallback: input.allowTextOnlyRowFallback,
      })
      : false;
    const hasTranscriptProgressAfterPrompt = transcriptHasAgentProgressAfterBaseline(
      input.transcriptRows,
      prompt.baseTranscriptSeq,
    );
    if (!promptVisible) {
      rows.push({
        id: `${prompt.id}:user`,
        kind: "user",
        body: prompt.text,
        status: optimisticPromptStatusLabel(prompt.status),
      });
    }
    if (prompt.status === "sending" && !agentStarted && !hasTranscriptProgressAfterPrompt) {
      rows.push({
        id: `${prompt.id}:assistant-waiting`,
        kind: "assistant",
        body: null,
        detail: input.status ?? optimisticPromptStatusLabel(prompt.status),
        streaming: true,
      });
    } else if (prompt.status === "failed" && (input.status || prompt.errorMessage)) {
      rows.push({
        id: `${prompt.id}:assistant-error`,
        kind: "error",
        body: input.status ?? prompt.errorMessage ?? "Prompt could not be sent.",
      });
    }
  }
  return rows;
}

function transcriptHasAgentProgressAfterBaseline(
  rows: readonly CloudChatTranscriptRowView[],
  baseTranscriptSeq: number,
): boolean {
  return rows.some((row) =>
    row.kind !== "user"
    && row.kind !== "system"
    && typeof row.firstSeq === "number"
    && row.firstSeq > baseTranscriptSeq
  );
}

function buildPendingHomePromptRows(input: {
  pendingPrompt: PendingHomePrompt | null;
  workspaceId: string | null;
  sessionId: string | null;
  status: string | null;
  optimisticPrompts: readonly OptimisticPrompt[];
}): CloudChatTranscriptRowView[] {
  if (!input.pendingPrompt || !input.workspaceId || input.sessionId) {
    return [];
  }
  const duplicateOptimisticPrompt = input.optimisticPrompts.some((prompt) =>
    prompt.workspaceId === input.workspaceId
    && prompt.sessionId === null
    && textMatches(prompt.text, input.pendingPrompt!.text)
  );
  if (duplicateOptimisticPrompt) {
    return [];
  }
  const preparationStatus = isWorkspacePreparationStatus(
    input.status ?? input.pendingPrompt.errorMessage,
  );
  const failed = !preparationStatus
    && (input.pendingPrompt.status === "failed" || isFailureStatusText(input.status));
  const failureMessage = friendlyCommandStatusMessage(input.pendingPrompt.errorMessage)
    ?? input.status;
  const loading = preparationStatus;
  const rows: CloudChatTranscriptRowView[] = [
    {
      id: `${input.pendingPrompt.id}:user`,
      kind: "user",
      body: input.pendingPrompt.text,
      status: loading ? "Loading" : failed ? "Failed" : null,
    },
  ];
  if (loading || failed) {
    rows.push({
      id: `${input.pendingPrompt.id}:assistant-waiting`,
      kind: failed ? "error" : "assistant",
      body: failed ? failureMessage ?? "Prompt could not be sent." : null,
      detail: failed ? null : input.status ?? "Preparing cloud session.",
      streaming: !failed,
    });
  }
  return rows;
}

function latestPendingPromptCommandId(
  pendingInteractions: readonly CloudPendingInteraction[],
): string | null {
  return pendingPromptCommandIdsFromInteractions(pendingInteractions)[0] ?? null;
}

function pendingPromptCommandIdsFromInteractions(
  pendingInteractions: readonly CloudPendingInteraction[],
): string[] {
  return pendingInteractions
    .filter((interaction) =>
      interaction.kind === "send_prompt"
      && interaction.status === "pending"
    )
    .map((interaction) => ({
      commandId: pendingInteractionCommandId(interaction),
      requestedSeq: interaction.requestedSeq,
    }))
    .filter((candidate): candidate is { commandId: string; requestedSeq: number } =>
      candidate.commandId !== null
    )
    .sort((left, right) => right.requestedSeq - left.requestedSeq)
    .map((candidate) => candidate.commandId);
}

function optimisticPromptCommandIdsFromPrompts(
  prompts: readonly OptimisticPrompt[],
): string[] {
  return [...new Set(
    prompts
      .filter((prompt) => prompt.status !== "failed")
      .map((prompt) => prompt.commandId?.trim() ?? "")
      .filter((commandId) => commandId.length > 0),
  )];
}

function pendingConfigCommandIdsFromChanges(
  pendingConfigChanges: Record<string, PendingConfigChange>,
): string[] {
  return [...new Set(
    Object.values(pendingConfigChanges)
      .map((change) => change.commandId?.trim() ?? "")
      .filter((commandId) => commandId.length > 0),
  )];
}

function removePendingConfigCommand(
  pendingConfigChanges: Record<string, PendingConfigChange>,
  commandId: string,
): Record<string, PendingConfigChange> {
  const next = Object.fromEntries(
    Object.entries(pendingConfigChanges).filter(([_key, change]) =>
      change.commandId !== commandId
    ),
  );
  return Object.keys(next).length === Object.keys(pendingConfigChanges).length
    ? pendingConfigChanges
    : next;
}

function pendingInteractionCommandId(interaction: CloudPendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload) {
    return null;
  }
  const commandId = payload.commandId;
  return typeof commandId === "string" && commandId.trim() ? commandId.trim() : null;
}

function pendingInteractionMatchesOptimisticPrompt(
  prompt: OptimisticPrompt,
  pendingInteractions: readonly CloudPendingInteraction[],
): boolean {
  return pendingInteractions.some((interaction) =>
    interaction.kind === "send_prompt"
    && (interaction.status === "pending" || interaction.status === "failed")
    && (
      interaction.requestId === prompt.id
      || (
        prompt.commandId !== null
        && prompt.commandId !== undefined
        && pendingInteractionCommandId(interaction) === prompt.commandId
      )
    )
  );
}

function removeRetryReplacedFailedPrompts(
  prompts: readonly OptimisticPrompt[],
  replacement: OptimisticPrompt,
): OptimisticPrompt[] {
  return prompts.filter((prompt) =>
    prompt.status !== "failed"
    || prompt.workspaceId !== replacement.workspaceId
    || prompt.sessionId !== replacement.sessionId
    || !textMatches(prompt.text, replacement.text)
  );
}

function optimisticPromptStatusLabel(status: OptimisticPrompt["status"]): string | null {
  switch (status) {
    case "failed":
      return "Failed";
    case "queued":
      return null;
    case "sending":
    default:
      return "Loading";
  }
}

function isFailureStatusText(status: string | null): boolean {
  return /\b(failed|rejected|expired|superseded|timed out|could not)\b/i.test(status ?? "");
}

function textMatches(value: string | null | undefined, expected: string): boolean {
  return normalizePromptText(value) === normalizePromptText(expected);
}

function normalizePromptText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function isRejectedCommandStatus(status: CloudCommandStatus): boolean {
  return status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

function isTerminalCommandStatus(status: CloudCommandStatus): boolean {
  return status === "accepted"
    || status === "accepted_but_queued"
    || isRejectedCommandStatus(status);
}

function sessionConfigCommandFailureMessage(status: CloudCommandStatus): string {
  switch (status) {
    case "expired":
      return "Session configuration update expired before it was applied.";
    case "superseded":
      return "Session configuration update was superseded.";
    case "failed_delivery":
      return "Session configuration update could not be delivered.";
    case "rejected":
    default:
      return "Session configuration update was rejected.";
  }
}

function promptCommandFailureMessage(status: CloudCommandStatus): string {
  switch (status) {
    case "expired":
      return "Prompt expired before it was delivered.";
    case "superseded":
      return "Prompt was superseded before it was delivered.";
    case "failed_delivery":
      return "Prompt could not be delivered to the cloud runtime.";
    case "rejected":
    default:
      return "Prompt was rejected by the cloud runtime.";
  }
}

function workspaceStatusLabel(status: string | null): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "materializing":
    case "provisioning":
      return "Starting";
    case "error":
      return "Error";
    case "archived":
      return "Archived";
    default:
      return status ?? "Cloud";
  }
}
