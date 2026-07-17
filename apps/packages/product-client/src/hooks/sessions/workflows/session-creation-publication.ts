import type { Session } from "@anyharness/sdk";
import type { DesktopProductEventMap } from "#product/lib/domain/telemetry/events";
import {
  materializeSessionRecord,
} from "#product/hooks/sessions/workflows/session-creation-local-state";
import {
  requeuePromptIntentsBlockedOnMaterialization,
} from "#product/hooks/sessions/workflows/session-creation-materialization-helpers";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { rememberLastViewedSession } from "#product/stores/preferences/workspace-ui-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import type { SessionRuntimeRecord } from "#product/stores/sessions/session-types";

export type TrackChatSessionCreated = (
  name: "chat_session_created",
  payload: DesktopProductEventMap["chat_session_created"],
) => void;

export function publishCreatedSessionMaterialization(input: {
  agentKind: string;
  fallbackModeId: string | null;
  fallbackModelId: string;
  launchIntentId?: string | null;
  pendingSessionId: string;
  record: SessionRuntimeRecord;
  session: Session;
  trackProductEvent: TrackChatSessionCreated;
  upsertWorkspaceSessionRecord: (
    workspaceId: string,
    session: Session,
  ) => void;
  workspaceId: string;
  workspaceKind: "cloud" | "local";
}): void {
  materializeSessionRecord(
    input.pendingSessionId,
    input.session.id,
    input.record,
  );
  useSessionIntentStore.getState().bindMaterializedSession(
    input.pendingSessionId,
    input.session.id,
  );
  requeuePromptIntentsBlockedOnMaterialization({
    clientSessionId: input.pendingSessionId,
    materializedSessionId: input.session.id,
    workspaceId: input.workspaceId,
  });
  logLatency("session.create.materialized", {
    clientSessionId: input.pendingSessionId,
    materializedSessionId: input.session.id,
    workspaceId: input.workspaceId,
    agentKind: input.agentKind,
    modelId: input.session.modelId ?? input.fallbackModelId,
    modeId: input.session.modeId ?? input.fallbackModeId,
    status: input.record.status,
    executionPhase: input.session.executionSummary?.phase ?? null,
    pendingInteractionCount:
      input.session.executionSummary?.pendingInteractions?.length ?? 0,
    activeSessionId: useSessionSelectionStore.getState().activeSessionId,
  });
  if (useSessionSelectionStore.getState().activeSessionId === input.pendingSessionId) {
    rememberLastViewedSession(input.workspaceId, input.session.id);
  }
  input.upsertWorkspaceSessionRecord(input.workspaceId, input.session);
  input.trackProductEvent("chat_session_created", {
    workspace_kind: input.workspaceKind,
    agent_kind: input.agentKind,
  });

  if (input.launchIntentId) {
    useChatLaunchIntentStore.getState().markMaterializedIfActive(
      input.launchIntentId,
      {
        clientSessionId: input.pendingSessionId,
        workspaceId: input.workspaceId,
        sessionId: input.session.id,
      },
    );
  }
}
