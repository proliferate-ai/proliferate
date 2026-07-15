import type {
  SessionEventEnvelope,
  SessionExecutionSummary,
} from "@anyharness/sdk";
import { reduceEvents } from "@anyharness/sdk";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
  CloudPendingInteraction,
  CloudSessionEvent,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  useCloudClient,
  useCloudWorkspace,
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
  cloudPendingInteractionsFromExecutionSummary,
  cloudPendingInteractionsFromReducer,
  cloudSessionEventFromAnyHarness,
  cloudSessionProjectionFromAnyHarness,
} from "../../../lib/domain/chat/mobile-chat-anyharness-projection";
import {
  compareSessions,
  effectiveWorkspaceStatus,
  sessionProjectionFromChat,
} from "../../../lib/domain/chat/mobile-chat-presentation";
import {
  getMobileCloudSandboxAnyHarnessClient,
} from "../../../lib/access/anyharness/cloud-sandbox-runtime";

const EMPTY_TRANSCRIPT_ITEMS: CloudTranscriptItem[] = [];
const EMPTY_SESSION_EVENTS: CloudSessionEvent[] = [];

export function useMobileChatData({
  chat,
  productToken,
  selectedSessionId,
  newSessionMode,
  pendingPrompt,
  pendingPromptFailed,
  pendingPromptStatus,
  optimisticPrompts,
}: {
  chat: MobileCloudChat;
  productToken: string | null;
  selectedSessionId: string | null;
  newSessionMode: boolean;
  pendingPrompt: MobilePendingPrompt | null;
  pendingPromptFailed: boolean;
  pendingPromptStatus: string | null;
  optimisticPrompts: readonly OptimisticPrompt[];
}) {
  const client = useCloudClient();
  const workspaceQuery = useCloudWorkspace(chat.workspaceId, true);
  const workspace = workspaceQuery.data ?? null;
  const sessionsQuery = useQuery({
    queryKey: [
      "mobile-cloud-anyharness-sessions",
      workspace?.id ?? null,
      workspace?.anyharnessWorkspaceId ?? null,
    ],
    enabled: Boolean(workspace?.anyharnessWorkspaceId) && Boolean(productToken),
    refetchInterval: pendingPrompt || optimisticPrompts.length > 0 ? 1500 : 5000,
    queryFn: async () => {
      if (!workspace) {
        return [];
      }
      const { connection, anyharness } = await getMobileCloudSandboxAnyHarnessClient({
        workspace,
        productToken,
        client,
      });
      const sessions = await anyharness.sessions.list(connection.anyharnessWorkspaceId);
      return sessions.map((session) => cloudSessionProjectionFromAnyHarness(
        session,
        workspace.id,
        connection.anyharnessWorkspaceId,
      ));
    },
  });
  const sessions = useMemo(
    () => [...(sessionsQuery.data ?? [])].sort(compareSessions),
    [sessionsQuery.data],
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
  const sessionLive = {
    lastPatchAt: sessionsQuery.dataUpdatedAt ? new Date(sessionsQuery.dataUpdatedAt) : null,
    isConnected: false,
  };
  const transcriptQuery = {
    data: undefined as { transcriptItems: CloudTranscriptItem[]; pendingInteractions: CloudPendingInteraction[] } | undefined,
    isLoading: sessionsQuery.isLoading,
    refetch: sessionsQuery.refetch,
  };
  const sessionEventsQuery = useQuery({
    queryKey: [
      "mobile-cloud-anyharness-session-events",
      workspace?.id ?? null,
      workspace?.anyharnessWorkspaceId ?? null,
      session?.sessionId ?? null,
    ],
    enabled: Boolean(workspace?.anyharnessWorkspaceId) && Boolean(session?.sessionId) && Boolean(productToken),
    refetchInterval: pendingPrompt || optimisticPrompts.length > 0 ? 1500 : 5000,
    queryFn: async () => {
      if (!workspace || !session) {
        return { events: EMPTY_SESSION_EVENTS };
      }
      const { anyharness } = await getMobileCloudSandboxAnyHarnessClient({
        workspace,
        productToken,
        client,
      });
      const envelopes = await anyharness.sessions.listEvents(session.sessionId, {
        limit: 500,
      });
      return {
        events: envelopes.map((envelope) =>
          cloudSessionEventFromAnyHarness(envelope, workspace.id, session.sessionId)
        ),
      };
    },
  });
  const transcriptItems =
    transcriptQuery.data?.transcriptItems
    ?? EMPTY_TRANSCRIPT_ITEMS;
  const sessionEvents = sessionEventsQuery.data?.events ?? EMPTY_SESSION_EVENTS;
  const pendingInteractions = useMemo(
    () => {
      if (session?.sessionId && sessionEventsQuery.isFetched) {
        const eventEnvelopes = sessionEvents
          .map((event) => event.envelope)
          .filter((envelope): envelope is SessionEventEnvelope =>
            Boolean(envelope && typeof envelope === "object" && "event" in envelope)
          );
        const transcript = reduceEvents(eventEnvelopes, session.sessionId);
        return cloudPendingInteractionsFromReducer(
          transcript.pendingInteractions,
          session.sessionId,
        );
      }
      return cloudPendingInteractionsFromExecutionSummary(
        session?.executionSummary as SessionExecutionSummary | null | undefined,
        session?.sessionId ?? null,
      );
    },
    [
      session?.executionSummary,
      session?.sessionId,
      sessionEvents,
      sessionEventsQuery.isFetched,
    ],
  );
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
