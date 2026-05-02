import type { WorkspaceRetirePreflightResponse } from "@anyharness/sdk";
import {
  anyHarnessWorkspaceRetirePreflightKey,
  getAnyHarnessClient,
} from "@anyharness/sdk-react";
import { useQueries } from "@tanstack/react-query";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/collections";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export interface WorkspaceFinishSuggestion {
  workspaceId: string;
  readinessFingerprint: string;
  preflight: WorkspaceRetirePreflightResponse;
}

export function useWorkspaceFinishSuggestions(
  collections: WorkspaceCollections | undefined,
): Record<string, WorkspaceFinishSuggestion> {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const dismissals = useWorkspaceUiStore((state) => state.finishSuggestionDismissalsByWorkspaceId);
  const workspaces = collections?.localWorkspaces.filter((workspace) =>
    workspace.kind === "worktree"
    && (workspace.surface ?? "standard") === "standard"
    && workspace.lifecycleState !== "retired"
  ) ?? [];

  const queries = useQueries({
    queries: workspaces.map((workspace) => ({
      queryKey: anyHarnessWorkspaceRetirePreflightKey(runtimeUrl, workspace.id),
      enabled: runtimeUrl.trim().length > 0,
      staleTime: 60_000,
      queryFn: async () => {
        const client = getAnyHarnessClient({ runtimeUrl });
        return client.workspaces.retirePreflight(workspace.id);
      },
    })),
  });

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
