import type { SearchWorkspaceFilesResponse } from "@anyharness/sdk";
import { useSearchWorkspaceFilesQuery } from "@anyharness/sdk-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

const EMPTY_SEARCH_RESULTS: SearchWorkspaceFilesResponse = { results: [] };

interface UseChatFileMentionSearchArgs {
  open: boolean;
  query: string;
  onSelect: (result: SearchWorkspaceFilesResponse["results"][number]) => void;
}

export function useChatFileMentionSearch({
  open,
  query,
  onSelect,
}: UseChatFileMentionSearchArgs) {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) {
      setDebouncedQuery("");
      setHighlightedIndex(0);
      rowRefs.current = [];
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [open, query]);

  const { data: searchResponse = EMPTY_SEARCH_RESULTS, isLoading, isError, error } =
    useSearchWorkspaceFilesQuery({
      workspaceId: selectedWorkspaceId,
      query: debouncedQuery,
      limit: 50,
      enabled: open && !!selectedWorkspaceId,
    });

  const results = searchResponse.results;
  const activeIndex = results.length === 0
    ? 0
    : Math.min(highlightedIndex, results.length - 1);

  useEffect(() => {
    setHighlightedIndex(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [debouncedQuery]);

  const scrollToIndex = useCallback((index: number) => {
    rowRefs.current[index]?.scrollIntoView({ block: "nearest" });
  }, []);

  const moveHighlight = useCallback((delta: number) => {
    if (results.length === 0) {
      return;
    }

    const next = Math.max(0, Math.min(activeIndex + delta, results.length - 1));
    if (next === activeIndex) {
      return;
    }
    setHighlightedIndex(next);
    scrollToIndex(next);
  }, [activeIndex, results.length, scrollToIndex]);

  const selectHighlighted = useCallback(() => {
    const result = results[activeIndex];
    if (result) {
      onSelect(result);
    }
  }, [activeIndex, onSelect, results]);

  const setRowRef = useCallback((index: number, element: HTMLButtonElement | null) => {
    rowRefs.current[index] = element;
  }, []);

  const handleRowMouseEnter = useCallback((index: number) => {
    setHighlightedIndex(index);
  }, []);

  const errorMessage = isError
    ? (error instanceof Error ? error.message : "Failed to search files.")
    : null;

  return {
    results,
    highlightedIndex: activeIndex,
    isLoading,
    isError,
    errorMessage,
    listRef,
    moveHighlight,
    selectHighlighted,
    setRowRef,
    handleRowMouseEnter,
  };
}
