import { useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  CloudPendingInteraction,
  CloudSessionEvent,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  useAgentAuthCredentials,
  useCloudAgentCatalog,
  useCloudCapabilities,
  useCloudClient,
  useCloudSessionEvents,
  useCloudTranscriptSnapshot,
  useCloudWorkspaceSnapshot,
  useSessionLive,
  useWorkspaceLive,
} from "@proliferate/cloud-sdk-react";

import {
  compareSessions,
  effectiveWorkspaceStatus,
  mergeWorkspaceSnapshot,
} from "../../../lib/domain/chat/cloud-chat-session-model";
import { webCloudSessionDraftIdFromSearch } from "../../../stores/cloud/web-cloud-session-draft-store";

const EMPTY_SESSION_EVENTS: CloudSessionEvent[] = [];
const EMPTY_TRANSCRIPT_ITEMS: CloudTranscriptItem[] = [];
const EMPTY_PENDING_INTERACTIONS: CloudPendingInteraction[] = [];

export function useWebCloudChatData() {
  const { workspaceId, chatId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useCloudClient();
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
  const sessionEvents = sessionEventsQuery.data?.events ?? EMPTY_SESSION_EVENTS;

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
    workspaceLive,
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
