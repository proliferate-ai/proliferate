import type { WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import { useQuery } from "@tanstack/react-query";
import { getWorkspaceMobilityPreflight } from "@/lib/access/anyharness/mobility";
import { resolveWorkspaceConnection } from "@/lib/access/anyharness/resolve-workspace-connection";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { workspaceMobilityPreflightKey } from "./query-keys";

/**
 * The source-side readiness signal for a workspace move (spec section 1/2.4): active
 * turn / pending interaction, detached head, conflicts, dirty tree, and the estimated
 * archive size. `move-readiness.ts` folds this together with git status into the four
 * readiness outcomes.
 */
export function useWorkspaceMobilityPreflightQuery(
  workspaceId: string | null,
  options: { enabled?: boolean; refetchIntervalMs?: number | false } = {},
) {
  const { enabled = true, refetchIntervalMs = false } = options;
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  return useQuery<WorkspaceMobilityPreflightResponse>({
    queryKey: workspaceMobilityPreflightKey(runtimeUrl, workspaceId ?? ""),
    queryFn: async () => {
      const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId!);
      return getWorkspaceMobilityPreflight(connection, connection.anyharnessWorkspaceId);
    },
    enabled: enabled && workspaceId !== null,
    refetchInterval: refetchIntervalMs,
  });
}
