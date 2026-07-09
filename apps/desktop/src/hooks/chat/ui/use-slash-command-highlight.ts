import { useMemo } from "react";
import {
  recognizeLeadingSlashCommand,
  type RecognizedSlashCommand,
} from "@/lib/domain/chat/composer/slash-command-recognition";
import type { SessionSlashCommandViewModel } from "@/lib/domain/chat/composer/session-slash-command-policy";

/**
 * Memoized recognition of a leading slash command in the draft text.
 *
 * Returns the recognition result (command + offsets) when the first token of
 * the draft is an exact match against a known runnable command, or null
 * otherwise. The command list is expected to be stable across renders (it only
 * changes on session change).
 */
export function useSlashCommandHighlight(
  text: string,
  commands: readonly SessionSlashCommandViewModel[],
): RecognizedSlashCommand | null {
  return useMemo(
    () => recognizeLeadingSlashCommand(text, commands),
    [text, commands],
  );
}
