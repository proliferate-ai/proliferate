import { useMemo } from "react";
import type {
  CloudPendingInteraction,
  CloudSessionEvent,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  useCloudSessionEvents,
  useCloudTranscriptSnapshot,
  useCloudWorkspaceSnapshot,
  useSessionLive,
  useWorkspaceLive,
} from "@proliferate/cloud-sdk-react";
import {
  buildCloudTranscriptView,
  cloudTranscriptHasAgentProgressAfterPrompt,
  cloudTranscriptHasUserPrompt,
} from "@proliferate/product-domain/chats/cloud/transcript-view";

import type {
  MobileCloudChat,
  MobilePendingPrompt,
} from "../../../navigation/navigation-model";
import {
  type OptimisticPrompt,
  buildOptimisticPromptRows,
  buildPendingPromptRows,
  latestPendingPromptCommandId,
  optimisticPromptFromPending,
} from "../../../lib/domain/chat/mobile-chat-transcript";
import {
  compareSessions,
  effectiveWorkspaceStatus,
  sessionProjectionFromChat,
} from "../../../lib/domain/chat/mobile-chat-presentation";

const EMPTY_TRANSCRIPT_ITEMS: CloudTranscriptItem[] = [];
const EMPTY_SESSION_EVENTS: CloudSessionEvent[] = [];
const EMPTY_PENDING_INTERACTIONS: CloudPendingInteraction[] = [];

export function useMobileChatData({
  chat,
  selectedSessionId,
  newSessionMode,
  pendingPrompt,
  pendingPromptFailed,
  pendingPromptStatus,
  optimisticPrompts,
}: {
  chat: MobileCloudChat;
  selectedSessionId: string | null;
  newSessionMode: boolean;
  pendingPrompt: MobilePendingPrompt | null;
  pendingPromptFailed: boolean;
  pendingPromptStatus: string | null;
  optimisticPrompts: readonly OptimisticPrompt[];
}) {
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

  return {
    workspaceQuery,
    workspace,
    sessions,
    session,
    sessionChoiceRequired,
    activeSessionId,
    targetId,
    workspaceStatus,
    sessionLive,
    transcriptQuery,
    sessionEventsQuery,
    transcriptItems,
    pendingInteractions,
    pendingPermissionByRequestId,
    pendingPromptCommandId,
    transcriptView,
    hasActiveOptimisticPrompt,
    pendingPromptTranscriptState,
    pendingPromptDurable,
    visibleTranscriptRows,
  };
}
