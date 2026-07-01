import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  PendingInteraction,
  Session,
  SessionEventEnvelope,
  SessionExecutionSummary,
} from "@anyharness/sdk";
import { reduceEvents } from "@anyharness/sdk";
import type {
  CloudPendingInteraction,
  CloudSessionEvent,
  CloudSessionProjection,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  useAgentAuthCredentials,
  useCloudAgentCatalog,
  useCloudCapabilities,
  useCloudClient,
  useCloudWorkspace,
} from "@proliferate/cloud-sdk-react";

import {
  compareSessions,
  effectiveWorkspaceStatus,
} from "../../../lib/domain/chat/cloud-chat-session-model";
import {
  getWebCloudSandboxAnyHarnessClient,
} from "../../../lib/access/anyharness/cloud-sandbox-runtime";
import { webCloudSessionDraftIdFromSearch } from "../../../stores/cloud/web-cloud-session-draft-store";
import { useAuthToken } from "../../../providers/WebCloudProvider";

const EMPTY_SESSION_EVENTS: CloudSessionEvent[] = [];
const EMPTY_TRANSCRIPT_ITEMS: CloudTranscriptItem[] = [];

export function useWebCloudChatData() {
  const { workspaceId, chatId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useCloudClient();
  const { token: productToken } = useAuthToken();
  const workspaceQuery = useCloudWorkspace(workspaceId ?? null, Boolean(workspaceId));
  const agentCatalog = useCloudAgentCatalog();
  const cloudCapabilities = useCloudCapabilities();
  const agentAuthCredentials = useAgentAuthCredentials();
  const workspace = workspaceQuery.data ?? null;
  const workspaceStatus = workspace ? effectiveWorkspaceStatus(workspace) : null;
  const sessionsQuery = useQuery({
    queryKey: ["web-cloud-anyharness-sessions", workspace?.id ?? null, workspace?.anyharnessWorkspaceId ?? null],
    enabled: Boolean(workspace?.anyharnessWorkspaceId) && Boolean(productToken),
    queryFn: async () => {
      const { connection, anyharness } = await getWebCloudSandboxAnyHarnessClient({
        workspace: workspace!,
        productToken,
        client,
      });
      const sessions = await anyharness.sessions.list(connection.anyharnessWorkspaceId);
      return sessions.map((session) => cloudSessionProjectionFromAnyHarness(
        session,
        workspace!.id,
      ));
    },
  });
  const sessions = useMemo(
    () => [...(sessionsQuery.data ?? [])].sort(compareSessions),
    [sessionsQuery.data],
  );
  const routeSessionDraftId = workspaceId ? webCloudSessionDraftIdFromSearch(location.search) : null;
  const session = chatId
    ? sessions.find((candidate) => candidate.sessionId === chatId) ?? null
    : null;
  const activeTranscriptSessionId = session?.sessionId ?? chatId ?? null;
  const sessionEventsQuery = useQuery({
    queryKey: [
      "web-cloud-anyharness-session-events",
      workspace?.id ?? null,
      workspace?.anyharnessWorkspaceId ?? null,
      session?.sessionId ?? null,
    ],
    enabled: Boolean(workspace?.anyharnessWorkspaceId) && Boolean(session?.sessionId) && Boolean(productToken),
    refetchInterval: 1000,
    queryFn: async () => {
      const { anyharness } = await getWebCloudSandboxAnyHarnessClient({
        workspace: workspace!,
        productToken,
        client,
      });
      const envelopes = await anyharness.sessions.listEvents(session!.sessionId, {
        limit: 500,
      });
      return envelopes.map((envelope) => cloudSessionEventFromAnyHarness(
        envelope,
        workspace!.id,
      ));
    },
  });
  const sessionLive = {
    lastPatchAt: sessionEventsQuery.dataUpdatedAt ? new Date(sessionEventsQuery.dataUpdatedAt) : undefined,
    isConnected: false,
  };
  const transcriptQuery = {
    data: undefined,
    isLoading: sessionEventsQuery.isLoading,
    isFetched: sessionEventsQuery.isFetched,
    isError: sessionEventsQuery.isError,
    refetch: sessionEventsQuery.refetch,
  };
  const transcriptItems = EMPTY_TRANSCRIPT_ITEMS;
  const sessionEvents = sessionEventsQuery.data ?? EMPTY_SESSION_EVENTS;
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
  const snapshot = useMemo(
    () => workspace ? { workspace, sessions } : undefined,
    [sessions, workspace],
  );

  return {
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
  };
}

function cloudSessionProjectionFromAnyHarness(
  session: Session,
  cloudWorkspaceId: string,
): CloudSessionProjection {
  return {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    targetId: cloudWorkspaceId,
    title: session.title ?? null,
    status: session.status ?? null,
    phase: session.executionSummary?.phase ?? session.status ?? null,
    startedAt: session.createdAt,
    lastEventAt: session.updatedAt ?? session.lastPromptAt ?? session.createdAt,
    lastEventSeq: 0,
    pendingInteractionCount: session.executionSummary?.pendingInteractions?.length ?? 0,
    executionSummary: session.executionSummary ?? null,
    parentSessionId: null,
    sourceAgentKind: session.agentKind,
    modelId: session.modelId ?? session.requestedModelId ?? null,
    modeId: session.modeId ?? session.requestedModeId ?? null,
    liveConfig: session.liveConfig ?? null,
    config: session.liveConfig
      ? {
        version: 0,
        current: {},
        available: {},
        updatedAt: session.updatedAt,
      }
      : null,
  };
}

function cloudPendingInteractionsFromExecutionSummary(
  executionSummary: SessionExecutionSummary | null | undefined,
  sessionId: string | null,
): CloudPendingInteraction[] {
  return (executionSummary?.pendingInteractions ?? []).map((interaction) => ({
    requestId: interaction.requestId,
    sessionId,
    status: "pending",
    kind: interaction.kind,
    title: interaction.title,
    description: interaction.description ?? null,
    toolCallId: interaction.source.toolCallId ?? null,
    toolKind: interaction.source.toolKind ?? null,
    toolStatus: interaction.source.toolStatus ?? null,
    linkedPlanId: interaction.source.linkedPlanId ?? null,
    ...(interaction.payload.type === "permission"
      ? {
        options: interaction.payload.options ?? [],
        context: interaction.payload.context ?? null,
      }
      : {}),
    ...(interaction.payload.type === "user_input"
      ? { questions: interaction.payload.questions ?? [] }
      : {}),
    ...(interaction.payload.type === "mcp_elicitation"
      ? {
        mcpElicitation: {
          serverName: interaction.payload.serverName,
          mode: interaction.payload.mode,
        },
      }
      : {}),
  }));
}

function cloudPendingInteractionsFromReducer(
  pendingInteractions: readonly PendingInteraction[],
  sessionId: string,
): CloudPendingInteraction[] {
  return pendingInteractions.map((interaction) => ({
    requestId: interaction.requestId,
    sessionId,
    status: "pending",
    kind: interaction.kind,
    title: interaction.title,
    description: interaction.description ?? null,
    toolCallId: interaction.toolCallId ?? null,
    toolKind: interaction.toolKind ?? null,
    toolStatus: interaction.toolStatus ?? null,
    linkedPlanId: interaction.linkedPlanId ?? null,
    ...(interaction.kind === "permission"
      ? {
        options: interaction.options ?? [],
        context: interaction.context ?? null,
      }
      : {}),
    ...(interaction.kind === "user_input"
      ? { questions: interaction.questions ?? [] }
      : {}),
    ...(interaction.kind === "mcp_elicitation"
      ? { mcpElicitation: interaction.mcpElicitation }
      : {}),
  }));
}

function cloudSessionEventFromAnyHarness(
  envelope: SessionEventEnvelope,
  cloudWorkspaceId: string,
): CloudSessionEvent {
  return {
    targetId: cloudWorkspaceId,
    sessionId: envelope.sessionId,
    seq: envelope.seq,
    eventType: envelope.event.type,
    sourceKind: null,
    turnId: envelope.turnId ?? null,
    itemId: envelope.itemId ?? null,
    occurredAt: envelope.timestamp,
    payload: envelope.event,
    envelope,
  };
}
