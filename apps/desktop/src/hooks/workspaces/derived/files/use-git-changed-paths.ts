import { useMemo } from "react";
import { useGitStatusQuery } from "@anyharness/sdk-react";

/**
 * Returns a Set of file paths that have been modified according to git status.
 * Used by the file tree sidebar to show change indicators.
 */
export function useGitChangedPaths(workspaceId: string | null): Set<string> | undefined {
  const gitStatus = useGitStatusQuery({
    workspaceId: workspaceId ?? undefined,
    enabled: Boolean(workspaceId),
    refetchInterval: 10_000,
  });

  return useMemo(() => {
    const files = gitStatus.data?.files;
    if (!files || files.length === 0) {
      return undefined;
    }
    return new Set(files.map((f) => f.path));
  }, [gitStatus.data?.files]);
}
