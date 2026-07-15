import { useCallback, useEffect, useRef, useState } from "react";
import { useReadWorkspaceFileMutation } from "@anyharness/sdk-react";

export interface LazyDiffFileLinesResult {
  /** New-side file content split into lines, once fetched successfully */
  fileLines: string[] | undefined;
  /**
   * Trigger the lazy fetch. Undefined when expansion is not possible
   * (disabled scope, missing workspace, or a previous fetch failed) so
   * viewers can degrade gap separators to informational labels.
   */
  requestFileLines: (() => void) | undefined;
}

/**
 * Lazily fetches the current worktree content of a file for diff gap
 * expansion. The fetch fires on the first expander interaction (not
 * eagerly per file), is cached for the component lifetime, and degrades
 * silently on failure (binary/too-large/missing file).
 *
 * Only valid when the diff's NEW side matches the worktree state
 * (unstaged / base_worktree scopes). Callers must gate `enabled` on that.
 */
export function useLazyDiffFileLines({
  workspaceId,
  path,
  enabled,
}: {
  workspaceId: string | null;
  path: string;
  enabled: boolean;
}): LazyDiffFileLinesResult {
  const readFile = useReadWorkspaceFileMutation({ workspaceId });
  const [fileLines, setFileLines] = useState<string[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const requestedPathRef = useRef<string | null>(null);
  const mutateAsync = readFile.mutateAsync;

  // Reset cache when the target file changes (component reuse across files)
  useEffect(() => {
    if (requestedPathRef.current !== null && requestedPathRef.current !== path) {
      requestedPathRef.current = null;
      setFileLines(undefined);
      setFailed(false);
    }
  }, [path]);

  const requestFileLines = useCallback(() => {
    if (requestedPathRef.current === path) return;
    requestedPathRef.current = path;
    mutateAsync({ path })
      .then((response) => {
        if (!response.isText || response.tooLarge || typeof response.content !== "string") {
          setFailed(true);
          return;
        }
        setFileLines(response.content.split("\n"));
      })
      .catch(() => {
        setFailed(true);
      });
  }, [mutateAsync, path]);

  const canRequest = enabled && Boolean(workspaceId) && !failed;

  return {
    fileLines,
    requestFileLines: canRequest ? requestFileLines : undefined,
  };
}
