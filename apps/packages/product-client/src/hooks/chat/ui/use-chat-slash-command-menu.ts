import { useCallback, useMemo } from "react";
import type { AvailableSessionCommand } from "@anyharness/sdk";
import { useActiveSessionTranscript } from "#product/hooks/chat/derived/use-active-session-transcript-state";
import { useComposerMenuNavigation } from "#product/hooks/chat/ui/use-composer-menu-navigation";
import {
  filterDesktopRunnableSessionSlashCommands,
  matchSessionSlashCommandQuery,
  type SessionSlashCommandViewModel,
} from "#product/lib/domain/chat/composer/session-slash-command-policy";

const EMPTY_COMMANDS: readonly SessionSlashCommandViewModel[] = [];

interface UseChatSlashCommandMenuArgs {
  open: boolean;
  query: string;
  onSelect: (command: SessionSlashCommandViewModel) => void;
  /**
   * Overrides the active session's ACP catalog as the raw command source.
   * The home composer injects the persisted per-harness catalog here because
   * no session exists before workspace creation (PRO-228).
   */
  commandsSource?: readonly AvailableSessionCommand[];
}

export function useChatSlashCommandMenu({
  open,
  query,
  onSelect,
  commandsSource,
}: UseChatSlashCommandMenuArgs) {
  const transcript = useActiveSessionTranscript();
  const availableCommands = commandsSource ?? transcript?.availableCommands ?? EMPTY_COMMANDS;

  const commands = useMemo(() => {
    if (!open) {
      return EMPTY_COMMANDS;
    }
    return filterDesktopRunnableSessionSlashCommands(availableCommands)
      .filter((command) => matchSessionSlashCommandQuery(command, query));
  }, [availableCommands, open, query]);

  const navigation = useComposerMenuNavigation({
    open,
    query,
    itemCount: commands.length,
  });

  const selectHighlighted = useCallback(() => {
    const command = commands[navigation.highlightedIndex];
    if (command) {
      onSelect(command);
    }
  }, [commands, navigation.highlightedIndex, onSelect]);

  return {
    commands,
    highlightedIndex: navigation.highlightedIndex,
    listRef: navigation.listRef,
    moveHighlight: navigation.moveHighlight,
    selectHighlighted,
    setRowRef: navigation.setRowRef,
    handleRowMouseEnter: navigation.handleRowMouseEnter,
    getRowId: navigation.getRowId,
    activeDescendantId: navigation.activeDescendantId,
  };
}
