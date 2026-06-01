import { useMemo } from "react";
import { createTranscriptState } from "@anyharness/sdk";
import type {
  CloudPendingInteraction,
  CloudSessionEvent,
  CloudSessionProjection,
  CloudTranscriptItem,
  CloudWorkspaceDetail,
} from "@proliferate/cloud-sdk";
import type { ChatTranscriptState } from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import type { PendingConfigChange } from "@proliferate/product-domain/chats/cloud/composer-controls";
import {
  buildCloudTranscriptState,
  buildCloudTranscriptView,
  cloudPendingInteractionsRequireProjectedRows,
} from "@proliferate/product-domain/chats/cloud/transcript-view";

import { friendlyCommandStatusMessage } from "../../../lib/domain/chat/cloud-chat-command-presentation";
import {
  commandIdsKey,
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
import { resolveCloudTranscriptSessionViewState } from "../../../lib/domain/chat/cloud-chat-transcript-session-state";
import type { PendingHomePrompt } from "../../../lib/access/cloud/pending-home-prompt-store";
import type {
  WebCloudPromptIntent,
} from "../../../stores/cloud/web-cloud-prompt-intent-store";
import type {
  WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-session-draft-store";

export function useWebCloudTranscriptProjection(input: {
  workspace: CloudWorkspaceDetail | null;
  session: CloudSessionProjection | null;
  activeTranscriptSessionId: string | null;
  sessionEvents: readonly CloudSessionEvent[];
  transcriptItems: readonly CloudTranscriptItem[];
  pendingInteractions: readonly CloudPendingInteraction[];
  optimisticPrompts: readonly WebCloudPromptIntent[];
  pendingHomePrompt: PendingHomePrompt | null;
  pendingSessionDraft: WebCloudSessionDraft | null;
  pendingHomePromptStatus: string | null;
  pendingConfigChanges: Record<string, PendingConfigChange>;
}) {
  const {
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
  } = input;
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
  const pendingPromptCommandIdsKey = commandIdsKey(pendingPromptCommandIds);
  const optimisticPromptCommandIds = useMemo(
    () => optimisticPromptCommandIdsFromPrompts(optimisticPrompts),
    [optimisticPrompts],
  );
  const optimisticPromptCommandIdsKey = commandIdsKey(optimisticPromptCommandIds);
  const pendingConfigCommandIds = useMemo(
    () => pendingConfigCommandIdsFromChanges(pendingConfigChanges),
    [pendingConfigChanges],
  );
  const pendingConfigCommandIdsKey = commandIdsKey(pendingConfigCommandIds);
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

  return {
    pendingInteractionsRequireProjectedRows,
    visiblePendingHomePromptStatus,
    pendingPromptCommandId,
    pendingPromptCommandIds,
    pendingPromptCommandIdsKey,
    optimisticPromptCommandIds,
    optimisticPromptCommandIdsKey,
    pendingConfigCommandIds,
    pendingConfigCommandIdsKey,
    transcriptState,
    transcriptView,
    sharedOutboxEntries,
    sharedTranscriptState,
    visibleTranscriptRows,
  };
}
