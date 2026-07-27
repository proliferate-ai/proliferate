import { useCallback, useMemo } from "react";
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
}

export function useChatSlashCommandMenu({
  open,
  query,
  onSelect,
}: UseChatSlashCommandMenuArgs) {
  const transcript = useActiveSessionTranscript();
  const availableCommands = transcript?.availableCommands ?? EMPTY_COMMANDS;

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
  };
}
