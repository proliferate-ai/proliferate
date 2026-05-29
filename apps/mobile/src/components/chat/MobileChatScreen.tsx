import { useEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { useQueryClient } from "@tanstack/react-query";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
  CloudWorkspaceDetail,
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
  useAgentAuthCredentials,
  useSessionLive,
  useWorkspaceLive,
  invalidateCloudWorkspaceLists,
} from "@proliferate/cloud-sdk-react";
import {
  buildCloudChatComposerControls,
  buildLaunchSessionConfigUpdates,
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  getLiveConfigControlValue,
  pendingConfigChangeKey,
  readSessionLiveConfig,
  resolveCloudLaunchSelection,
  type CloudChatComposerControlView,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import {
  readySyncedCloudAgentKinds,
  resolveCloudHarnessAvailability,
} from "@proliferate/product-domain/chats/cloud/harness-availability";
import {
  buildCloudTranscriptView,
  cloudTranscriptHasAgentProgressAfterPrompt,
  cloudTranscriptHasUserPrompt,
  latestCloudTranscriptSeq,
  type CloudChatTranscriptRowView,
} from "@proliferate/product-domain/chats/cloud/transcript-view";
import {
  cloudCommandReadiness,
  recentWorkRuntimeLabel,
  recentWorkRuntimeLocationForWorkspace,
  recentWorkSourceForWorkspace,
  recentWorkSourceLabel,
  type RecentWorkRuntimeLocation,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import { MobileStatusDot } from "../primitives/MobileStatusDot";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { MobileTopBar, MobileTopBarIconButton } from "../primitives/MobileTopBar";
import { MobileMarkdownText } from "./MobileMarkdownText";
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

type ResolveInteractionPayload = {
  requestId: string;
  resolution: {
    outcome: "selected";
    optionId: string;
  };
};

type PermissionInteractionOption = {
  optionId: string;
  label: string;
  kind: string;
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
  const agentCatalog = useCloudAgentCatalog();
  const cloudCapabilities = useCloudCapabilities();
  const agentAuthCredentials = useAgentAuthCredentials();
  const [draft, setDraft] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(chat.sessionId);
  const [launchSelection, setLaunchSelection] = useState<CloudLaunchComposerSelection>({
    agentKind: DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: DEFAULT_DIRECT_PROMPT_MODEL_ID,
    modeId: null,
    controlValues: {},
  });
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
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [actionSheetInitialExpandedId, setActionSheetInitialExpandedId] = useState<string | null>(null);
  const [toolDetailRow, setToolDetailRow] = useState<CloudChatTranscriptRowView | null>(null);
  const [permissionResolveError, setPermissionResolveError] = useState<string | null>(null);
  const [resolvingPermissionKey, setResolvingPermissionKey] = useState<string | null>(null);
  const [claimedLocally, setClaimedLocally] = useState(false);
  const directPromptDispatchingRef = useRef(false);
  const sessionPromptDispatchingRef = useRef(false);
  const pendingDispatchRunRef = useRef<{ key: string; active: boolean } | null>(null);
  const pendingConfigMutationIdRef = useRef(0);
  const autoOpenedPermissionIdsRef = useRef<Set<string>>(new Set());
  const dismissedPermissionIdsRef = useRef<Set<string>>(new Set());

  const workspaceQuery = useCloudWorkspaceSnapshot(chat.workspaceId, true);
  const workspaceLive = useWorkspaceLive(chat.workspaceId, { enabled: true });
  const workspace = workspaceQuery.data?.workspace ?? workspaceLive.snapshot?.workspace ?? null;
  const sessions = useMemo(
    () => [...(workspaceLive.snapshot?.sessions ?? workspaceQuery.data?.sessions ?? [])].sort(compareSessions),
    [workspaceLive.snapshot?.sessions, workspaceQuery.data?.sessions],
  );
  const fallbackSession = useMemo(() => sessionProjectionFromChat(chat), [chat]);
  const singleInferredSession = !chat.sessionId && sessions.length === 1 ? sessions[0] ?? null : null;
  const selectedSession = selectedSessionId
    ? sessions.find((candidate) => candidate.sessionId === selectedSessionId)
      ?? (fallbackSession?.sessionId === selectedSessionId ? fallbackSession : null)
    : chat.sessionId
      ? sessions.find((candidate) => candidate.sessionId === chat.sessionId)
        ?? fallbackSession
        ?? null
      : singleInferredSession;
  const session = newSessionMode ? null : selectedSession;
  const sessionChoiceRequired = !newSessionMode && !session && !chat.sessionId && sessions.length > 1;
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
  const pendingPermissionByRequestId = useMemo(
    () => new Map(
      pendingInteractions
        .filter((interaction) =>
          interaction.kind === "permission"
          && (interaction.status === "pending" || interaction.status === "failed")
        )
        .map((interaction) => [interaction.requestId, interaction]),
    ),
    [pendingInteractions],
  );
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
  const enqueueInteraction = useEnqueueCloudCommand<ResolveInteractionPayload>();
  const claimWorkspace = useClaimCloudWorkspace();
  const observedPromptCommandId = pendingPromptCommandId ?? latestCommandId;
  const commandStatus = useCommandStatus(observedPromptCommandId);
  const configCommandStatus = useCommandStatus(latestConfigCommandId);
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
  const sessionModelId = session && liveConfig ? getLiveConfigControlValue(liveConfig, "model") : null;
  const resolvedLaunchSelection = useMemo(
    () => resolveCloudLaunchSelection({
      catalog: agentCatalog.data,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection: launchSelection,
    }),
    [agentCatalog.data, launchSelection, workspaceLaunchableAgentKinds],
  );
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
      startNewSession({
        agentKind,
        modelId,
        modeId: null,
        controlValues: {},
      });
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
        status: pendingPromptStatus,
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
  const toolDetailPermission = toolDetailRow?.sourceRequestId
    ? pendingPermissionByRequestId.get(toolDetailRow.sourceRequestId) ?? null
    : null;
  const latestPendingPermission = useMemo(
    () => [...pendingPermissionByRequestId.values()]
      .sort((left, right) => right.requestedSeq - left.requestedSeq)[0] ?? null,
    [pendingPermissionByRequestId],
  );

  useEffect(() => {
    if (!toolDetailRow) {
      return;
    }
    const latestRow = visibleTranscriptRows.find((row) => row.id === toolDetailRow.id);
    if (!latestRow) {
      return;
    }
    setToolDetailRow(latestRow);
  }, [toolDetailRow?.id, visibleTranscriptRows]);

  useEffect(() => {
    const pendingIds = new Set(pendingPermissionByRequestId.keys());
    for (const requestId of autoOpenedPermissionIdsRef.current) {
      if (!pendingIds.has(requestId)) {
        autoOpenedPermissionIdsRef.current.delete(requestId);
      }
    }
    for (const requestId of dismissedPermissionIdsRef.current) {
      if (!pendingIds.has(requestId)) {
        dismissedPermissionIdsRef.current.delete(requestId);
      }
    }
    const openRequestId = toolDetailRow?.sourceRequestId ?? null;
    if (!openRequestId || pendingIds.has(openRequestId)) {
      return;
    }
    if (autoOpenedPermissionIdsRef.current.has(openRequestId)) {
      setPermissionResolveError(null);
      setToolDetailRow(null);
    }
  }, [pendingPermissionByRequestId, toolDetailRow?.sourceRequestId]);

  useEffect(() => {
    if (!latestPendingPermission) {
      return;
    }
    const requestId = latestPendingPermission.requestId;
    if (
      toolDetailRow?.sourceRequestId === requestId
      || dismissedPermissionIdsRef.current.has(requestId)
    ) {
      return;
    }
    const permissionRow = visibleTranscriptRows.find((row) =>
      row.sourceRequestId === requestId
      && (row.kind === "tool" || row.kind === "tool_group")
    );
    if (!permissionRow) {
      return;
    }
    autoOpenedPermissionIdsRef.current.add(requestId);
    setPermissionResolveError(null);
    setToolDetailRow(permissionRow);
  }, [
    latestPendingPermission?.requestId,
    toolDetailRow?.sourceRequestId,
    visibleTranscriptRows,
  ]);

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
    setToolDetailRow(null);
    setPermissionResolveError(null);
    setResolvingPermissionKey(null);
    autoOpenedPermissionIdsRef.current.clear();
    dismissedPermissionIdsRef.current.clear();
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
    if (!pendingPrompt || pendingPromptFailed || pendingPrompt.failedAt) {
      return;
    }
    const failedInteraction = failedPendingInteractionForPendingPrompt(
      pendingPrompt,
      pendingInteractions,
    );
    if (!failedInteraction) {
      return;
    }
    const message = failedPendingInteractionMessage(failedInteraction);
    const failedPrompt = markPendingPromptFailed(pendingPrompt, message);
    setPendingPrompt(failedPrompt);
    setPendingPromptStatus(message);
    setPendingPromptFailed(true);
    if (ownerUserId && workspace) {
      void savePendingMobilePrompt(workspace.id, ownerUserId, failedPrompt);
    }
  }, [
    ownerUserId,
    pendingInteractions,
    pendingPrompt,
    pendingPromptFailed,
    workspace?.id,
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
    if (pendingPrompt.dispatchedSessionId && pendingPromptDurable) {
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
    if (pendingPrompt.dispatchedSessionId && pendingPrompt.sendCommandId) {
      setNewSessionMode(false);
      setSelectedSessionId(pendingPrompt.dispatchedSessionId);
      onSessionSelected?.(pendingPrompt.dispatchedSessionId);
      setLatestCommandId(pendingPrompt.sendCommandId);
      setPendingPromptStatus("Queued prompt; waiting for transcript.");
      setPendingPromptFailed(false);
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
    let startedSessionId: string | null = pendingPrompt.dispatchedSessionId ?? null;
    let enqueuedSendCommandId: string | null = pendingPrompt.sendCommandId ?? null;
    setPendingPromptStatus("Starting a session for the queued prompt.");
    setPendingPromptFailed(false);

    void dispatchPendingMobilePrompt({
      client,
      workspace,
      pendingPrompt,
      modelId: pendingPrompt.modelId,
      enqueueStartSession: enqueueStartSession.mutateAsync,
      enqueueConfig: enqueueConfig.mutateAsync,
      enqueuePrompt: enqueuePrompt.mutateAsync,
      setLatestCommandId: (commandId) => {
        if (isCurrentRun()) {
          setLatestCommandId(commandId);
        }
      },
      onSessionStarted: (sessionId) => {
        if (!isCurrentRun()) {
          return;
        }
        startedSessionId = sessionId;
        const dispatchedPrompt: MobilePendingPrompt = {
          ...pendingPrompt,
          dispatchedSessionId: sessionId,
          failedAt: null,
          failureMessage: null,
        };
        setNewSessionMode(false);
        setSelectedSessionId(sessionId);
        onSessionSelected?.(sessionId);
        if (ownerUserId) {
          void savePendingMobilePrompt(workspace.id, ownerUserId, dispatchedPrompt);
        }
      },
      onPromptEnqueued: (commandId) => {
        if (!isCurrentRun() || !startedSessionId) {
          return;
        }
        enqueuedSendCommandId = commandId;
        const enqueuedPrompt: MobilePendingPrompt = {
          ...pendingPrompt,
          dispatchedSessionId: startedSessionId,
          sendCommandId: commandId,
          failedAt: null,
          failureMessage: null,
        };
        if (ownerUserId) {
          void savePendingMobilePrompt(workspace.id, ownerUserId, enqueuedPrompt);
        }
      },
      onStatus: (status) => {
        if (isCurrentRun()) {
          setPendingPromptStatus(status);
        }
      },
      shouldContinue: isCurrentRun,
    })
      .then((result) => {
        if (!isCurrentRun()) {
          return;
        }
        const dispatchedPrompt: MobilePendingPrompt = {
          ...pendingPrompt,
          dispatchedSessionId: result.sessionId,
          sendCommandId: result.sendCommandId,
          failedAt: null,
          failureMessage: null,
        };
        setNewSessionMode(false);
        setSelectedSessionId(result.sessionId);
        onSessionSelected?.(result.sessionId);
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
        const failedPrompt = markPendingPromptFailed(
          startedSessionId
            ? {
                ...pendingPrompt,
                dispatchedSessionId: startedSessionId,
                sendCommandId: enqueuedSendCommandId,
              }
            : pendingPrompt,
          message,
        );
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
    pendingPromptDurable,
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
      if (!canStartNewSession) {
        setPendingPromptStatus(
          workspaceHarnessAvailability.message ?? "No cloud agent is ready for a new session.",
        );
        return;
      }
      const promptSelection = resolveCloudLaunchSelection({
        catalog: agentCatalog.data,
        launchableAgentKinds: workspaceLaunchableAgentKinds,
        selection: resolvedLaunchSelection,
      });
      directPromptDispatchingRef.current = true;
      const prompt: MobilePendingPrompt = {
        id: `mobile-chat:${workspace.id}:${Date.now().toString(36)}`,
        text,
        agentKind: promptSelection.agentKind,
        modelId: promptSelection.modelId,
        modeId: promptSelection.modeId,
        sessionConfigUpdates: buildLaunchSessionConfigUpdates({
          catalog: agentCatalog.data,
          launchableAgentKinds: workspaceLaunchableAgentKinds,
          selection: promptSelection,
        }),
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
        agentKind: session.sourceAgentKind ?? resolveAgentKind(workspace),
        modelId: sessionModelId,
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
        payload: { text, promptId: optimisticPrompt.id },
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
        agentKind: session.sourceAgentKind ?? resolveAgentKind(workspace),
        modelId: sessionModelId,
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

  async function resolvePermissionInteraction(
    interaction: CloudPendingInteraction,
    option: PermissionInteractionOption,
  ) {
    if (!workspace || !session || !targetId) {
      setPermissionResolveError("Session is still loading. Try again in a moment.");
      return;
    }
    if (isUnclaimed) {
      setPermissionResolveError("Claim this workspace before approving commands from mobile.");
      return;
    }
    const readiness = cloudCommandReadiness(workspace);
    if (!readiness.commandable) {
      setPermissionResolveError(
        readiness.message ?? "This workspace cannot accept cloud commands right now.",
      );
      return;
    }
    const key = `${interaction.requestId}:${option.optionId}`;
    setResolvingPermissionKey(key);
    setPermissionResolveError(null);
    try {
      const command = await enqueueInteraction.mutateAsync({
        idempotencyKey: `mobile:${workspace.id}:${session.sessionId}:interaction:${interaction.requestId}:${option.optionId}:${Date.now()}`,
        targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: workspace.id,
        sessionId: session.sessionId,
        kind: "resolve_interaction",
        source: "mobile",
        observedEventSeq: session.lastEventSeq ?? null,
        payload: {
          requestId: interaction.requestId,
          resolution: {
            outcome: "selected",
            optionId: option.optionId,
          },
        },
      });
      setLatestCommandId(command.commandId);
      setPendingPromptStatus(null);
      setToolDetailRow(null);
      void transcriptQuery.refetch();
      void sessionEventsQuery.refetch();
      void workspaceQuery.refetch();
    } catch (error) {
      setPermissionResolveError(
        error instanceof Error ? error.message : "Permission response could not be sent.",
      );
    } finally {
      setResolvingPermissionKey((current) => current === key ? null : current);
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

  function startNewSession(selection?: CloudLaunchComposerSelection) {
    if (pendingDispatchRunRef.current) {
      pendingDispatchRunRef.current.active = false;
      pendingDispatchRunRef.current = null;
    }
    if (selection) {
      setLaunchSelection(selection);
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
    closeWorkspaceActionSheet();
  }

  function selectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    setNewSessionMode(false);
    setDraft("");
    setPendingPromptStatus(null);
    setPendingPromptFailed(false);
    closeWorkspaceActionSheet();
    onSessionSelected?.(sessionId);
  }

  function openWorkspaceActionSheet(expandedId: string | null = null) {
    setActionSheetInitialExpandedId(expandedId);
    setActionSheetOpen(true);
  }

  function closeWorkspaceActionSheet() {
    setActionSheetOpen(false);
    setActionSheetInitialExpandedId(null);
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
      && !sessionChoiceRequired
      && (session ? true : canStartNewSession)
      && workspaceCommandReady,
  );
  const title = newSessionMode
    ? "New session"
    : session?.title ?? workspace?.displayName ?? chat.title;
  const subtitle = workspace?.repo
    ? `${workspace.repo.owner}/${workspace.repo.name}`
    : chat.repoLabel;
  const runtimeContext = summarizeRuntimeContext(workspace, workspaceStatus);
  const sessionSwitchContext = summarizeSessionSwitchContext(
    sessions,
    session,
    newSessionMode,
    sessionChoiceRequired,
  );
  const branchLabel = workspace?.repo.branch ?? workspace?.repo.baseBranch ?? chat.branchLabel;
  const commandMessage =
    pendingPromptStatus ??
    commandStatus.data?.errorMessage ??
    (commandStatus.data?.status ? `Command ${commandStatus.data.status}` : null) ??
    (!session && !canStartNewSession ? workspaceHarnessAvailability.message : null) ??
    (!workspaceCommandReady && workspaceStatus === "ready" ? commandReadiness?.message ?? null : null);
  const commandMessageShownInTranscript = visibleTranscriptRows.some((row) =>
    isAssistantLoadingRow(row) && Boolean(loadingStatusText(row))
  );
  const footerCommandMessage =
    commandMessageShownInTranscript || isPromptProgressStatus(commandMessage)
      ? null
      : commandMessage;
  const emptyTitle = !session
    ? sessionChoiceRequired ? "Choose a session" : newSessionMode ? "New session" : "No active session yet."
    : sessionEventsQuery.isLoading && transcriptView.source === "empty"
      ? "Loading transcript"
      : "Waiting for the first projected transcript event.";
  const composerPlaceholder = isUnclaimed
    ? "Claim this workspace to reply"
    : sessionChoiceRequired
      ? "Choose a session or start a new one"
    : session
      ? "Message this session"
      : !canStartNewSession
        ? "Choose an available cloud agent"
      : workspaceCommandReady
        ? "Start a session with a message"
        : "Waiting for workspace";
  const composerControlSummary = summarizeComposerControls(composerControls);

  function openToolDetailRow(row: CloudChatTranscriptRowView) {
    if (row.sourceRequestId) {
      dismissedPermissionIdsRef.current.delete(row.sourceRequestId);
    }
    setPermissionResolveError(null);
    setToolDetailRow(row);
  }

  function closeToolDetailSheet() {
    if (toolDetailPermission?.requestId) {
      dismissedPermissionIdsRef.current.add(toolDetailPermission.requestId);
    }
    setPermissionResolveError(null);
    setToolDetailRow(null);
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.select({ ios: "padding", default: undefined })}
      keyboardVerticalOffset={0}
    >
      <View style={styles.headerWrapper}>
        <MobileTopBar
          title={title}
          subtitle={subtitle}
          leading={{ kind: "back", onPress: onBack }}
          trailing={
            <View style={styles.headerStatus}>
              <MobileStatusDot status={mobileStatus(session?.status ?? workspaceStatus)} />
              <MobileTopBarIconButton
                name="more"
                accessibilityLabel="Workspace actions"
                onPress={() => openWorkspaceActionSheet()}
              />
            </View>
          }
        />
        <View style={styles.contextBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open workspace actions. Running on ${runtimeContext.label}. ${runtimeContext.detail}.`}
            onPress={() => openWorkspaceActionSheet()}
            style={({ pressed }) => [
              styles.contextChip,
              styles.machineChip,
              pressed && styles.contextChipPressed,
            ]}
          >
            <View style={styles.contextIconSlot}>
              <MobileIcon name={runtimeContext.icon} size={15} color={colors.fg} />
            </View>
            <View style={styles.contextText}>
              <Text style={styles.contextLabel} numberOfLines={1}>
                {runtimeContext.label}
              </Text>
              <View style={styles.contextDetailRow}>
                <MobileStatusDot status={runtimeContext.status} size={6} />
                <Text style={styles.contextDetail} numberOfLines={1}>
                  {runtimeContext.detail}
                </Text>
              </View>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Switch session. ${sessionSwitchContext.label}. ${sessionSwitchContext.detail}.`}
            disabled={isUnclaimed}
            onPress={() => openWorkspaceActionSheet("sessions")}
            style={({ pressed }) => [
              styles.contextChip,
              styles.sessionsChip,
              isUnclaimed && styles.contextChipDisabled,
              pressed && !isUnclaimed && styles.contextChipPressed,
            ]}
          >
            <MobileIcon name="sessions" size={15} color={colors.fg} />
            <View style={styles.contextText}>
              <Text style={styles.contextLabel} numberOfLines={1}>
                {sessionSwitchContext.label}
              </Text>
              <Text style={styles.contextDetail} numberOfLines={1}>
                {sessionSwitchContext.detail}
              </Text>
            </View>
            <MobileIcon name="chevron-down" size={11} color={colors.faint} />
          </Pressable>
        </View>
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
        renderItem={({ item }) => (
          <MessageRow
            row={item}
            onToolPress={openToolDetailRow}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptyBody}>
              {!session
                ? sessionChoiceRequired
                  ? "Open the workspace menu to switch sessions or start a new one."
                  : "Send a prompt below to start a projected session."
                : "Transcript projection will appear here."}
            </Text>
          </View>
        }
        ListFooterComponent={
          footerCommandMessage ? (
            <View style={styles.controlNote}>
              <Text style={styles.controlNoteText}>{footerCommandMessage}</Text>
            </View>
          ) : null
        }
      />

      <View style={styles.composer}>
        <View style={styles.composerCard}>
          <MobileTextInput
            multiline
            value={draft}
            onChangeText={setDraft}
            placeholder={composerPlaceholder}
            style={styles.composerInput}
          />
          <View style={styles.composerFooter}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open chat settings"
              onPress={() => openWorkspaceActionSheet()}
              style={({ pressed }) => [
                styles.configPill,
                composerControlSummary.pending && styles.configPillPending,
                pressed && styles.configPillPressed,
              ]}
            >
              <MobileIcon
                name={composerControlSummary.icon}
                size={11}
                color={colors.faint}
              />
              <Text style={styles.configPillText} numberOfLines={1}>
                {composerControlSummary.label}
              </Text>
              <MobileIcon name="chevron-down" size={10} color={colors.faint} />
            </Pressable>
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
              <MobileIcon name="send" size={18} color={canSubmit ? colors.background : colors.faint} />
            </Pressable>
          </View>
        </View>
      </View>

      <MobileWorkspaceActionSheet
        visible={actionSheetOpen}
        initialExpandedId={actionSheetInitialExpandedId}
        branchLabel={branchLabel}
        unclaimed={isUnclaimed}
        claimPending={claimWorkspace.isPending}
        promptSubmitting={promptSubmitting}
        sessions={sessions}
        activeSessionId={session?.sessionId ?? null}
        newSessionMode={newSessionMode}
        composerControls={composerControls}
        onClaim={claimChat}
        onNewSession={startNewSession}
        onSelectSession={selectSession}
        onCopyBranch={() => void copyBranchToClipboard(branchLabel)}
        onClose={closeWorkspaceActionSheet}
      />
      <ToolDetailSheet
        row={toolDetailRow}
        pendingPermission={toolDetailPermission}
        resolvingPermissionKey={resolvingPermissionKey}
        permissionResolveError={permissionResolveError}
        onResolvePermission={(interaction, option) => {
          void resolvePermissionInteraction(interaction, option);
        }}
        onClose={closeToolDetailSheet}
      />
    </KeyboardAvoidingView>
  );
}

function MessageRow({
  row,
  onToolPress,
}: {
  row: CloudChatTranscriptRowView;
  onToolPress: (row: CloudChatTranscriptRowView) => void;
}) {
  if (isWorkHistoryRow(row)) {
    return <WorkHistoryRow row={row} onPress={() => onToolPress(row)} />;
  }
  if (row.kind === "tool" || row.kind === "tool_group") {
    return <ToolRow row={row} onPress={() => onToolPress(row)} />;
  }
  if (isAssistantLoadingRow(row)) {
    return <MobileAssistantLoadingRow row={row} />;
  }
  const isUser = row.kind === "user";
  const isSystem = row.kind === "system";
  if (isUser) {
    const visibleStatus = userMessageStatusLabel(row.status);
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          {row.body ? <Text style={styles.userBubbleText}>{row.body}</Text> : null}
          {visibleStatus ? (
            <Text style={styles.userBubbleStatus}>{visibleStatus}</Text>
          ) : null}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.assistantRow, isSystem && styles.systemRow]}>
      {row.title ? <Text style={styles.assistantTitle}>{row.title}</Text> : null}
      {row.body ? <MobileMarkdownText content={row.body} /> : null}
      {row.detail ? <Text style={styles.assistantDetail}>{row.detail}</Text> : null}
    </View>
  );
}

function MobileAssistantLoadingRow({ row }: { row: CloudChatTranscriptRowView }) {
  return (
    <View
      accessibilityLabel="Assistant response loading"
      accessibilityRole="progressbar"
      style={styles.assistantLoadingRow}
    >
      <Text style={styles.assistantLoadingText} numberOfLines={1}>
        {loadingStatusLabel(row)}
      </Text>
    </View>
  );
}

function WorkHistoryRow({
  row,
  onPress,
}: {
  row: CloudChatTranscriptRowView;
  onPress: () => void;
}) {
  const summary = workHistorySummary(row);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open work history: ${summary}`}
      onPress={onPress}
      style={({ pressed }) => [styles.historyRow, pressed && styles.historyRowPressed]}
    >
      <View style={styles.historyIcon}>
        <MobileIcon name="terminal" size={15} color={colors.faint} />
      </View>
      <View style={styles.historyTextCluster}>
        <Text style={styles.historySummary} numberOfLines={1}>
          {summary}
        </Text>
        <MobileIcon name="chevron-right" size={16} color={colors.faint} />
      </View>
    </Pressable>
  );
}

function ToolRow({ row, onPress }: { row: CloudChatTranscriptRowView; onPress: () => void }) {
  const title = row.title ?? row.body ?? "Tool call";
  const summary = toolSummary(row);
  const visibleSummary = summary === "Tap for details" ? null : summary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.title ? `Open ${row.title}` : "Open tool details"}
      onPress={onPress}
      style={({ pressed }) => [styles.toolCard, pressed && styles.toolCardPressed]}
    >
      <View style={styles.toolIcon}>
        <MobileIcon name="terminal" size={15} color={colors.faint} />
      </View>
      <View style={styles.toolText}>
        <Text style={styles.toolTitle} numberOfLines={1}>{title}</Text>
        {visibleSummary ? (
          <Text style={styles.toolSubtitle} numberOfLines={1}>{visibleSummary}</Text>
        ) : null}
        <MobileIcon name="chevron-right" size={16} color={colors.faint} />
      </View>
    </Pressable>
  );
}

function ToolDetailSheet({
  row,
  pendingPermission,
  resolvingPermissionKey,
  permissionResolveError,
  onResolvePermission,
  onClose,
}: {
  row: CloudChatTranscriptRowView | null;
  pendingPermission: CloudPendingInteraction | null;
  resolvingPermissionKey: string | null;
  permissionResolveError: string | null;
  onResolvePermission: (
    interaction: CloudPendingInteraction,
    option: PermissionInteractionOption,
  ) => void;
  onClose: () => void;
}) {
  const permissionOptions = pendingPermission
    ? permissionInteractionOptions(pendingPermission)
    : [];
  return (
    <Modal visible={Boolean(row)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.toolSheetLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close tool details"
          style={styles.toolSheetScrim}
          onPress={onClose}
        />
        <View style={styles.toolSheet}>
          <View style={styles.toolSheetHeader}>
            <Text style={styles.toolSheetTitle} numberOfLines={1}>
              {row && isWorkHistoryRow(row)
                ? workHistorySummary(row)
                : row?.title ?? "Tool call"}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => [styles.toolSheetClose, pressed && styles.sendPressed]}
            >
              <MobileIcon name="close" size={17} color={colors.fg} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.toolSheetScroll}
            contentContainerStyle={styles.toolSheetContent}
          >
            {row?.status ? <Text style={styles.toolSheetMeta}>{row.status}</Text> : null}
            {row?.body ? <Text style={styles.toolSheetBody}>{row.body}</Text> : null}
            {row?.detail && !isWorkHistoryRow(row) ? (
              <Text style={styles.toolSheetDetail}>{row.detail}</Text>
            ) : null}
            {pendingPermission ? (
              <View style={styles.permissionBox}>
                <Text style={styles.permissionTitle}>Command approval</Text>
                <Text style={styles.permissionBody}>
                  Choose how to handle this request so the session can continue.
                </Text>
                <View style={styles.permissionActions}>
                  {permissionOptions.map((option) => {
                    const key = `${pendingPermission.requestId}:${option.optionId}`;
                    const resolving = resolvingPermissionKey === key;
                    const reject = option.kind.startsWith("reject");
                    return (
                      <Pressable
                        key={option.optionId}
                        accessibilityRole="button"
                        accessibilityLabel={option.label}
                        accessibilityState={{ disabled: Boolean(resolvingPermissionKey) }}
                        disabled={Boolean(resolvingPermissionKey)}
                        onPress={() => onResolvePermission(pendingPermission, option)}
                        style={({ pressed }) => [
                          styles.permissionButton,
                          reject ? styles.permissionRejectButton : styles.permissionAllowButton,
                          pressed && styles.permissionButtonPressed,
                          Boolean(resolvingPermissionKey) && styles.permissionButtonDisabled,
                        ]}
                      >
                        <Text
                          style={[
                            styles.permissionButtonText,
                            reject && styles.permissionRejectButtonText,
                          ]}
                        >
                          {resolving ? "Sending" : option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {permissionResolveError ? (
                  <Text style={styles.permissionError}>{permissionResolveError}</Text>
                ) : null}
              </View>
            ) : null}
            {row?.children?.length ? (
              <View style={styles.toolChildren}>
                {row.children.map((child) => (
                  <View key={child.id} style={styles.toolChild}>
                    <Text style={styles.toolChildTitle}>{child.title ?? messageLabel(child)}</Text>
                    {child.body ? <Text style={styles.toolChildBody}>{child.body}</Text> : null}
                    {child.detail ? <Text style={styles.toolChildDetail}>{child.detail}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function permissionInteractionOptions(
  interaction: CloudPendingInteraction,
): PermissionInteractionOption[] {
  const payload = interaction.payload;
  const event = isRecord(payload?.event) ? payload.event : null;
  const eventPayload = event && isRecord(event.payload) ? event.payload : null;
  const rawOptions = Array.isArray(eventPayload?.options) ? eventPayload.options : [];
  const options = rawOptions
    .filter(isRecord)
    .map((option) => {
      const optionId = readNonEmptyString(option.optionId);
      const label = readNonEmptyString(option.label);
      const kind = readNonEmptyString(option.kind);
      return optionId && label && kind ? { optionId, label, kind } : null;
    })
    .filter((option): option is PermissionInteractionOption => option !== null);
  if (options.length > 0) {
    return options;
  }
  return [
    { optionId: "allow", label: "Allow", kind: "allow_once" },
    { optionId: "reject", label: "Reject", kind: "reject_once" },
  ];
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toolSummary(row: CloudChatTranscriptRowView): string {
  if (isWorkHistoryRow(row)) {
    return workHistorySummary(row);
  }
  const count = row.children?.length ?? 0;
  if (count > 0) {
    return `${count} ${count === 1 ? "tool call" : "tool calls"}${row.status ? ` · ${row.status}` : ""}`;
  }
  return row.status ?? row.detail ?? "Tap for details";
}

function isWorkHistoryRow(row: CloudChatTranscriptRowView): boolean {
  return row.kind === "system" && (row.title ?? "").toLowerCase() === "work history";
}

function workHistorySummary(row: CloudChatTranscriptRowView): string {
  const detailFragments = (row.detail ?? "")
    .split(",")
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment && !/\btool calls?\b/i.test(fragment));
  const actionFragments = (row.children ?? [])
    .filter((child) => child.kind === "tool_group" && child.title)
    .map((child) => pastTenseActionSummary(child.title ?? ""))
    .filter((value): value is string => Boolean(value));
  const fragments = [...detailFragments, ...actionFragments];
  if (fragments.length > 0) {
    return sentenceCase(fragments.join(", "));
  }
  return row.detail ?? row.body ?? "Work history";
}

function pastTenseActionSummary(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed
    .replace(/^Running\b/, "ran")
    .replace(/\brunning\b/g, "ran")
    .replace(/^Explored\b/, "explored")
    .replace(/^Edited\b/, "edited")
    .replace(/^Worked\b/, "worked");
}

function sentenceCase(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function isAssistantLoadingRow(row: CloudChatTranscriptRowView): boolean {
  return row.kind === "assistant"
    && Boolean(row.streaming)
    && (
      !row.body?.trim()
      || row.id.includes(":assistant-waiting")
      || row.id.includes(":pending-assistant")
    );
}

function loadingStatusText(row: CloudChatTranscriptRowView): string | null {
  const value = row.detail ?? row.body ?? row.status ?? null;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function loadingStatusLabel(row: CloudChatTranscriptRowView): string {
  const status = loadingStatusText(row) ?? "Loading";
  return `${status.replace(/[\s.]+$/g, "")}...`;
}

function isPromptProgressStatus(message: string | null): boolean {
  return /^(preparing|starting|sending|waiting|queued|using selected cloud agent credential|workspace is provisioning|command (queued|leased|accepted|delivered))/i
    .test(message ?? "");
}

function userMessageStatusLabel(status: string | null | undefined): string | null {
  const value = status?.trim();
  if (!value) {
    return null;
  }
  return /\b(failed|error|rejected|expired|could not|timed out)\b/i.test(value)
    ? value
    : null;
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
        : null,
      detail: promptFailed
        ? null
        : failureMessage ?? (
          pendingPrompt.dispatchedSessionId
            ? "Waiting for response."
            : "Preparing workspace and session."
        ),
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
  status: string | null;
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
        streaming: prompt.status !== "failed",
      });
    }
    if (prompt.status !== "failed" && !agentStarted && !hasTranscriptProgressAfterPrompt) {
      rows.push({
        id: `${prompt.id}:assistant-waiting`,
        kind: "assistant",
        body: null,
        detail: input.status ?? (prompt.status === "sending" ? "Sending message." : "Waiting for response."),
        streaming: true,
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
    && pendingInteractionMatchesPendingPromptIdentity(prompt, interaction)
  );
}

function failedPendingInteractionForPendingPrompt(
  prompt: MobilePendingPrompt,
  pendingInteractions: readonly CloudPendingInteraction[],
): CloudPendingInteraction | null {
  return pendingInteractions.find((interaction) =>
    interaction.kind === "send_prompt"
    && interaction.status === "failed"
    && pendingInteractionMatchesPendingPromptIdentity(prompt, interaction)
  ) ?? null;
}

function pendingInteractionMatchesPendingPromptIdentity(
  prompt: MobilePendingPrompt,
  interaction: CloudPendingInteraction,
): boolean {
  return interaction.requestId === prompt.id
    || interaction.requestId === `${prompt.id}:send`
    || pendingInteractionPromptId(interaction) === prompt.id;
}

function failedPendingInteractionMessage(interaction: CloudPendingInteraction): string {
  const payloadMessage = interaction.payload?.errorMessage;
  return interaction.description
    || (typeof payloadMessage === "string" && payloadMessage.trim()
      ? payloadMessage.trim()
      : null)
    || "Queued prompt could not be sent.";
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
    pendingInteractionCount: 0,
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

type RuntimeContextView = {
  label: string;
  detail: string;
  icon: MobileIconName;
  status: "running" | "idle" | "paused" | "failed" | "done";
};

function summarizeRuntimeContext(
  workspace: CloudWorkspaceDetail | null,
  workspaceStatus: string,
): RuntimeContextView {
  if (!workspace) {
    return {
      label: "Runtime",
      detail: "Loading machine",
      icon: "cloud",
      status: "idle",
    };
  }

  const runtimeLocation = recentWorkRuntimeLocationForWorkspace(workspace);
  const runtimeLabel = workspace.executionTarget?.label?.trim()
    || fallbackRuntimeLabel(workspace, runtimeLocation);
  const sourceDetail = runtimeSourceDetail(workspace);
  const statusDetail = runtimeStatusDetail(workspace, workspaceStatus);
  const detail = joinUniqueLabels([sourceDetail, statusDetail]) || "Runtime status unknown";

  return {
    label: runtimeLabel,
    detail,
    icon: runtimeIcon(workspace, runtimeLocation),
    status: runtimeDotStatus(workspace, workspaceStatus),
  };
}

function fallbackRuntimeLabel(
  workspace: CloudWorkspaceDetail,
  runtimeLocation: RecentWorkRuntimeLocation,
): string {
  switch (workspace.executionTarget?.kind) {
    case "managed_cloud":
      return "Cloud runtime";
    case "local_desktop":
      return "Desktop dispatch";
    case "ssh":
      return "SSH remote";
    case "self_hosted":
      return "Self-hosted runner";
    default:
      return recentWorkRuntimeLabel(runtimeLocation);
  }
}

function runtimeSourceDetail(workspace: CloudWorkspaceDetail): string | null {
  const sourceKind = recentWorkSourceForWorkspace(workspace);
  if (sourceKind === "cloud_sandbox" || sourceKind === "unknown") {
    return null;
  }
  if (sourceKind === "mobile") {
    return "Mobile dispatch";
  }
  if (sourceKind === "desktop_exposed") {
    return "Desktop dispatch";
  }
  if (sourceKind === "web") {
    return "Web dispatch";
  }
  return recentWorkSourceLabel(sourceKind);
}

function runtimeStatusDetail(workspace: CloudWorkspaceDetail, workspaceStatus: string): string {
  switch (workspace.runtime?.status) {
    case "running":
      return "Running";
    case "provisioning":
    case "pending":
      return "Starting";
    case "paused":
      return "Paused";
    case "error":
      return "Error";
    case "disabled":
      return "Disabled";
    case undefined:
      break;
  }
  if (workspace.executionTarget?.online === true) {
    return "Online";
  }
  if (workspace.executionTarget?.online === false) {
    return "Offline";
  }
  switch (workspaceStatus) {
    case "ready":
      return "Ready";
    case "materializing":
    case "needs_rematerialization":
      return "Setting up";
    case "pending":
      return "Pending";
    case "error":
      return "Error";
    default:
      return "Status unknown";
  }
}

function runtimeIcon(
  workspace: CloudWorkspaceDetail,
  runtimeLocation: RecentWorkRuntimeLocation,
): MobileIconName {
  switch (workspace.executionTarget?.kind) {
    case "managed_cloud":
      return "cloud";
    case "local_desktop":
      return "monitor";
    case "ssh":
    case "self_hosted":
      return "terminal";
    case undefined:
      break;
  }
  switch (runtimeLocation) {
    case "local_desktop":
      return "monitor";
    case "cloud_sandbox":
      return "cloud";
    case "ssh_remote":
      return "terminal";
    case "offline":
      return workspace.sandboxType === "local" ? "monitor" : "cloud";
    case "unknown":
      return "cloud";
  }
}

function runtimeDotStatus(
  workspace: CloudWorkspaceDetail,
  workspaceStatus: string,
): RuntimeContextView["status"] {
  if (workspace.runtime?.status === "provisioning" || workspace.runtime?.status === "pending") {
    return "running";
  }
  if (workspace.runtime?.status) {
    return mobileStatus(workspace.runtime.status);
  }
  if (workspace.executionTarget?.online === true) {
    return "running";
  }
  if (workspace.executionTarget?.online === false) {
    return "paused";
  }
  return mobileStatus(workspaceStatus);
}

function joinUniqueLabels(labels: Array<string | null | undefined>): string {
  const normalized = new Set<string>();
  const parts: string[] = [];
  for (const label of labels) {
    const trimmed = label?.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (normalized.has(key)) {
      continue;
    }
    normalized.add(key);
    parts.push(trimmed);
  }
  return parts.join(" · ");
}

function summarizeSessionSwitchContext(
  sessions: readonly CloudSessionProjection[],
  session: CloudSessionProjection | null,
  newSessionMode: boolean,
  sessionChoiceRequired: boolean,
): { label: string; detail: string } {
  const countLabel = formatSessionCount(sessions.length);
  if (newSessionMode) {
    return {
      label: "New session",
      detail: sessions.length ? `${countLabel} existing` : "No existing sessions",
    };
  }
  if (sessionChoiceRequired) {
    return {
      label: countLabel,
      detail: "Choose one",
    };
  }
  if (!session) {
    return {
      label: countLabel,
      detail: sessions.length ? "Choose one" : "Start one",
    };
  }
  const index = sessions.findIndex((candidate) => candidate.sessionId === session.sessionId);
  return {
    label: countLabel,
    detail: sessionDisplayTitle(session, Math.max(index, 0)),
  };
}

function formatSessionCount(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
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

function resolveAgentKind(workspace: CloudWorkspaceDetail): string {
  if (workspace.readyAgentKinds?.includes("codex")) {
    return "codex";
  }
  return workspace.readyAgentKinds?.[0] ?? workspace.allowedAgentKinds?.[0] ?? "codex";
}

async function copyBranchToClipboard(branchLabel: string): Promise<void> {
  await Clipboard.setStringAsync(branchLabel);
}

function summarizeComposerControls(
  controls: readonly CloudChatComposerControlView[],
): { label: string; icon: MobileIconName; pending: boolean } {
  const modelControl = controls.find((control) => control.key === "model") ?? null;
  const modeControl =
    controls.find((control) =>
      control.key === "mode" || control.key === "collaboration_mode"
    )
    ?? controls.find((control) => control.placement === "leading")
    ?? null;
  const primaryControl = modelControl ?? modeControl ?? controls[0] ?? null;
  const primaryLabel =
    composerControlValueLabel(primaryControl)
    ?? primaryControl?.label
    ?? "Chat settings";
  const secondaryLabel = modeControl && modeControl !== primaryControl
    ? composerControlValueLabel(modeControl)
    : null;
  const label = secondaryLabel && secondaryLabel !== primaryLabel
    ? `${primaryLabel} · ${secondaryLabel}`
    : primaryLabel;

  return {
    label,
    icon: composerControlIcon(primaryControl),
    pending: controls.some((control) => Boolean(control.pendingState)),
  };
}

function composerControlValueLabel(control: CloudChatComposerControlView | null): string | null {
  if (!control) {
    return null;
  }
  const selected = selectedComposerOptionLabel(control);
  const detail = control.detail?.trim();
  const value = detail && detail !== control.label && detail.toLowerCase() !== "mode"
    ? normalizeComposerLabel(detail)
    : selected;
  if (!value) {
    return null;
  }
  return control.pendingState ? `Updating ${value}` : value;
}

function selectedComposerOptionLabel(control: CloudChatComposerControlView): string | null {
  for (const group of control.groups) {
    const selected = group.options.find((option) => option.selected);
    if (selected) {
      return normalizeComposerLabel(selected.label);
    }
  }
  return null;
}

function normalizeComposerLabel(label: string): string {
  return label
    .replace(/^Claude\s*·\s*/i, "")
    .replace(/^Claude\s+(?=Sonnet|Haiku|Opus)/i, "")
    .replace(/^OpenAI\s*·\s*/i, "")
    .replace(/^Gemini\s*·\s*/i, "")
    .replace(/^Codex\s*·\s*/i, "");
}

function composerControlIcon(control: CloudChatComposerControlView | null): MobileIconName {
  switch (control?.icon) {
    case "brain":
      return "brain";
    case "sparkles":
    case "zap":
      return "sparkles";
    case "openai":
      return "openai";
    case "claude":
      return "claude";
    case "gemini":
      return "gemini";
    case "shieldCheck":
      return "shield";
    case "chat":
      return "sessions";
    case "opencodeBuild":
    case "bot":
      return "sparkles";
    case "settings":
    default:
      return "controls";
  }
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
  contextBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  contextChip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  contextChipPressed: {
    opacity: 0.72,
  },
  contextChipDisabled: {
    opacity: 0.48,
  },
  machineChip: {
    flex: 1,
    minWidth: 0,
  },
  sessionsChip: {
    maxWidth: "46%",
    flexShrink: 0,
  },
  contextIconSlot: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  contextText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  contextLabel: {
    color: colors.fg,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: "700",
  },
  contextDetailRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  contextDetail: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: "600",
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
    fontWeight: "600",
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
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingLeft: spacing[6],
  },
  userBubble: {
    maxWidth: "92%",
    borderRadius: 20,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: 4,
  },
  userBubbleText: {
    color: colors.fg,
    fontSize: 15,
    lineHeight: 21,
  },
  userBubbleStatus: {
    color: colors.faint,
    fontSize: 11,
  },
  assistantRow: {
    paddingRight: spacing[4],
    gap: 4,
  },
  systemRow: {
    opacity: 0.7,
  },
  assistantTitle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "600",
  },
  assistantBody: {
    color: colors.fg,
    fontSize: 15,
    lineHeight: 22,
  },
  assistantDetail: {
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 18,
  },
  assistantLoadingRow: {
    paddingRight: spacing[4],
    gap: 4,
  },
  assistantLoadingText: {
    color: "#f59e0b",
    fontSize: 15,
    lineHeight: 22,
    fontStyle: "italic",
  },
  historyRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: spacing[1],
  },
  historyRowPressed: {
    opacity: 0.72,
  },
  historyIcon: {
    width: 19,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  historyTextCluster: {
    maxWidth: "88%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  historySummary: {
    flexShrink: 1,
    minWidth: 0,
    color: "rgba(255,255,255,0.78)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },
  toolCard: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: spacing[1],
  },
  toolCardPressed: {
    opacity: 0.72,
  },
  toolIcon: {
    width: 19,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  toolText: {
    maxWidth: "88%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  toolTitle: {
    flexShrink: 1,
    minWidth: 0,
    color: "rgba(255,255,255,0.78)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },
  toolSubtitle: {
    color: colors.faint,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },
  toolSheetLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  toolSheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayStrong,
  },
  toolSheet: {
    maxHeight: "78%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingTop: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[5],
  },
  toolSheetHeader: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  toolSheetTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.fg,
    fontSize: 16,
    fontWeight: "600",
  },
  toolSheetClose: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  toolSheetScroll: {
    minHeight: 0,
  },
  toolSheetContent: {
    gap: spacing[3],
    paddingBottom: spacing[4],
  },
  toolSheetMeta: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  toolSheetBody: {
    color: colors.fg,
    fontSize: 14,
    lineHeight: 20,
  },
  toolSheetDetail: {
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 18,
  },
  permissionBox: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    backgroundColor: colors.background,
    padding: spacing[3],
    gap: spacing[2],
  },
  permissionTitle: {
    color: colors.fg,
    fontSize: 13.5,
    fontWeight: "700",
  },
  permissionBody: {
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 18,
  },
  permissionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  permissionButton: {
    minHeight: 34,
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    alignItems: "center",
    justifyContent: "center",
  },
  permissionAllowButton: {
    backgroundColor: colors.fg,
  },
  permissionRejectButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    backgroundColor: colors.card,
  },
  permissionButtonPressed: {
    opacity: 0.82,
  },
  permissionButtonDisabled: {
    opacity: 0.56,
  },
  permissionButtonText: {
    color: colors.background,
    fontSize: 12.5,
    fontWeight: "700",
  },
  permissionRejectButtonText: {
    color: colors.fg,
  },
  permissionError: {
    color: colors.red,
    fontSize: 12,
    lineHeight: 16,
  },
  toolChildren: {
    gap: spacing[2],
  },
  toolChild: {
    borderRadius: radius.md,
    backgroundColor: colors.background,
    padding: spacing[3],
    gap: spacing[1],
  },
  toolChildTitle: {
    color: colors.fg,
    fontSize: 13,
    fontWeight: "600",
  },
  toolChildBody: {
    color: colors.fg,
    fontSize: 12.5,
    lineHeight: 18,
  },
  toolChildDetail: {
    color: colors.faint,
    fontSize: 11.5,
    lineHeight: 16,
  },
  composer: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
    backgroundColor: colors.background,
  },
  composerCard: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    gap: spacing[2],
  },
  composerInput: {
    minHeight: 23,
    maxHeight: 200,
    borderWidth: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    color: colors.fg,
    fontSize: 17,
    lineHeight: 23,
  },
  composerFooter: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  configPill: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "76%",
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 0,
  },
  configPillPending: {
    backgroundColor: colors.accent,
  },
  configPillPressed: {
    opacity: 0.82,
  },
  configPillText: {
    minWidth: 0,
    color: colors.faint,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: "500",
    includeFontPadding: false,
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
});
