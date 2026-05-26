import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  CloudCommandStatus,
  CloudPendingInteraction,
  CloudSessionEvent,
  CloudSessionProjection,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  useClaimCloudWorkspace,
  useCloudClient,
  useCloudSessionEvents,
  useCloudTranscriptSnapshot,
  useCloudWorkspaceSnapshot,
  useCommandStatus,
  useEnqueueCloudCommand,
  useSessionLive,
  useWorkspaceLive,
  invalidateCloudWorkspaceLists,
} from "@proliferate/cloud-sdk-react";
import {
  buildCloudChatComposerControls,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  getLiveConfigControlValue,
  pendingConfigChangeKey,
  readSessionLiveConfig,
  type CloudChatComposerControlView,
  type PendingConfigChange,
} from "@proliferate/product-model/chats/cloud/composer-controls";
import {
  buildCloudTranscriptView,
  cloudTranscriptHasAgentProgressAfterPrompt,
  cloudTranscriptHasUserPrompt,
  latestCloudTranscriptSeq,
  type CloudChatTranscriptRowView,
} from "@proliferate/product-model/chats/cloud/transcript-view";
import { cloudCommandReadiness } from "@proliferate/product-model/workspaces/cloud-work-inventory";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileStatusDot } from "../primitives/MobileStatusDot";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { MobileTopBar, MobileTopBarIconButton } from "../primitives/MobileTopBar";
import { MobileWorkspaceActionSheet } from "./MobileWorkspaceActionSheet";
import type {
  MobileCloudChat,
  MobilePendingPrompt,
} from "../../navigation/navigation-model";
import {
  clearPendingMobilePrompt,
  loadPendingMobilePrompt,
  savePendingMobilePrompt,
} from "../../lib/access/cloud/pending-mobile-prompt-store";
import {
  dispatchPendingMobilePrompt,
  ensureMobileWorkspaceReadyForCloudCommands,
  rearmRetryablePendingMobilePrompt,
  RetryablePendingPromptDispatchError,
  shouldRetryPendingMobilePromptFailure,
  type SendPromptPayload,
  type StartSessionPayload,
} from "../../lib/access/cloud/pending-mobile-prompt-dispatch";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileChatScreenProps {
  chat: MobileCloudChat;
  ownerUserId: string | null;
  onBack: () => void;
  onInitialPendingPromptConsumed?: () => void;
  onSessionSelected?: (sessionId: string) => void;
}

type OptimisticPromptStatus = "sending" | "queued" | "failed";

type OptimisticPrompt = {
  id: string;
  sessionId: string;
  text: string;
  baseTranscriptSeq: number;
  status: OptimisticPromptStatus;
  commandId?: string;
};

type UpdateSessionConfigPayload = {
  configId: string;
  value: string;
};

const EMPTY_TRANSCRIPT_ITEMS: CloudTranscriptItem[] = [];
const EMPTY_SESSION_EVENTS: CloudSessionEvent[] = [];
const EMPTY_PENDING_INTERACTIONS: CloudPendingInteraction[] = [];

