import type { Session } from "@anyharness/sdk";
import { resolveStatusFromExecutionSummary } from "@proliferate/product-domain/sessions/activity";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import { materializeSessionRecord } from "@/hooks/sessions/workflows/session-creation-local-state";

interface MaterializedCoworkSessionRecordInput {
  clientSessionId: string;
  session: Session;
  workspaceId: string;
  fallbackAgentKind: string;
  fallbackModelId: string;
  fallbackModeId: string | null;
  fallbackTitle: string | null;
}

interface RecordCreatedCoworkSessionInput {
  projectedSessionId: string | null;
  launchedSession: Session;
  workspaceId: string;
  agentKind: string;
  modelId: string;
  modeId: string | null;
}

function materializedCoworkSessionRecord(
  input: MaterializedCoworkSessionRecordInput,
): SessionRuntimeRecord {
  const modeId =
    input.session.liveConfig?.normalizedControls.mode?.currentValue
    ?? input.session.modeId
    ?? input.fallbackModeId;
  const record = createEmptySessionRecord(
    input.clientSessionId,
    input.session.agentKind || input.fallbackAgentKind,
    {
      workspaceId: input.workspaceId,
      materializedSessionId: input.session.id,
      modelId: input.session.modelId ?? input.fallbackModelId,
      modeId,
      title: input.session.title ?? input.fallbackTitle,
      actionCapabilities: input.session.actionCapabilities,
      liveConfig: input.session.liveConfig ?? null,
      executionSummary: input.session.executionSummary ?? null,
      mcpBindingSummaries: input.session.mcpBindingSummaries ?? null,
      lastPromptAt: input.session.lastPromptAt ?? null,
      hasAttemptedPrompt:
        getSessionRecord(input.clientSessionId)?.hasAttemptedPrompt ?? false,
      optimisticPrompt: null,
      sessionRelationship: { kind: "root" },
    },
  );

  return {
    ...record,
    status: resolveStatusFromExecutionSummary(
      input.session.executionSummary,
      input.session.status ?? "idle",
    ),
    transcriptHydrated: true,
  };
}

export function recordCreatedCoworkSession({
  projectedSessionId,
  launchedSession,
  workspaceId,
  agentKind,
  modelId,
  modeId,
}: RecordCreatedCoworkSessionInput): void {
  if (projectedSessionId) {
    const projectedRecord = getSessionRecord(projectedSessionId);
    const record = materializedCoworkSessionRecord({
      clientSessionId: projectedSessionId,
      session: launchedSession,
      workspaceId,
      fallbackAgentKind: agentKind,
      fallbackModelId: modelId,
      fallbackModeId: modeId,
      fallbackTitle: projectedRecord?.title ?? modelId,
    });
    materializeSessionRecord(projectedSessionId, launchedSession.id, record);
    useSessionIntentStore.getState().bindMaterializedSession(
      projectedSessionId,
      launchedSession.id,
    );
    return;
  }

  putSessionRecord(
    materializedCoworkSessionRecord({
      clientSessionId: launchedSession.id,
      session: launchedSession,
      workspaceId,
      fallbackAgentKind: agentKind,
      fallbackModelId: modelId,
      fallbackModeId: modeId,
      fallbackTitle: modelId,
    }),
  );
}
