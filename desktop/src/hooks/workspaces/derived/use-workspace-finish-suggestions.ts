import type { WorkspaceRetirePreflightResponse } from "@anyharness/sdk";
import { useMemo } from "react";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/cloud/collections";
import { useWorkspaceRetirePreflightQueries } from "@/hooks/access/anyharness/workspaces/use-workspace-retire-preflights";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export interface WorkspaceFinishSuggestion {
  workspaceId: string;
  readinessFingerprint: string;
  preflight: WorkspaceRetirePreflightResponse;
}

const EMPTY_FINISH_SUGGESTIONS: Record<string, WorkspaceFinishSuggestion> = {};

// Owns read-only finish-suggestion state for standard worktree workspaces.
// AnyHarness retire-preflight query shape lives in the access hook.
export function useWorkspaceFinishSuggestions(
  collections: WorkspaceCollections | undefined,
): Record<string, WorkspaceFinishSuggestion> {
  const dismissals = useWorkspaceUiStore((state) => state.finishSuggestionDismissalsByWorkspaceId);
  const workspaces = useMemo(
    () => collections?.localWorkspaces.filter((workspace) =>
      workspace.kind === "worktree"
      && (workspace.surface ?? "standard") === "standard"
      && workspace.lifecycleState !== "retired"
    ) ?? [],
    [collections?.localWorkspaces],
  );
  const workspaceIds = useMemo(
    () => workspaces.map((workspace) => workspace.id),
    [workspaces],
  );
  const queries = useWorkspaceRetirePreflightQueries(workspaceIds);
  const signature = queries.map((query, index) => {
    const preflight = query.data;
    return [
      workspaceIds[index] ?? "",
      preflight?.workspaceId ?? "",
      preflight?.canRetire ? "can" : "no",
      preflight?.mergedIntoBase ? "merged" : "unmerged",
      preflight?.headMatchesBase ? "same" : "different",
      preflight?.readinessFingerprint ?? "",
      preflight ? dismissals[preflight.workspaceId] ?? "" : "",
    ].join("\u001f");
  }).join("\u001e");

  return useMemo(() => {
    const suggestions: Record<string, WorkspaceFinishSuggestion> = {};
    queries.forEach((query, index) => {
      const preflight = query.data;
      if (!preflight?.canRetire || !preflight.mergedIntoBase || preflight.headMatchesBase) {
        return;
      }
      if (dismissals[preflight.workspaceId] === preflight.readinessFingerprint) {
        return;
      }
      const workspace = workspaces[index];
      if (!workspace) {
        return;
      }
      suggestions[preflight.workspaceId] = {
        workspaceId: workspace.id,
        readinessFingerprint: preflight.readinessFingerprint,
        preflight,
      };
    });
    return Object.keys(suggestions).length === 0
      ? EMPTY_FINISH_SUGGESTIONS
      : suggestions;
    // useQueries returns a new wrapper array each render. The signature above
    // captures the fields that affect sidebar finish suggestion rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, workspaces]);
}
