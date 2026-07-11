import { useQuery } from "@tanstack/react-query";
// Side-effect: registers the auth-aware desktop cloud client factory.
import "@/lib/access/cloud/client";
import { listWorkflowTriggerItems } from "@/lib/access/cloud/workflows";
import type { WorkflowTriggerItemResponse } from "./types";
import { workflowTriggerItemsKey } from "./query-keys";

/**
 * A poll trigger's per-item seen-set (spec 8.2 row B, spec 1.3): the
 * spawned/invalid/error outcome for every item id the poller has ever seen,
 * newest first. Only meaningful for `kind: "poll"` triggers; pass `enabled`
 * so the request only fires once the item drawer is actually opened.
 */
export function useWorkflowTriggerItems(
  workflowId: string | null,
  triggerId: string | null,
  enabled: boolean,
) {
  return useQuery<WorkflowTriggerItemResponse[]>({
    queryKey: workflowTriggerItemsKey(workflowId, triggerId),
    enabled: enabled && Boolean(workflowId) && Boolean(triggerId),
    queryFn: async () => {
      const { items } = await listWorkflowTriggerItems(workflowId!, triggerId!, { limit: 50 });
      return items;
    },
  });
}
