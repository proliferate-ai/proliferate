import type { WorkspaceRetirePreflightResponse } from "@anyharness/sdk";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/cloud/collections";
import { useWorkspaceRetirePreflightQueries } from "@/hooks/access/anyharness/workspaces/use-workspace-retire-preflights";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export interface WorkspaceFinishSuggestion {
  workspaceId: string;
  readinessFingerprint: string;
  preflight: WorkspaceRetirePreflightResponse;
}

// Owns read-only finish-suggestion state for standard worktree workspaces.
// AnyHarness retire-preflight query shape lives in the access hook.
export function useWorkspaceFinishSuggestions(
  collections: WorkspaceCollections | undefined,
): Record<string, WorkspaceFinishSuggestion> {
  const dismissals = useWorkspaceUiStore((state) => state.finishSuggestionDismissalsByWorkspaceId);
  const workspaces = collections?.localWorkspaces.filter((workspace) =>
    workspace.kind === "worktree"
    && (workspace.surface ?? "standard") === "standard"
    && workspace.lifecycleState !== "retired"
  ) ?? [];
  const queries = useWorkspaceRetirePreflightQueries(workspaces.map((workspace) => workspace.id));

  const suggestions: Record<string, WorkspaceFinishSuggestion> = {};
  queries.forEach((query, index) => {
    const preflight = query.data;
    if (!preflight?.canRetire || !preflight.mergedIntoBase || preflight.headMatchesBase) {
      return;
    }
    if (dismissals[preflight.workspaceId] === preflight.readinessFingerprint) {
      return;
    }
    suggestions[preflight.workspaceId] = {
      workspaceId: workspaces[index].id,
      readinessFingerprint: preflight.readinessFingerprint,
      preflight,
    };
  });
  return suggestions;
}
