import type { SearchWorkspaceFilesResponse } from "@anyharness/sdk";
import { useSearchWorkspaceFilesQuery } from "@anyharness/sdk-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { useWorkspaceFileActions } from "@/hooks/editor/use-workspace-file-actions";
import { useHarnessStore } from "@/stores/sessions/harness-store";

const EMPTY_SEARCH_RESULTS: SearchWorkspaceFilesResponse = { results: [] };

interface UseWorkspaceFilePaletteArgs {
  open: boolean;
  onClose: () => void;
}

export interface WorkspaceFilePaletteState {
  query: string;
  setQuery: (query: string) => void;
  highlightedIndex: number;
  results: SearchWorkspaceFilesResponse["results"];
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  handleInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  handleRowMouseEnter: (index: number) => void;
  setRowRef: (index: number, element: HTMLButtonElement | null) => void;
  selectPath: (path: string) => Promise<void>;
  closePalette: () => void;
}

export function useWorkspaceFilePalette({
  open,
  onClose,
}: UseWorkspaceFilePaletteArgs): WorkspaceFilePaletteState {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { openFile } = useWorkspaceFileActions();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [rawHighlightedIndex, setRawHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const { data: searchResponse = EMPTY_SEARCH_RESULTS, isLoading, isError, error } =
    useSearchWorkspaceFilesQuery({
      workspaceId: selectedWorkspaceId,
      query: debouncedQuery,
      limit: 50,
      enabled: open && !!selectedWorkspaceId,
    });
  const results = searchResponse.results;
  const highlightedIndex = results.length === 0
    ? 0
    : Math.min(rawHighlightedIndex, results.length - 1);

  useEffect(() => {
    if (!open) {
      setDebouncedQuery("");
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [open, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setRawHighlightedIndex(0);
      rowRefs.current = [];

      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
      previousFocusRef.current = null;
      return;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    inputRef.current?.focus();
    listRef.current?.scrollTo({ top: 0 });
  }, [open]);

  const scrollToIndex = useCallback((index: number) => {
    if (!open) {
      return;
    }

    rowRefs.current[index]?.scrollIntoView({
      block: "nearest",
    });
  }, [open]);

  const setPaletteQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    setRawHighlightedIndex(0);
    listRef.current?.scrollTo({ top: 0 });
  }, []);

  const selectPath = useCallback(async (path: string) => {
    onClose();
    await openFile(path);
  }, [onClose, openFile]);

  function moveHighlight(delta: number) {
    if (results.length === 0) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(highlightedIndex + delta, results.length - 1));
    if (nextIndex === highlightedIndex) {
      return;
    }

    setRawHighlightedIndex(nextIndex);
    scrollToIndex(nextIndex);
  }

  async function selectHighlighted() {
    const activeResult = results[highlightedIndex];
    if (!activeResult) {
      return;
    }

    await selectPath(activeResult.path);
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void selectHighlighted();
    }
  }

  const handleRowMouseEnter = useCallback((index: number) => {
    setRawHighlightedIndex(index);
    scrollToIndex(index);
  }, [scrollToIndex]);

  const setRowRef = useCallback((index: number, element: HTMLButtonElement | null) => {
    rowRefs.current[index] = element;
  }, []);

  const errorMessage = isError
    ? (error instanceof Error ? error.message : "Failed to search files.")
    : null;

  return {
    query,
    setQuery: setPaletteQuery,
    highlightedIndex,
    results,
    isLoading,
    isError,
    errorMessage,
    inputRef,
    listRef,
    handleInputKeyDown,
    handleRowMouseEnter,
    setRowRef,
    selectPath,
    closePalette: onClose,
  };
}
