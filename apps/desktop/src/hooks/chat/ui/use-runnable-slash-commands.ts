import { useMemo } from "react";
import { useActiveSessionTranscript } from "@/hooks/chat/derived/use-active-session-transcript-state";
import {
  filterDesktopRunnableSessionSlashCommands,
  type SessionSlashCommandViewModel,
} from "@/lib/domain/chat/composer/session-slash-command-policy";

const EMPTY: readonly SessionSlashCommandViewModel[] = [];

/**
 * Returns the full list of desktop-runnable slash commands for the active
 * session. Stable reference between renders unless the session's available
 * commands actually change.
 */
export function useRunnableSlashCommands(): readonly SessionSlashCommandViewModel[] {
  const transcript = useActiveSessionTranscript();
  const raw = transcript?.availableCommands ?? EMPTY;
  return useMemo(() => filterDesktopRunnableSessionSlashCommands(raw), [raw]);
}
