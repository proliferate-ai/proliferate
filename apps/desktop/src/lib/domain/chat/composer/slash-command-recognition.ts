import type { SessionSlashCommandViewModel } from "./session-slash-command-policy";

export interface RecognizedSlashCommand {
  /** The command view-model that matched. */
  command: SessionSlashCommandViewModel;
  /** Byte offset of the "/" in the draft. */
  start: number;
  /** Byte offset just past the command token (before trailing whitespace/end). */
  end: number;
}

/**
 * Recognizes an exact slash command at the start of the draft.
 *
 * Returns null when the draft doesn't start with a known runnable command
 * token, or when the token is only a prefix (the popup handles prefix matches).
 * The match is case-insensitive on the command name.
 *
 * Pure, zero-allocation on the miss path (draft doesn't start with "/").
 */
export function recognizeLeadingSlashCommand(
  draft: string,
  commands: readonly SessionSlashCommandViewModel[],
): RecognizedSlashCommand | null {
  // Fast bail: no leading slash → no work.
  const trimStart = countLeadingWhitespace(draft);
  if (draft[trimStart] !== "/") {
    return null;
  }

  // Extract the first token (from "/" up to whitespace or end).
  const tokenStart = trimStart;
  let tokenEnd = tokenStart + 1;
  while (tokenEnd < draft.length && !/\s/u.test(draft[tokenEnd]!)) {
    tokenEnd += 1;
  }

  // The token must be followed by whitespace or be at end-of-string to count
  // as "recognized" (still typing = not yet recognized, leave to the popup).
  if (tokenEnd < draft.length && !/\s/u.test(draft[tokenEnd]!)) {
    return null;
  }

  const token = draft.slice(tokenStart + 1, tokenEnd).toLowerCase();
  if (!token) {
    return null;
  }

  for (const command of commands) {
    if (command.name.toLowerCase() === token) {
      return { command, start: tokenStart, end: tokenEnd };
    }
  }

  return null;
}

function countLeadingWhitespace(text: string): number {
  let i = 0;
  while (i < text.length && /\s/u.test(text[i]!)) {
    i += 1;
  }
  return i;
}
