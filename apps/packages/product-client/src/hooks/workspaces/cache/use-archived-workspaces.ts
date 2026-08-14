import type { Workspace } from "@anyharness/sdk";
import { useQuery } from "@tanstack/react-query";
import { archivedWorkspacesKey } from "#product/hooks/workspaces/cache/query-keys";
import { listRuntimeWorkspaces } from "#product/lib/access/anyharness/workspaces";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

interface UseArchivedWorkspacesOptions {
  enabled?: boolean;
}

/**
 * The archived-workspaces list, requested with `lifecycle: "archived"`. This
 * is its own query, not a client-side re-filter of the active collections:
 * the server's lifecycle filter is the single source of truth, and the two
 * lists are disjoint by construction. No hide set, no `showArchived` term.
 */
export function useArchivedWorkspaces(options?: UseArchivedWorkspacesOptions) {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const hasLocalRuntime = runtimeUrl.trim().length > 0;
  const enabled = (options?.enabled ?? true) && hasLocalRuntime;

  return useQuery<Workspace[]>({
    queryKey: archivedWorkspacesKey(runtimeUrl),
    queryFn: async ({ signal }) => {
      const connection = { runtimeUrl };
      return listRuntimeWorkspaces(connection, "archived", { signal });
    },
    enabled,
  });
}
