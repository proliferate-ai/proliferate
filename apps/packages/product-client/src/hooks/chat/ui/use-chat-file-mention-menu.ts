import { useCallback, useMemo } from "react";
import { useComposerMenuNavigation } from "#product/hooks/chat/ui/use-composer-menu-navigation";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { useWorkspaceFileContext } from "#product/hooks/workspaces/derived/files/use-workspace-file-context";
import { useWorkspaceFileSearch } from "#product/hooks/workspaces/ui/files/use-workspace-file-search";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import {
  rankFileMentionResults,
  type FileMentionResult,
} from "#product/lib/domain/chat/composer/file-mention-search";

/**
 * How many mention rows the menu offers. The menu is a pick-one-fast surface,
 * not a file browser: a short list keeps the panel inside the composer's own
 * overlay height instead of covering the transcript.
 */
const MENTION_RESULT_LIMIT = 8;
/**
 * Raw hits requested from the runtime before basename-first ranking narrows
 * them down. Over-fetching is what lets ranking promote a deep-but-exact
 * basename match above a shallow path-substring hit.
 */
const MENTION_SEARCH_LIMIT = 40;

interface UseChatFileMentionMenuArgs {
  open: boolean;
  query: string;
  onSelect: (result: FileMentionResult) => void;
}

/**
 * Workspace file search for the composer's `@` menu.
 *
 * Reuses the same debounced search path as the command palette
 * (`useWorkspaceFileSearch` → the runtime's file-search query), so mentions and
 * the palette can never disagree about which files exist.
 */
export function useChatFileMentionMenu({
  open,
  query,
  onSelect,
}: UseChatFileMentionMenuArgs) {
  const { materializedWorkspaceId } = useWorkspaceFileContext();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  // Cloud workspaces can only answer file search once their runtime reports
  // ready; local workspaces are always reachable.
  const runtimeReady = parseCloudWorkspaceSyntheticId(materializedWorkspaceId) === null
    ? materializedWorkspaceId !== null
    : selectedCloudRuntime.state?.phase === "ready";

  const search = useWorkspaceFileSearch({
    open,
    workspaceId: materializedWorkspaceId,
    runtimeReady,
    query,
    limit: MENTION_SEARCH_LIMIT,
  });

  const results = useMemo(() => (
    open
      ? rankFileMentionResults(search.results, search.debouncedQuery, MENTION_RESULT_LIMIT)
      : []
  ), [open, search.debouncedQuery, search.results]);

  const navigation = useComposerMenuNavigation({
    open,
    query,
    itemCount: results.length,
  });

  const selectHighlighted = useCallback(() => {
    const result = results[navigation.highlightedIndex];
    if (result) {
      onSelect(result);
    }
  }, [navigation.highlightedIndex, onSelect, results]);

  return {
    results,
    isLoading: search.isLoading,
    isError: search.isError,
    /** True once a query has been typed but no search has been issued yet. */
    isPending: open && query.trim().length > 0 && !search.searchEnabled,
    runtimeReady,
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
