import { useMutation } from "@tanstack/react-query";
import { parseWorkflowDefinition, type WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import { getWorkflow } from "@/lib/access/cloud/workflows";

/**
 * On-demand workflow-definition fetch (spec drill-in Run button): the drill-in
 * view only has the workflow's summary row, not its parsed definition, so
 * fetching + parsing happens right before opening the run-args modal. Wrapped
 * in `useMutation` (imperative `mutateAsync`, no cache read) rather than
 * `useQuery` since this is a one-shot action, not a resource subscription —
 * `WorkflowListRowContainer` already owns the cached per-row detail query for
 * the common (list) path.
 */
export function useWorkflowDefinitionFetch() {
  const mutation = useMutation({
    mutationFn: async (workflowId: string): Promise<WorkflowDefinition | null> => {
      const detail = await getWorkflow(workflowId);
      const raw = detail.currentVersion?.definition;
      return raw ? parseWorkflowDefinition(raw) : null;
    },
  });

  return { fetchDefinition: mutation.mutateAsync };
}
