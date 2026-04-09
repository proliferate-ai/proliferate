import type {
  Session,
  SessionExecutionSummary,
  SessionLiveConfigSnapshot,
  SessionStatus,
  TranscriptState,
} from "@anyharness/sdk";
import { resolveStatusFromExecutionSummary } from "@/lib/domain/sessions/activity";

export interface SessionSlotSummaryPatch {
  agentKind: string;
  workspaceId: string;
  modelId: string | null;
  modeId: string | null;
  title: string | null;
  liveConfig: SessionLiveConfigSnapshot | null;
  executionSummary: SessionExecutionSummary | null;
  status: SessionStatus | null;
  lastPromptAt: string | null;
  transcript: TranscriptState;
}

export function buildSessionSlotPatchFromSummary(
  session: Session,
  workspaceId: string,
  transcript: TranscriptState,
): SessionSlotSummaryPatch {
  const modeId =
    session.liveConfig?.normalizedControls.mode?.currentValue
    ?? session.modeId
    ?? null;
  const title = session.title ?? null;

  return {
    agentKind: session.agentKind,
    workspaceId,
    modelId: session.modelId ?? null,
    modeId,
    title,
    liveConfig: session.liveConfig ?? null,
    executionSummary: session.executionSummary ?? null,
    status: resolveStatusFromExecutionSummary(session.executionSummary, session.status),
    lastPromptAt: session.lastPromptAt ?? null,
    transcript: {
      ...transcript,
      currentModeId: modeId ?? transcript.currentModeId,
      sessionMeta: {
        ...transcript.sessionMeta,
        title: title ?? transcript.sessionMeta.title ?? null,
      },
    },
  };
}
