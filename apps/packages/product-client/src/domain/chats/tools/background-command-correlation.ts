/**
 * Client-side correlation between a Bash tool call's own result text and the
 * runtime's background-process roster (bgwork r8, "background command
 * tool-call opens terminal detail"). There is no wire-level tool_call_id <->
 * `ActivityProcess.id` correlation for a backgrounded command: the harness's
 * Bash tool result carries the literal sentence "Command running in
 * background with ID: {taskId}" when a command was backgrounded, and that
 * `{taskId}` IS the runtime's `ActivityProcess.id` used by the roster
 * (`domain/activity/process.ts`). Parsing this sentence out of the tool
 * result text is the only way the client learns which roster entry a given
 * transcript row corresponds to.
 */

const BACKGROUND_COMMAND_ID_PATTERN = /Command running in background with ID:\s*(\S+)/;

/**
 * Extracts the backgrounded process id from a Bash tool call's (already
 * normalized) result text. Returns null when the sentence is absent —
 * ordinary foreground commands, or a background sentence in a shape this
 * pattern doesn't recognize — so the caller keeps its ordinary
 * inline-disclosure behavior instead of treating the row as a background
 * command.
 */
export function parseBackgroundCommandProcessId(resultText: string): string | null {
  const match = resultText.match(BACKGROUND_COMMAND_ID_PATTERN);
  const id = match?.[1]?.replace(/[.,;:]+$/, "");
  return id ? id : null;
}
