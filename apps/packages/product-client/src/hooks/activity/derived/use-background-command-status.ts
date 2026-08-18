import { parseBackgroundCommandProcessId } from "#product/domain/chats/tools/background-command-correlation";
import { processTrailingStatusLabel } from "#product/domain/activity/process";
import { useSessionActivityForSession } from "#product/hooks/activity/derived/use-session-activity";

export interface BackgroundCommandStatus {
  /** The roster `ActivityProcess.id` parsed out of the command's own result text, or null. */
  processId: string | null;
  /** `running · 4m 12s` / `exited 0 · 2m 45s`, present only when roster data exists. */
  trailingStatus: string | undefined;
}

/**
 * A background Bash command's own result text carries the only link to its
 * roster entry (`Command running in background with ID: {taskId}` — no
 * wire-level correlation exists). Shared between `CommandActionRow` (bgwork
 * r8 round 1/2) and `CollapsedActionRows`' `ParsedCommandRows` (round 3): a
 * command that parses into structured display rows is still one process
 * with one result text, so both call sites resolve the same id/status pair
 * against this one hook rather than duplicating the roster lookup.
 *
 * The transcript session id is passed in by the (component-layer) caller
 * rather than read here from `useTranscriptSessionId`: that context accessor
 * lives in the components layer, and a hook reaching up into it is an upward
 * layer edge the frontend boundary lint (FE-PC-6) rejects. Every call site
 * already renders inside the transcript context, so threading the id keeps
 * this hook within the hooks layer at no cost.
 */
export function useBackgroundCommandStatus(
  resultText: string,
  sessionId: string | null,
): BackgroundCommandStatus {
  const { processes } = useSessionActivityForSession(sessionId);
  const processId = parseBackgroundCommandProcessId(resultText);
  const process = processId
    ? processes.find((candidate) => candidate.id === processId) ?? null
    : null;
  return {
    processId,
    trailingStatus: process ? processTrailingStatusLabel(process, Date.now()) : undefined,
  };
}
