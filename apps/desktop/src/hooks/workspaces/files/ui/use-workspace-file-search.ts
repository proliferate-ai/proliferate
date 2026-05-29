import { useEffect, useMemo, useState } from "react";
import { useSearchWorkspaceFilesQuery } from "@anyharness/sdk-react";

const EMPTY_FILE_RESULTS: WorkspaceFileSearchResult[] = [];

interface WorkspaceFileSearchResult {
  path: string;
  name: string;
}

interface UseWorkspaceFileSearchArgs {
  open: boolean;
  workspaceId: string | null;
  runtimeReady: boolean;
  query: string;
  limit?: number;
}

// Owns debounced workspace file path search state for palette-style surfaces.
export function useWorkspaceFileSearch({
  open,
  workspaceId,
  runtimeReady,
  query,
  limit = 50,
}: UseWorkspaceFileSearchArgs) {
  const trimmedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    if (!open || trimmedQuery.length === 0 || !runtimeReady) {
      setDebouncedQuery("");
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(trimmedQuery);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [open, runtimeReady, trimmedQuery]);

  const searchEnabled =
    open
    && runtimeReady
    && workspaceId !== null
    && debouncedQuery.length > 0;

  const queryResult = useSearchWorkspaceFilesQuery({
    workspaceId,
    query: debouncedQuery,
    limit,
    enabled: searchEnabled,
  });

  const results = useMemo<WorkspaceFileSearchResult[]>(() => {
    if (!searchEnabled) {
      return EMPTY_FILE_RESULTS;
    }
    return queryResult.data?.results ?? EMPTY_FILE_RESULTS;
  }, [queryResult.data?.results, searchEnabled]);

  return {
    query: trimmedQuery,
    debouncedQuery,
    searchEnabled,
    isLoading: searchEnabled && queryResult.isLoading,
    isError: searchEnabled && queryResult.isError,
    results,
  };
}
