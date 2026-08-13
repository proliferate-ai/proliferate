import { useCallback, useMemo } from "react";
import { CHAT_FILE_MENTION_SEARCH_LIMIT } from "#product/config/chat";
import { useComposerMenuNavigation } from "#product/hooks/chat/ui/use-composer-menu-navigation";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { useWorkspaceFileContext } from "#product/hooks/workspaces/derived/files/use-workspace-file-context";
import { useWorkspaceFileSearch } from "#product/hooks/workspaces/ui/files/use-workspace-file-search";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import {
  rankFileMentionResults,
  type FileMentionResult,
} from "#product/lib/domain/chat/composer/file-mention-search";

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
    limit: CHAT_FILE_MENTION_SEARCH_LIMIT,
  });
  const resultsAreCurrent = search.debouncedQuery === search.query
    && !search.isPlaceholderData;

  const results = useMemo(() => (
    open && resultsAreCurrent
      ? rankFileMentionResults(
          search.results,
          search.debouncedQuery,
          CHAT_FILE_MENTION_SEARCH_LIMIT,
        )
      : []
  ), [open, resultsAreCurrent, search.debouncedQuery, search.results]);

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
    /** True while the current token is waiting for its own result page. */
    isPending: open && search.query.length > 0 && (!search.searchEnabled || !resultsAreCurrent),
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
