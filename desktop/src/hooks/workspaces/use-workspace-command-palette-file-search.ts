import { useEffect, useMemo, useState } from "react";
import { useSearchWorkspaceFilesQuery } from "@anyharness/sdk-react";

const EMPTY_FILE_RESULTS: Array<{ path: string; name: string }> = [];

export interface CommandPaletteFileSearchResult {
  path: string;
  name: string;
}

interface UseWorkspaceCommandPaletteFileSearchArgs {
  open: boolean;
  selectedWorkspaceId: string | null;
  hasRuntimeReadyWorkspace: boolean;
  query: string;
}

export function useWorkspaceCommandPaletteFileSearch({
  open,
  selectedWorkspaceId,
  hasRuntimeReadyWorkspace,
  query,
}: UseWorkspaceCommandPaletteFileSearchArgs) {
  const trimmedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    if (!open || trimmedQuery.length === 0 || !hasRuntimeReadyWorkspace) {
      setDebouncedQuery("");
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(trimmedQuery);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [hasRuntimeReadyWorkspace, open, trimmedQuery]);

  const searchEnabled = open
    && hasRuntimeReadyWorkspace
    && selectedWorkspaceId !== null
    && debouncedQuery.length > 0;

  const queryResult = useSearchWorkspaceFilesQuery({
    workspaceId: selectedWorkspaceId,
    query: debouncedQuery,
    limit: 50,
    enabled: searchEnabled,
  });

  const results = useMemo<CommandPaletteFileSearchResult[]>(() => {
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
