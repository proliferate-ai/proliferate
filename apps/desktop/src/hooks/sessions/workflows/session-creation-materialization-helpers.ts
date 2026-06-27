import type { Session } from "@anyharness/sdk";
import { resolveStatusFromExecutionSummary } from "@proliferate/product-domain/sessions/activity";
import {
  pendingConfigChangesForSessionIntents,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import {
  sessionIntentsForSession,
} from "@proliferate/product-domain/sessions/intents/session-intent-state";
import {
  materializeSessionRecord,
} from "@/hooks/sessions/workflows/session-creation-local-state";
import { annotateLatencyFlow } from "@/lib/infra/measurement/latency-flow";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { rememberLastViewedSession } from "@/stores/preferences/workspace-ui-store";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";

export function materializeExistingSession({
  existingProjectedRecord,
  existingSession,
  fallbackModelId,
  latencyFlowId,
  launchIntentId,
  pendingSessionId,
  resolvedModeId,
  upsertWorkspaceSessionRecord,
  workspaceId,
}: {
  existingProjectedRecord: SessionRuntimeRecord | null;
  existingSession: Session;
  fallbackModelId: string;
  latencyFlowId?: string | null;
  launchIntentId?: string | null;
  pendingSessionId: string;
  resolvedModeId: string | null;
  upsertWorkspaceSessionRecord: (workspaceId: string, session: Session) => void;
  workspaceId: string;
}): string {
  annotateLatencyFlow(latencyFlowId, {
    targetSessionId: existingSession.id,
  });
  const realRecord = materializedRecordFromExistingSession({
    clientSessionId: pendingSessionId,
    session: existingSession,
    workspaceId,
    fallbackModelId,
    fallbackModeId: resolvedModeId,
    fallbackTitle: existingProjectedRecord?.title ?? null,
    pendingConfigChanges: {},
  });
  materializeSessionRecord(pendingSessionId, existingSession.id, realRecord);
  useSessionIntentStore.getState().bindMaterializedSession(
    pendingSessionId,
    existingSession.id,
  );
  requeuePromptIntentsBlockedOnMaterialization({
    clientSessionId: pendingSessionId,
    materializedSessionId: existingSession.id,
    workspaceId,
  });
  if (useSessionSelectionStore.getState().activeSessionId === pendingSessionId) {
    rememberLastViewedSession(workspaceId, existingSession.id);
  }
  upsertWorkspaceSessionRecord(workspaceId, existingSession);
  if (launchIntentId) {
    useChatLaunchIntentStore.getState().markMaterializedIfActive(
      launchIntentId,
      {
        clientSessionId: pendingSessionId,
        workspaceId,
        sessionId: existingSession.id,
      },
    );
  }
  return pendingSessionId;
}

export function pendingConfigValuesForSession(
  sessionId: string,
): Record<string, string> {
  const pendingConfigChanges = pendingConfigChangesForSessionIntents(
    sessionIntentsForSession(useSessionIntentStore.getState(), sessionId),
  );
  return Object.fromEntries(
    Object.values(pendingConfigChanges)
      .map((change) => [change.rawConfigId, change.value] as const),
  );
}

export function requeuePromptIntentsBlockedOnMaterialization({
  clientSessionId,
  materializedSessionId,
  workspaceId,
}: {
  clientSessionId: string;
  materializedSessionId: string;
  workspaceId: string;
}): void {
  const store = useSessionIntentStore.getState();
  for (const intent of sessionIntentsForSession(store, clientSessionId)) {
    if (
      intent.kind !== "send_prompt"
      || intent.deliveryState !== "failed_before_dispatch"
    ) {
      continue;
    }
    store.patchIntent(intent.intentId, {
      status: "queued",
      deliveryState: "waiting_for_session",
      errorMessage: null,
      materializedSessionId,
      workspaceId,
      dispatchedAt: null,
      acceptedAt: null,
      queuedSeq: null,
    });
    logLatency("session.intent.prompt.requeued_after_materialization", {
      clientPromptId: intent.clientPromptId,
      clientSessionId,
      materializedSessionId,
      workspaceId,
    });
  }
}

function materializedRecordFromExistingSession({
  clientSessionId,
  session,
  workspaceId,
  fallbackModelId,
  fallbackModeId,
  fallbackTitle,
  pendingConfigChanges,
}: {
  clientSessionId: string;
  session: Session;
  workspaceId: string;
  fallbackModelId: string;
  fallbackModeId: string | null;
  fallbackTitle: string | null;
  pendingConfigChanges: SessionRuntimeRecord["pendingConfigChanges"];
}): SessionRuntimeRecord {
  return {
    ...createEmptySessionRecord(clientSessionId, session.agentKind, {
      workspaceId,
      materializedSessionId: session.id,
      modelId: session.modelId ?? fallbackModelId,
      requestedModelId: session.requestedModelId ?? fallbackModelId,
      modeId: session.modeId ?? fallbackModeId,
      title: session.title ?? fallbackTitle,
      actionCapabilities: session.actionCapabilities,
      liveConfig: session.liveConfig ?? null,
      executionSummary: session.executionSummary ?? null,
      mcpBindingSummaries: session.mcpBindingSummaries ?? null,
      lastPromptAt: session.lastPromptAt ?? null,
      hasAttemptedPrompt: getSessionRecord(clientSessionId)?.hasAttemptedPrompt ?? false,
      optimisticPrompt: null,
      pendingConfigChanges,
      sessionRelationship: { kind: "root" },
    }),
    status: resolveStatusFromExecutionSummary(
      session.executionSummary,
      session.status ?? "idle",
    ),
    transcriptHydrated: true,
  };
}
