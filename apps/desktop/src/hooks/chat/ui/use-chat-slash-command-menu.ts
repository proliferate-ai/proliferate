import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveSessionTranscript } from "@/hooks/chat/derived/use-active-session-transcript-state";
import {
  filterDesktopRunnableSessionSlashCommands,
  matchSessionSlashCommandQuery,
  type SessionSlashCommandViewModel,
} from "@/lib/domain/chat/composer/session-slash-command-policy";

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
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const commands = useMemo(() => {
    if (!open) {
      return EMPTY_COMMANDS;
    }
    return filterDesktopRunnableSessionSlashCommands(availableCommands)
      .filter((command) => matchSessionSlashCommandQuery(command, query));
  }, [availableCommands, open, query]);

  const activeIndex = commands.length === 0
    ? 0
    : Math.min(highlightedIndex, commands.length - 1);

  useEffect(() => {
    if (!open) {
      rowRefs.current = [];
    }
    setHighlightedIndex(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [open, query, commands.length]);

  const scrollToIndex = useCallback((index: number) => {
    rowRefs.current[index]?.scrollIntoView({ block: "nearest" });
  }, []);

  const moveHighlight = useCallback((delta: number) => {
    if (commands.length === 0) {
      return;
    }

    const next = Math.max(0, Math.min(activeIndex + delta, commands.length - 1));
    if (next === activeIndex) {
      return;
    }
    setHighlightedIndex(next);
    scrollToIndex(next);
  }, [activeIndex, commands.length, scrollToIndex]);

  const selectHighlighted = useCallback(() => {
    const command = commands[activeIndex];
    if (command) {
      onSelect(command);
    }
  }, [activeIndex, commands, onSelect]);

  const setRowRef = useCallback((index: number, element: HTMLButtonElement | null) => {
    rowRefs.current[index] = element;
  }, []);

  const handleRowMouseEnter = useCallback((index: number) => {
    setHighlightedIndex(index);
  }, []);

  return {
    commands,
    highlightedIndex: activeIndex,
    listRef,
    moveHighlight,
    selectHighlighted,
    setRowRef,
    handleRowMouseEnter,
  };
}
