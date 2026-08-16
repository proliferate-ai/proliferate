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
    // Was a raw 10_000ms literal. Snapped up to `cadence.relaxedMs` (15s).
    // The ADR's own inventory characterizes this as visible staleness — a
    // file the user just edited elsewhere can sit unmarked in the tree for
    // up to one interval — and this snap does add 5s to that window rather
    // than remove it. It is accepted anyway because this indicator already
    // tolerates that staleness class today at the pre-existing 10s value; the
    // extra 5s is a loosening of an already-visible-staleness surface, not the
    // introduction of one, and the ADR ruling forbids snapping down
    // (tightening) to `cadence.standardMs` instead (UX Latency + Transitions
    // ADR §4.7, Rung 6, Q8).
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
