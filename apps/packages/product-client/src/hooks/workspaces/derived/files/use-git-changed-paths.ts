import { useMemo } from "react";
import { useGitStatusQuery } from "@anyharness/sdk-react";
import { cadence } from "@proliferate/design/cadence";

/**
 * Returns a Set of file paths that have been modified according to git status.
 * Used by the file tree sidebar to show change indicators.
 */
export function useGitChangedPaths(workspaceId: string | null): Set<string> | undefined {
  const gitStatus = useGitStatusQuery({
    workspaceId: workspaceId ?? undefined,
    enabled: Boolean(workspaceId),
    // Was a raw 10_000ms literal. Snapped up to `cadence.relaxedMs` (15s):
    // this is a background visual change-indicator in the file tree, not a
    // correctness-critical read, so the extra 5s is inconsequential; the ADR
    // ruling forbids snapping down (tightening) to `cadence.standardMs`
    // (UX Latency + Transitions ADR §4.7, Rung 6, Q8).
    refetchInterval: cadence.relaxedMs,
  });

  return useMemo(() => {
    const files = gitStatus.data?.files;
    if (!files || files.length === 0) {
      return undefined;
    }
    return new Set(files.map((f) => f.path));
  }, [gitStatus.data?.files]);
}