export function MobileChatScreen({
  chat,
  ownerUserId,
  onBack,
  onInitialPendingPromptConsumed,
  onSessionSelected,
}: MobileChatScreenProps) {
  const queryClient = useQueryClient();
  const client = useCloudClient();
  const [draft, setDraft] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(chat.sessionId);
  const [draftModelId, setDraftModelId] = useState(DEFAULT_DIRECT_PROMPT_MODEL_ID);
  const [newSessionMode, setNewSessionMode] = useState(false);
  const [latestCommandId, setLatestCommandId] = useState<string | null>(null);
  const [latestConfigCommandId, setLatestConfigCommandId] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<MobilePendingPrompt | null>(null);
  const [pendingPromptStatus, setPendingPromptStatus] = useState<string | null>(null);
  const [pendingPromptFailed, setPendingPromptFailed] = useState(false);
  const [directPromptDispatching, setDirectPromptDispatching] = useState(false);
  const [optimisticPrompts, setOptimisticPrompts] = useState<OptimisticPrompt[]>([]);
  const [pendingConfigChanges, setPendingConfigChanges] = useState<
    Record<string, PendingConfigChange>
  >({});
  const [activeControl, setActiveControl] = useState<CloudChatComposerControlView | null>(null);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [claimedLocally, setClaimedLocally] = useState(false);
  const directPromptDispatchingRef = useRef(false);
  const sessionPromptDispatchingRef = useRef(false);
  const pendingDispatchRunRef = useRef<{ key: string; active: boolean } | null>(null);
  const pendingConfigMutationIdRef = useRef(0);

  const workspaceQuery = useCloudWorkspaceSnapshot(chat.workspaceId, true);
  const workspaceLive = useWorkspaceLive(chat.workspaceId, { enabled: true });
  const workspace = workspaceQuery.data?.workspace ?? workspaceLive.snapshot?.workspace ?? null;
  const sessions = useMemo(
    () => [...(workspaceLive.snapshot?.sessions ?? workspaceQuery.data?.sessions ?? [])].sort(compareSessions),
    [workspaceLive.snapshot?.sessions, workspaceQuery.data?.sessions],
  );
  const fallbackSession = useMemo(() => sessionProjectionFromChat(chat), [chat]);
  const selectedSession = selectedSessionId
    ? sessions.find((candidate) => candidate.sessionId === selectedSessionId)
      ?? (fallbackSession?.sessionId === selectedSessionId ? fallbackSession : null)
    : chat.sessionId
      ? sessions.find((candidate) => candidate.sessionId === chat.sessionId)
        ?? fallbackSession
        ?? sessions[0]
        ?? null
      : sessions[0] ?? null;
  const session = newSessionMode ? null : selectedSession;
  const activeSessionId = session?.sessionId ?? selectedSessionId;
  const targetId = session?.targetId ?? workspace?.targetId ?? chat.targetId;
  const workspaceStatus = workspace ? effectiveWorkspaceStatus(workspace) : chat.status;
  const sessionLive = useSessionLive(session?.sessionId ?? null, {
    targetId,
    enabled: Boolean(session && targetId),
  });
  const transcriptQuery = useCloudTranscriptSnapshot(
    targetId,
    session?.sessionId ?? null,
    Boolean(session && targetId),
  );
  const sessionEventsQuery = useCloudSessionEvents(
    targetId,
    session?.sessionId ?? null,
    Boolean(session && targetId),
  );
  const transcriptItems =
    sessionLive.snapshot?.transcriptItems
    ?? transcriptQuery.data?.transcriptItems
    ?? EMPTY_TRANSCRIPT_ITEMS;
  const pendingInteractions =
    sessionLive.snapshot?.pendingInteractions
    ?? transcriptQuery.data?.pendingInteractions
    ?? EMPTY_PENDING_INTERACTIONS;
  const pendingPromptCommandId = useMemo(
    () => latestPendingPromptCommandId(pendingInteractions),
    [pendingInteractions],
  );
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
  const enqueuePrompt = useEnqueueCloudCommand<SendPromptPayload>();
  const enqueueStartSession = useEnqueueCloudCommand<StartSessionPayload>();
  const enqueueConfig = useEnqueueCloudCommand<UpdateSessionConfigPayload>();
  const claimWorkspace = useClaimCloudWorkspace();
  const observedPromptCommandId = pendingPromptCommandId ?? latestCommandId;
  const commandStatus = useCommandStatus(observedPromptCommandId);
  const configCommandStatus = useCommandStatus(latestConfigCommandId);
  const liveConfig = readSessionLiveConfig(session);
  const composerControls = buildCloudChatComposerControls({
    session,
    liveConfig,
    pendingConfigChanges,
    launchModelId: draftModelId,
    onLaunchModelSelect: setDraftModelId,
    onSessionConfigSelect: (rawConfigId, value) => {
      void submitSessionConfig(rawConfigId, value);
    },
  });
  const hasActiveOptimisticPrompt = useMemo(
    () =>
      activeSessionId !== null &&
      optimisticPrompts.some((prompt) =>
        prompt.sessionId === activeSessionId && prompt.status !== "failed"
      ),
    [activeSessionId, optimisticPrompts],
  );
  const pendingPromptTranscriptState = useMemo(() => {
    if (
      !pendingPrompt?.dispatchedSessionId
      || activeSessionId !== pendingPrompt.dispatchedSessionId
    ) {
      return { agentStarted: false, promptVisible: false };
    }
    const prompt = optimisticPromptFromPending(pendingPrompt, pendingPrompt.dispatchedSessionId);
    return {
      agentStarted: cloudTranscriptHasAgentProgressAfterPrompt({
        prompt,
        transcriptItems,
        transcriptRows: transcriptView.rows,
      }),
      promptVisible: cloudTranscriptHasUserPrompt({
        prompt,
        transcriptItems,
        transcriptRows: transcriptView.rows,
      }),
    };
  }, [
    activeSessionId,
    pendingPrompt,
    transcriptItems,
    transcriptView.rows,
  ]);
  const pendingPromptDurable = pendingPromptTranscriptState.agentStarted;
  const visibleTranscriptRows = useMemo(
    () => [
      ...transcriptView.rows,
      ...buildPendingPromptRows(
        pendingPrompt,
        activeSessionId,
        pendingInteractions,
        pendingPromptFailed,
        pendingPromptStatus,
        pendingPromptTranscriptState.promptVisible,
        pendingPromptTranscriptState.agentStarted,
      ),
      ...buildOptimisticPromptRows({
        prompts: optimisticPrompts,
        sessionId: activeSessionId,
        transcriptItems,
        transcriptRows: transcriptView.rows,
        pendingInteractions,
        allowTextOnlyRowFallback: false,
      }),
    ],
    [
      activeSessionId,
      optimisticPrompts,
      pendingPrompt,
      pendingPromptFailed,
      pendingPromptStatus,
      pendingInteractions,
      pendingPromptTranscriptState.agentStarted,
      pendingPromptTranscriptState.promptVisible,
      transcriptItems,
      transcriptView.rows,
    ],
  );

  useEffect(() => {
    setSelectedSessionId(chat.sessionId);
    setDraft("");
    setNewSessionMode(false);
    setPendingPromptStatus(null);
    setPendingPromptFailed(false);
    setOptimisticPrompts([]);
    setPendingConfigChanges({});
    setLatestConfigCommandId(null);
    setClaimedLocally(false);
  }, [chat.workspaceId, chat.sessionId]);

  useEffect(() => {
    if (!ownerUserId) {
      setPendingPrompt(null);
      setPendingPromptFailed(false);
      return;
    }
    let active = true;
    void loadPendingMobilePrompt(chat.workspaceId, ownerUserId).then((stored) => {
      const initialPrompt = chat.initialPendingPrompt ?? null;
      const restoredRaw = stored ?? initialPrompt;
      const restored = restoredRaw ? rearmRetryablePendingMobilePrompt(restoredRaw) : null;
      if (active) {
        setPendingPrompt(restored);
        setPendingPromptFailed(Boolean(restored?.failedAt));
        setPendingPromptStatus(
          restoredRaw && restoredRaw !== restored
            ? "Retrying queued prompt handoff."
            : restored?.failureMessage ?? null,
        );
        if (restored?.dispatchedSessionId) {
          setSelectedSessionId(restored.dispatchedSessionId);
          setNewSessionMode(false);
          onSessionSelected?.(restored.dispatchedSessionId);
        } else if (restored) {
          setSelectedSessionId(null);
          setNewSessionMode(true);
        }
        if (restoredRaw && restored && restoredRaw !== restored && ownerUserId) {
          void savePendingMobilePrompt(chat.workspaceId, ownerUserId, restored);
        }
        if (initialPrompt) {
          if (stored) {
            onInitialPendingPromptConsumed?.();
          } else if (restored) {
            void savePendingMobilePrompt(chat.workspaceId, ownerUserId, restored)
              .then(() => {
                if (active) {
                  onInitialPendingPromptConsumed?.();
                }
              })
              .catch(() => undefined);
          }
        }
      }
    });
    return () => {
      active = false;
    };
  }, [
    chat.initialPendingPrompt,
    chat.workspaceId,
    onInitialPendingPromptConsumed,
    onSessionSelected,
    ownerUserId,
  ]);

  useEffect(() => {
    if (!workspace || workspaceStatus === "ready" || workspaceStatus === "error") {
      return;
    }
    const interval = setInterval(() => {
      void workspaceQuery.refetch();
    }, 2500);
    return () => {
      clearInterval(interval);
    };
  }, [workspace, workspaceStatus, workspaceQuery.refetch]);

  useEffect(() => {
    if (!session || !sessionLive.lastPatchAt) {
      return;
    }
    void transcriptQuery.refetch();
    void sessionEventsQuery.refetch();
  }, [
    session?.sessionId,
    sessionEventsQuery.refetch,
    sessionLive.lastPatchAt,
    transcriptQuery.refetch,
  ]);

  useEffect(() => {
    if (!pendingPrompt && !hasActiveOptimisticPrompt) {
      return;
    }
    const interval = setInterval(() => {
      void workspaceQuery.refetch();
      if (session && targetId) {
        void transcriptQuery.refetch();
        void sessionEventsQuery.refetch();
      }
    }, 2500);
    return () => {
      clearInterval(interval);
    };
  }, [
    hasActiveOptimisticPrompt,
    pendingPrompt,
    session?.sessionId,
    sessionEventsQuery.refetch,
    targetId,
    transcriptQuery.refetch,
    workspaceQuery.refetch,
  ]);

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
    const command = configCommandStatus.data;
    if (!command || !isRejectedCommandStatus(command.status)) {
      return;
    }
    if (
      !Object.values(pendingConfigChanges).some((change) =>
        change.commandId === command.commandId
      )
    ) {
      return;
    }
    setPendingConfigChanges((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([_key, change]) =>
          change.commandId !== command.commandId
        ),
      )
    );
    setPendingPromptStatus(command.errorMessage || sessionConfigCommandFailureMessage(command.status));
  }, [
    configCommandStatus.data?.commandId,
    configCommandStatus.data?.errorMessage,
    configCommandStatus.data?.status,
    pendingConfigChanges,
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
    setOptimisticPrompts((current) =>
      current.map((prompt) =>
        prompt.commandId === command.commandId && prompt.status !== "failed"
          ? { ...prompt, status: "failed" }
          : prompt
      ),
    );
    setPendingPromptStatus(command.errorMessage || promptCommandFailureMessage(command.status));
  }, [
    commandStatus.data?.commandId,
    commandStatus.data?.errorMessage,
    commandStatus.data?.status,
    optimisticPrompts,
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
    if (!pendingPrompt || !workspace || pendingPromptFailed) {
      return;
    }
    if (pendingPrompt.dispatchedSessionId) {
      return;
    }
    if (workspaceStatus === "error" || workspaceStatus === "archived") {
      const message = "Workspace creation failed before the prompt could be sent.";
      const failedPrompt = markPendingPromptFailed(pendingPrompt, message);
      setPendingPrompt(failedPrompt);
      setPendingPromptStatus(message);
      setPendingPromptFailed(true);
      if (ownerUserId) {
        void savePendingMobilePrompt(workspace.id, ownerUserId, failedPrompt);
      }
      return;
    }
    if (workspaceStatus !== "ready") {
      setPendingPromptStatus("Workspace is provisioning; the prompt will send when ready.");
      return;
    }
    if (!workspace.targetId || !workspace.anyharnessWorkspaceId) {
      setPendingPromptStatus(
        workspace.actionBlockReason || "Managed target configuration is still materializing.",
      );
      return;
    }

    const runKey = `${workspace.id}:${pendingPrompt.id}`;
    const currentRun = pendingDispatchRunRef.current;
    if (currentRun?.key === runKey && currentRun.active) {
      return;
    }

    const run = { key: runKey, active: true };
    pendingDispatchRunRef.current = run;
    const isCurrentRun = () => pendingDispatchRunRef.current === run && run.active;
    setPendingPromptStatus("Starting a session for the queued prompt.");
    setPendingPromptFailed(false);

    void dispatchPendingMobilePrompt({
      client,
      workspace,
      pendingPrompt,
      modelId: pendingPrompt.modelId,
      enqueueStartSession: enqueueStartSession.mutateAsync,
      enqueuePrompt: enqueuePrompt.mutateAsync,
      setLatestCommandId: (commandId) => {
        if (isCurrentRun()) {
          setLatestCommandId(commandId);
        }
      },
      onStatus: (status) => {
        if (isCurrentRun()) {
          setPendingPromptStatus(status);
        }
      },
      shouldContinue: isCurrentRun,
    })
      .then((sessionId) => {
        if (!isCurrentRun()) {
          return;
        }
        const dispatchedPrompt: MobilePendingPrompt = {
          ...pendingPrompt,
          dispatchedSessionId: sessionId,
          failedAt: null,
          failureMessage: null,
        };
        setNewSessionMode(false);
        setSelectedSessionId(sessionId);
        onSessionSelected?.(sessionId);
        setPendingPrompt(dispatchedPrompt);
        setPendingPromptStatus(null);
        setPendingPromptFailed(false);
        if (ownerUserId) {
          void savePendingMobilePrompt(workspace.id, ownerUserId, dispatchedPrompt);
        }
        void workspaceQuery.refetch();
        invalidateCloudWorkspaceLists(queryClient);
      })
      .catch((error: unknown) => {
        if (!isCurrentRun()) {
          return;
        }
        const message = error instanceof Error ? error.message : "Queued prompt could not be sent.";
        if (error instanceof RetryablePendingPromptDispatchError) {
          setPendingPromptStatus(message);
          if (shouldRetryPendingMobilePromptFailure(pendingPrompt)) {
            const retryingPrompt = rearmRetryablePendingMobilePrompt(pendingPrompt);
            setPendingPrompt(retryingPrompt);
            setPendingPromptFailed(false);
            if (ownerUserId) {
              void savePendingMobilePrompt(workspace.id, ownerUserId, retryingPrompt);
            }
          }
          setTimeout(() => {
            if (!run.active) {
              return;
            }
            setPendingPrompt((current) =>
              current?.id === pendingPrompt.id ? { ...current } : current
            );
          }, 2500);
          return;
        }
        const failedPrompt = markPendingPromptFailed(pendingPrompt, message);
        setPendingPrompt(failedPrompt);
        setPendingPromptStatus(message);
        setPendingPromptFailed(true);
        if (ownerUserId) {
          void savePendingMobilePrompt(workspace.id, ownerUserId, failedPrompt);
        }
      })
      .finally(() => {
        if (pendingDispatchRunRef.current === run) {
          pendingDispatchRunRef.current = null;
        }
      });

    return () => {
      run.active = false;
    };
  }, [
    client,
    enqueuePrompt.mutateAsync,
    enqueueStartSession.mutateAsync,
    ownerUserId,
    pendingPrompt,
    pendingPromptFailed,
    queryClient,
    workspace?.actionBlockReason,
    workspace?.anyharnessWorkspaceId,
    workspace?.id,
    workspace?.targetId,
    workspaceStatus,
    workspaceQuery.refetch,
  ]);

  useEffect(() => {
    if (
      !pendingPrompt?.dispatchedSessionId
      || !pendingPromptDurable
      || !ownerUserId
      || !workspace
    ) {
      return;
    }
    setPendingPrompt(null);
    setPendingPromptStatus(null);
    setPendingPromptFailed(false);
    void clearPendingMobilePrompt(workspace.id, ownerUserId);
    onInitialPendingPromptConsumed?.();
  }, [
    onInitialPendingPromptConsumed,
    ownerUserId,
    pendingPrompt?.dispatchedSessionId,
    pendingPromptDurable,
    workspace?.id,
  ]);

  async function submitPrompt() {
    const text = draft.trim();
    if (!text || !workspace) {
      return;
    }
    if (isUnclaimed) {
      setPendingPromptStatus("Claim this workspace before sending prompts from mobile.");
      return;
    }
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPendingPromptStatus(readiness.message ?? "This workspace cannot accept cloud commands right now.");
      return;
    }
    if (!session) {
      if (!ownerUserId) {
        setPendingPromptStatus("Account is still loading. Try again in a moment.");
        return;
      }
      if (directPromptDispatchingRef.current || (pendingPrompt && !pendingPromptFailed)) {
        return;
      }
      directPromptDispatchingRef.current = true;
      const prompt: MobilePendingPrompt = {
        id: `mobile-chat:${workspace.id}:${Date.now().toString(36)}`,
        text,
        modelId: draftModelId,
        modeId: null,
        createdAt: Date.now(),
      };
      setDraft("");
      setPendingPrompt(prompt);
      setPendingPromptStatus("Starting a session for this prompt.");
      setPendingPromptFailed(false);
      setDirectPromptDispatching(true);
      try {
        await savePendingMobilePrompt(workspace.id, ownerUserId, prompt);
      } catch (error) {
        setPendingPromptStatus(
          error instanceof Error
            ? `Prompt will send while this chat stays open. Storage failed: ${error.message}`
            : "Prompt will send while this chat stays open, but could not be saved.",
        );
      } finally {
        directPromptDispatchingRef.current = false;
        setDirectPromptDispatching(false);
      }
      return;
    }

    if (sessionPromptDispatchingRef.current || hasActiveOptimisticPrompt) {
      return;
    }
    sessionPromptDispatchingRef.current = true;
    const optimisticPrompt: OptimisticPrompt = {
      id: `mobile:${workspace.id}:${session.sessionId}:${Date.now()}`,
      sessionId: session.sessionId,
      text,
      baseTranscriptSeq: latestCloudTranscriptSeq(transcriptItems, transcriptView.rows),
      status: "sending",
    };
    setOptimisticPrompts((current) => [...current, optimisticPrompt]);
    setDraft("");
    setPendingPromptStatus(null);
    try {
      await ensureMobileWorkspaceReadyForCloudCommands({
        client,
        workspace,
        idempotencyKey: `${optimisticPrompt.id}:target-config`,
        setLatestCommandId,
        onStatus: setPendingPromptStatus,
        shouldContinue: () => sessionPromptDispatchingRef.current,
      });
      const command = await enqueuePrompt.mutateAsync({
        idempotencyKey: optimisticPrompt.id,
        targetId: session.targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: workspace.id,
        sessionId: session.sessionId,
        kind: "send_prompt",
        source: "mobile",
        payload: { text },
      });
      setLatestCommandId(command.commandId);
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id
            ? { ...prompt, commandId: command.commandId, status: "queued" }
            : prompt
        )
      );
      void transcriptQuery.refetch();
      void sessionEventsQuery.refetch();
    } catch (error) {
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id ? { ...prompt, status: "failed" } : prompt
        )
      );
      setPendingPromptStatus(error instanceof Error ? error.message : "Prompt could not be sent.");
    } finally {
      sessionPromptDispatchingRef.current = false;
    }
  }

  async function submitSessionConfig(rawConfigId: string, value: string) {
    if (!workspace || !session) {
      return;
    }
    if (isUnclaimed) {
      setPendingPromptStatus("Claim this workspace before changing session settings.");
      return;
    }
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPendingPromptStatus(readiness.message ?? "This workspace cannot accept cloud commands right now.");
      return;
    }
    const mutationId = pendingConfigMutationIdRef.current + 1;
    pendingConfigMutationIdRef.current = mutationId;
    const changeKey = pendingConfigChangeKey(session.sessionId, rawConfigId);
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
      await ensureMobileWorkspaceReadyForCloudCommands({
        client,
        workspace,
        idempotencyKey: `mobile:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${mutationId}:target-config`,
        setLatestCommandId,
        onStatus: setPendingPromptStatus,
        shouldContinue: () => true,
      });
      const command = await enqueueConfig.mutateAsync({
        idempotencyKey: `mobile:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${value}:${mutationId}`,
        targetId: session.targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: workspace.id,
        sessionId: session.sessionId,
        kind: "update_session_config",
        source: "mobile",
        observedEventSeq: session.lastEventSeq ?? null,
        payload: { configId: rawConfigId, value },
      });
      setLatestCommandId(command.commandId);
      setLatestConfigCommandId(command.commandId);
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
      setPendingConfigChanges((current) => {
        const { [changeKey]: _removed, ...rest } = current;
        return rest;
      });
      setPendingPromptStatus(
        error instanceof Error ? error.message : "Session configuration could not be updated.",
      );
    }
  }

  async function claimChat(): Promise<boolean> {
    if (!workspace) {
      return false;
    }
    try {
      await claimWorkspace.mutateAsync({ workspaceId: workspace.id });
      setClaimedLocally(true);
      setPendingPromptStatus(null);
      void workspaceQuery.refetch();
      invalidateCloudWorkspaceLists(queryClient);
      return true;
    } catch (error) {
      setPendingPromptStatus(error instanceof Error ? error.message : "Workspace could not be claimed.");
      return false;
    }
  }

  function startNewSession() {
    if (pendingDispatchRunRef.current) {
      pendingDispatchRunRef.current.active = false;
      pendingDispatchRunRef.current = null;
    }
    if (pendingPrompt) {
      setPendingPrompt(null);
      if (ownerUserId && workspace) {
        void clearPendingMobilePrompt(workspace.id, ownerUserId);
      }
    }
    setSelectedSessionId(null);
    setNewSessionMode(true);
    setDraft("");
    setPendingPromptStatus(null);
    setPendingPromptFailed(false);
    setSessionPickerOpen(false);
    setActionSheetOpen(false);
  }

  function selectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    setNewSessionMode(false);
    setDraft("");
    setPendingPromptStatus(null);
    setPendingPromptFailed(false);
    setSessionPickerOpen(false);
    setActionSheetOpen(false);
    onSessionSelected?.(sessionId);
  }

  const isUnclaimed = workspace?.visibility === "shared_unclaimed" && !claimedLocally;
  const commandReadiness = workspace ? cloudCommandReadiness(workspace) : null;
  const workspaceCommandReady =
    workspaceStatus === "ready"
    && Boolean(workspace?.targetId)
    && Boolean(workspace?.anyharnessWorkspaceId)
    && commandReadiness?.commandable === true;
  const promptSubmitting =
    enqueuePrompt.isPending
    || directPromptDispatching
    || (Boolean(pendingPrompt) && !pendingPromptFailed)
    || hasActiveOptimisticPrompt;
  const canSubmit = Boolean(
    draft.trim()
      && !isUnclaimed
      && !promptSubmitting
      && workspaceCommandReady,
  );
  const title = newSessionMode
    ? "New session"
    : session?.title ?? workspace?.displayName ?? chat.title;
  const subtitle = `${workspace?.displayName ?? chat.workspaceName} - ${workspace?.repo.owner ?? chat.repoLabel}`;
  const branchLabel = workspace?.repo.branch ?? workspace?.repo.baseBranch ?? chat.branchLabel;
  const commandMessage =
    pendingPromptStatus ??
    commandStatus.data?.errorMessage ??
    (commandStatus.data?.status ? `Command ${commandStatus.data.status}` : null) ??
    (!workspaceCommandReady && workspaceStatus === "ready" ? commandReadiness?.message ?? null : null);
  const emptyTitle = !session
    ? newSessionMode ? "New session" : "No active session yet."
    : sessionEventsQuery.isLoading && transcriptView.source === "empty"
      ? "Loading transcript"
      : "Waiting for the first projected transcript event.";
  const composerPlaceholder = isUnclaimed
    ? "Claim this workspace to reply"
    : session
      ? "Message this session"
      : workspaceCommandReady
        ? "Start a session with a message"
        : "Waiting for workspace";

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.select({ ios: "padding", default: undefined })}
      keyboardVerticalOffset={80}
    >
      <View style={styles.headerWrapper}>
        <MobileTopBar
          title={title}
          subtitle={subtitle}
          leading={{ kind: "back", onPress: onBack }}
          trailing={
            <View style={styles.headerStatus}>
              <MobileStatusDot status={mobileStatus(session?.status ?? workspaceStatus)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open sessions"
                onPress={() => setSessionPickerOpen(true)}
                style={({ pressed }) => [styles.sessionChip, pressed && styles.sessionChipPressed]}
              >
                <Text style={styles.sessionChipText} numberOfLines={1}>
                  {newSessionMode ? "New session" : session ? shortSessionLabel(session.sessionId) : "Sessions"}
                </Text>
              </Pressable>
              <MobileTopBarIconButton
                name="more"
                accessibilityLabel="Workspace actions"
                onPress={() => setActionSheetOpen(true)}
              />
            </View>
          }
        />
      </View>

      {isUnclaimed ? (
        <View style={styles.claimBanner}>
          <View style={styles.claimText}>
            <Text style={styles.claimTitle}>Unclaimed shared chat</Text>
            <Text style={styles.claimBody}>Claim this work before sending prompts from mobile.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Claim shared chat"
            accessibilityState={{ disabled: claimWorkspace.isPending }}
            disabled={claimWorkspace.isPending}
            onPress={() => void claimChat()}
            style={({ pressed }) => [
              styles.claimButton,
              claimWorkspace.isPending && styles.claimButtonDisabled,
              pressed && styles.claimButtonPressed,
            ]}
          >
            <Text style={styles.claimButtonText}>
              {claimWorkspace.isPending ? "Claiming" : "Claim"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        data={visibleTranscriptRows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageRow row={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptyBody}>
              {!session
                ? "Send a prompt below to start a projected session."
                : "Transcript projection will appear here."}
            </Text>
          </View>
        }
        ListFooterComponent={
          commandMessage ? (
            <View style={styles.controlNote}>
              <Text style={styles.controlNoteText}>{commandMessage}</Text>
            </View>
          ) : null
        }
      />

      <View style={styles.composer}>
        {composerControls.length > 0 ? (
          <View style={styles.controlRow}>
            {composerControls.map((control) => (
              <Pressable
                key={control.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: control.disabled }}
                disabled={control.disabled}
                onPress={() => setActiveControl(control)}
                style={({ pressed }) => [
                  styles.controlButton,
                  control.pendingState && styles.controlButtonPending,
                  control.disabled && styles.controlButtonDisabled,
                  pressed && styles.controlButtonPressed,
                ]}
              >
                <Text style={styles.controlButtonText} numberOfLines={1}>
                  {control.detail ?? control.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <MobileTextInput
            multiline
            value={draft}
            onChangeText={setDraft}
            placeholder={composerPlaceholder}
            style={styles.composerInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSubmit }}
            disabled={!canSubmit}
            onPress={() => void submitPrompt()}
            style={({ pressed }) => [
              styles.send,
              !canSubmit && styles.sendDisabled,
              pressed && styles.sendPressed,
            ]}
          >
            <MobileIcon name="send" size={16} color={canSubmit ? colors.background : colors.faint} />
          </Pressable>
        </View>
      </View>

      <SessionPickerSheet
        visible={sessionPickerOpen}
        sessions={sessions}
        activeSessionId={session?.sessionId ?? null}
        newSessionMode={newSessionMode}
        unclaimed={isUnclaimed}
        onSelectSession={selectSession}
        onStartNewSession={startNewSession}
        onClose={() => setSessionPickerOpen(false)}
      />
      <MobileWorkspaceActionSheet
        visible={actionSheetOpen}
        branchLabel={branchLabel}
        visibilityLabel={workspace?.visibility ?? chat.visibility}
        liveLabel={sessionLive.isConnected ? "Live" : "Snapshot"}
        transcriptLabel={transcriptView.source === "events" ? "Events" : transcriptView.source}
        unclaimed={isUnclaimed}
        claimPending={claimWorkspace.isPending}
        onClaim={claimChat}
        onNewSession={startNewSession}
        onOpenSessions={() => setSessionPickerOpen(true)}
        onShareBranch={() => void shareBranch(branchLabel)}
        onClose={() => setActionSheetOpen(false)}
      />
      <ControlSheet control={activeControl} onClose={() => setActiveControl(null)} />
    </KeyboardAvoidingView>
  );
}

function ControlSheet({
  control,
  onClose,
}: {
  control: CloudChatComposerControlView | null;
  onClose: () => void;
}) {
  return (
    <Modal visible={Boolean(control)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close control options"
          style={styles.sheetScrim}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{control?.label}</Text>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent}>
            {control?.groups.map((group) => (
              <View key={group.id} style={styles.sheetGroup}>
                {group.label ? <Text style={styles.sheetGroupLabel}>{group.label}</Text> : null}
                {group.options.map((option) => (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.selected, disabled: option.disabled }}
                    disabled={option.disabled}
                    onPress={() => {
                      control.onSelect?.(option.id);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.sheetOption,
                      option.selected && styles.sheetOptionSelected,
                      option.disabled && styles.sheetOptionDisabled,
                      pressed && styles.sheetOptionPressed,
                    ]}
                  >
                    <View style={styles.sheetOptionText}>
                      <Text style={styles.sheetOptionLabel}>{option.label}</Text>
                      {option.description ? (
                        <Text style={styles.sheetOptionDescription}>{option.description}</Text>
                      ) : null}
                    </View>
                    {option.selected ? <MobileIcon name="check" size={16} color={colors.success} /> : null}
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SessionPickerSheet({
  visible,
  sessions,
  activeSessionId,
  newSessionMode,
  unclaimed,
  onSelectSession,
  onStartNewSession,
  onClose,
}: {
  visible: boolean;
  sessions: readonly CloudSessionProjection[];
  activeSessionId: string | null;
  newSessionMode: boolean;
  unclaimed: boolean;
  onSelectSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sessions"
          style={styles.sheetScrim}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Workspace sessions</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: newSessionMode, disabled: unclaimed }}
            disabled={unclaimed}
            onPress={onStartNewSession}
            style={({ pressed }) => [
              styles.sheetOption,
              newSessionMode && styles.sheetOptionSelected,
              unclaimed && styles.sheetOptionDisabled,
              pressed && styles.sheetOptionPressed,
            ]}
          >
            <MobileIcon name="plus" size={16} color={colors.faint} />
            <View style={styles.sheetOptionText}>
              <Text style={styles.sheetOptionLabel}>New session</Text>
              <Text style={styles.sheetOptionDescription}>
                {unclaimed
                  ? "Claim this workspace before starting a session."
                  : "Start a separate chat in this workspace."}
              </Text>
            </View>
            {newSessionMode ? <MobileIcon name="check" size={16} color={colors.success} /> : null}
          </Pressable>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent}>
            <View style={styles.sheetGroup}>
              <Text style={styles.sheetGroupLabel}>Existing sessions</Text>
              {sessions.length === 0 ? (
                <Text style={styles.sheetEmptyText}>No projected sessions yet.</Text>
              ) : (
                sessions.map((candidate, index) => {
                  const selected = candidate.sessionId === activeSessionId && !newSessionMode;
                  return (
                    <Pressable
                      key={candidate.sessionId}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => onSelectSession(candidate.sessionId)}
                      style={({ pressed }) => [
                        styles.sheetOption,
                        selected && styles.sheetOptionSelected,
                        pressed && styles.sheetOptionPressed,
                      ]}
                    >
                      <MobileStatusDot status={mobileStatus(candidate.status)} />
                      <View style={styles.sheetOptionText}>
                        <Text style={styles.sheetOptionLabel} numberOfLines={1}>
                          {sessionDisplayTitle(candidate, index)}
                        </Text>
                        <Text style={styles.sheetOptionDescription} numberOfLines={1}>
                          {sessionDisplaySubtitle(candidate)}
                        </Text>
                      </View>
                      {selected ? <MobileIcon name="check" size={16} color={colors.success} /> : null}
                    </Pressable>
                  );
                })
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function MessageRow({ row }: { row: CloudChatTranscriptRowView }) {
  const isAssistant = row.kind === "assistant";
  const isSystem = row.kind === "system" || row.kind === "tool" || row.kind === "tool_group";
  const isUser = row.kind === "user";
  return (
    <View
      style={[
        styles.message,
        isAssistant && styles.messageAssistant,
        isSystem && styles.messageSystem,
        isUser && styles.messageUser,
      ]}
    >
      <View style={styles.messageHeader}>
        <Text style={styles.messageRole}>{messageLabel(row)}</Text>
        {row.status ? <Text style={styles.messageStatus}>{row.status}</Text> : null}
      </View>
      {row.title ? <Text style={styles.messageTitle}>{row.title}</Text> : null}
      {row.body ? <Text style={styles.messageBody}>{row.body}</Text> : null}
      {row.detail ? <Text style={styles.messageDetail}>{row.detail}</Text> : null}
      {row.streaming ? <Text style={styles.streamingText}>Working...</Text> : null}
    </View>
  );
}

function messageLabel(row: CloudChatTranscriptRowView): string {
  switch (row.kind) {
    case "assistant":
      return "assistant";
    case "user":
      return "you";
    case "thought":
      return "reasoning";
    case "tool":
    case "tool_group":
      return "tool";
    case "error":
      return "error";
    case "system":
    default:
      return "system";
  }
}

function buildPendingPromptRows(
  pendingPrompt: MobilePendingPrompt | null,
  sessionId: string | null,
  pendingInteractions: readonly CloudPendingInteraction[],
  failed: boolean,
  failureMessage: string | null,
  promptVisible: boolean,
  agentStarted: boolean,
): CloudChatTranscriptRowView[] {
  if (!pendingPrompt) {
    return [];
  }
  if (pendingInteractionMatchesPendingPrompt(pendingPrompt, pendingInteractions)) {
    return [];
  }
  if (pendingPrompt.dispatchedSessionId) {
    if (sessionId !== pendingPrompt.dispatchedSessionId || agentStarted) {
      return [];
    }
  } else if (sessionId) {
    return [];
  }
  const promptFailed = failed || Boolean(pendingPrompt.failedAt);
  const rows: CloudChatTranscriptRowView[] = [];
  if (!promptVisible) {
    rows.push({
      id: `${pendingPrompt.id}:pending-user`,
      kind: "user",
      body: pendingPrompt.text,
      status: promptFailed ? "Failed" : "Queued",
      streaming: !promptFailed,
    });
  }
  if (promptFailed || !agentStarted) {
    rows.push({
      id: `${pendingPrompt.id}:pending-assistant`,
      kind: "assistant",
      body: promptFailed
        ? pendingPrompt.failureMessage
          ?? failureMessage
          ?? "Queued prompt could not be sent."
        : pendingPrompt.dispatchedSessionId
          ? "Waiting for response..."
          : "Preparing workspace and session...",
      streaming: !promptFailed,
    });
  }
  return rows;
}

function buildOptimisticPromptRows(input: {
  prompts: readonly OptimisticPrompt[];
  sessionId: string | null;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  pendingInteractions: readonly CloudPendingInteraction[];
  allowTextOnlyRowFallback: boolean;
}): CloudChatTranscriptRowView[] {
  if (!input.sessionId) {
    return [];
  }
  const rows: CloudChatTranscriptRowView[] = [];
  for (const prompt of input.prompts) {
    if (prompt.sessionId !== input.sessionId) {
      continue;
    }
    if (pendingInteractionMatchesOptimisticPrompt(prompt, input.pendingInteractions)) {
      continue;
    }
    const promptVisible = cloudTranscriptHasUserPrompt({
      prompt,
      transcriptItems: input.transcriptItems,
      transcriptRows: input.transcriptRows,
      allowTextOnlyRowFallback: input.allowTextOnlyRowFallback,
    });
    const agentStarted = cloudTranscriptHasAgentProgressAfterPrompt({
      prompt,
      transcriptItems: input.transcriptItems,
      transcriptRows: input.transcriptRows,
      allowTextOnlyRowFallback: input.allowTextOnlyRowFallback,
    });
    if (!promptVisible) {
      rows.push({
        id: `${prompt.id}:user`,
        kind: "user",
        body: prompt.text,
        status: optimisticPromptStatusLabel(prompt.status),
        streaming: prompt.status !== "failed",
      });
    }
    if (prompt.status !== "failed" && !agentStarted) {
      rows.push({
        id: `${prompt.id}:assistant-waiting`,
        kind: "assistant",
        body: prompt.status === "sending" ? "Sending message..." : "Waiting for response...",
        streaming: true,
      });
    }
  }
  return rows;
}

function latestPendingPromptCommandId(
  pendingInteractions: readonly CloudPendingInteraction[],
): string | null {
  return [...pendingInteractions]
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
    .sort((left, right) => right.requestedSeq - left.requestedSeq)[0]?.commandId ?? null;
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

function pendingInteractionMatchesPendingPrompt(
  prompt: MobilePendingPrompt,
  pendingInteractions: readonly CloudPendingInteraction[],
): boolean {
  return pendingInteractions.some((interaction) =>
    interaction.kind === "send_prompt"
    && (interaction.status === "pending" || interaction.status === "failed")
    && (
      interaction.requestId === prompt.id
      || interaction.requestId === `${prompt.id}:send`
      || pendingInteractionPromptId(interaction) === prompt.id
    )
  );
}

function pendingInteractionCommandId(interaction: CloudPendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload) {
    return null;
  }
  const commandId = payload.commandId;
  return typeof commandId === "string" && commandId.trim() ? commandId.trim() : null;
}

function pendingInteractionPromptId(interaction: CloudPendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload) {
    return null;
  }
  const promptId = payload.promptId;
  return typeof promptId === "string" && promptId.trim() ? promptId.trim() : null;
}

function optimisticPromptStatusLabel(status: OptimisticPromptStatus): string {
  switch (status) {
    case "failed":
      return "Failed";
    case "queued":
      return "Queued";
    case "sending":
    default:
      return "Sending";
  }
}

function optimisticPromptFromPending(
  prompt: MobilePendingPrompt,
  sessionId: string,
): OptimisticPrompt {
  return {
    id: `${prompt.id}:pending`,
    sessionId,
    text: prompt.text,
    baseTranscriptSeq: 0,
    status: "queued",
  };
}

function sessionProjectionFromChat(chat: MobileCloudChat): CloudSessionProjection | null {
  if (!chat.sessionId || !chat.targetId) {
    return null;
  }
  return {
    targetId: chat.targetId,
    cloudWorkspaceId: chat.workspaceId,
    workspaceId: chat.workspaceRuntimeId,
    sessionId: chat.sessionId,
    nativeSessionId: null,
    sourceAgentKind: null,
    title: chat.title,
    status: chat.status,
    phase: null,
    liveConfig: null,
    lastEventSeq: 0,
    lastEventAt: null,
    startedAt: null,
    endedAt: null,
  };
}

function markPendingPromptFailed(
  prompt: MobilePendingPrompt,
  message: string,
): MobilePendingPrompt {
  return {
    ...prompt,
    failedAt: Date.now(),
    failureMessage: message,
  };
}

function compareSessions(left: CloudSessionProjection, right: CloudSessionProjection): number {
  return sessionRecencyMs(right) - sessionRecencyMs(left)
    || (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0);
}

function sessionRecencyMs(session: Pick<CloudSessionProjection, "lastEventAt" | "startedAt">): number {
  return Date.parse(session.lastEventAt ?? session.startedAt ?? "") || 0;
}

function sessionDisplayTitle(session: CloudSessionProjection, index: number): string {
  const title = session.title?.trim();
  if (title) {
    return title;
  }
  return `Session ${index + 1}`;
}

function sessionDisplaySubtitle(session: CloudSessionProjection): string {
  return `${session.status} · ${shortSessionLabel(session.sessionId)}`;
}

function shortSessionLabel(sessionId: string): string {
  return sessionId.slice(0, 8);
}

function effectiveWorkspaceStatus(
  workspace: { status?: string | null; workspaceStatus?: string | null },
): string {
  return workspace.workspaceStatus ?? workspace.status ?? "unknown";
}

function mobileStatus(status: string | null | undefined): "running" | "idle" | "paused" | "failed" | "done" {
  if (status === "running") {
    return "running";
  }
  if (status === "failed" || status === "error") {
    return "failed";
  }
  if (status === "paused") {
    return "paused";
  }
  if (status === "ended" || status === "done" || status === "completed") {
    return "done";
  }
  return "idle";
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
      return "Prompt could not be delivered.";
    case "rejected":
    default:
      return "Prompt was rejected.";
  }
}

async function shareBranch(branchLabel: string): Promise<void> {
  await Share.share({ message: branchLabel });
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerWrapper: {
    backgroundColor: colors.background,
  },
  headerStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingRight: spacing[1],
  },
  sessionChip: {
    maxWidth: 96,
    minHeight: 30,
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[2],
  },
  sessionChipPressed: {
    opacity: 0.72,
    backgroundColor: colors.accent,
  },
  sessionChipText: {
    color: colors.fg,
    fontSize: 11,
    fontWeight: "700",
  },
  list: {
    flex: 1,
  },
  content: {
    padding: spacing[4],
    paddingBottom: spacing[5],
    gap: spacing[3],
  },
  claimBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.successSubtle,
    backgroundColor: colors.successSubtle,
  },
  claimText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  claimTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
  },
  claimBody: {
    color: colors.mutedForeground,
    fontSize: 12.5,
    lineHeight: 17,
  },
  claimButton: {
    borderRadius: radius.md,
    backgroundColor: colors.success,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  claimButtonPressed: {
    opacity: 0.82,
  },
  claimButtonDisabled: {
    opacity: 0.56,
  },
  claimButtonText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: "700",
  },
  controlNote: {
    marginTop: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  controlNoteText: {
    color: colors.faint,
    fontSize: 12,
    fontStyle: "italic",
  },
  empty: {
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    borderStyle: "dashed",
  },
  emptyTitle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "600",
  },
  emptyBody: {
    marginTop: 4,
    color: colors.faint,
    fontSize: 13,
    lineHeight: 18,
  },
  message: {
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  messageAssistant: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  messageSystem: {
    backgroundColor: "transparent",
    borderColor: colors.borderLight,
    borderStyle: "dashed",
  },
  messageUser: {
    marginLeft: spacing[5],
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    marginBottom: 6,
  },
  messageRole: {
    color: colors.faint,
    fontSize: 10.5,
    fontWeight: "600",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  messageStatus: {
    color: colors.faint,
    fontSize: 10.5,
  },
  messageTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 5,
  },
  messageBody: {
    color: colors.fg,
    fontSize: 14.5,
    lineHeight: 21,
  },
  messageDetail: {
    marginTop: 6,
    color: colors.faint,
    fontSize: 12,
    lineHeight: 17,
  },
  streamingText: {
    marginTop: 8,
    color: colors.faint,
    fontSize: 12,
    fontStyle: "italic",
  },
  composer: {
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.background,
  },
  controlRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  controlButton: {
    minHeight: 30,
    maxWidth: 140,
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[2],
  },
  controlButtonPending: {
    borderColor: colors.info,
  },
  controlButtonDisabled: {
    opacity: 0.5,
  },
  controlButtonPressed: {
    opacity: 0.8,
  },
  controlButtonText: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 22,
  },
  send: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.fg,
  },
  sendDisabled: {
    backgroundColor: colors.accent,
  },
  sendPressed: {
    opacity: 0.85,
  },
  sheetLayer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayStrong,
  },
  sheet: {
    maxHeight: "72%",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing[4],
    gap: spacing[3],
  },
  sheetTitle: {
    color: colors.fg,
    fontSize: 16,
    fontWeight: "700",
  },
  sheetGroup: {
    gap: spacing[1],
  },
  sheetScroll: {
    minHeight: 0,
  },
  sheetScrollContent: {
    paddingBottom: spacing[1],
  },
  sheetGroupLabel: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  sheetOption: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  sheetOptionSelected: {
    backgroundColor: colors.accent,
  },
  sheetOptionDisabled: {
    opacity: 0.5,
  },
  sheetOptionPressed: {
    backgroundColor: colors.card,
  },
  sheetOptionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sheetOptionLabel: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
  },
  sheetOptionDescription: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 17,
  },
  sheetEmptyText: {
    color: colors.faint,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
});
