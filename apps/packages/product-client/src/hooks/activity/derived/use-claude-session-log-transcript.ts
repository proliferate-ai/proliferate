import { useMemo } from "react";
import {
  claudeSessionLogToTranscriptState,
  type ClaudeSessionLogTranscript,
} from "#product/domain/activity/claude-session-log";

/**
 * Memoized client-side translation of a claude subagent's accumulated
 * `tail_file` buffer into a `TranscriptState` (see
 * `domain/activity/claude-session-log.ts` for the mapped subset and the
 * "recompute on buffer growth" rationale). `sessionId` is a synthetic key —
 * this transcript has no session-store entry — used only to stamp
 * `TranscriptState.sessionMeta.sessionId` and thread `TranscriptContexts`'
 * pane-lifecycle bookkeeping.
 */
export function useClaudeSessionLogTranscript(
  buffer: string,
  sessionId: string,
): ClaudeSessionLogTranscript {
  return useMemo(
    () => claudeSessionLogToTranscriptState(buffer, sessionId),
    [buffer, sessionId],
  );
}
