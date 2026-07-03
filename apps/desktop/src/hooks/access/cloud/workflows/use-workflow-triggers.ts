import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// Side-effect: registers the auth-aware desktop cloud client factory.
import "@/lib/access/cloud/client";
import {
  createWorkflowTrigger,
  deleteWorkflowTrigger,
  listWorkflowTriggers,
  updateWorkflowTrigger,
  type WorkflowTriggerCreateRequest,
  type WorkflowTriggerResponse,
  type WorkflowTriggerUpdateRequest,
} from "@/lib/access/cloud/workflows";
import { workflowTriggersKey } from "./query-keys";

/** Schedule triggers for a workflow (spec 3.5). */
export function useWorkflowTriggers(workflowId: string | null) {
  return useQuery<WorkflowTriggerResponse[]>({
    queryKey: workflowTriggersKey(workflowId),
    enabled: Boolean(workflowId),
    queryFn: async () => {
      const { triggers } = await listWorkflowTriggers(workflowId!);
      return triggers;
    },
  });
}

export interface UpdateTriggerVariables {
  triggerId: string;
  body: WorkflowTriggerUpdateRequest;
}

/** Create / update / delete mutations for a workflow's triggers. */
export function useWorkflowTriggerMutations(workflowId: string) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: workflowTriggersKey(workflowId) });

  const createMutation = useMutation<WorkflowTriggerResponse, Error, WorkflowTriggerCreateRequest>({
    mutationFn: (body) => createWorkflowTrigger(workflowId, body),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation<WorkflowTriggerResponse, Error, UpdateTriggerVariables>({
    mutationFn: ({ triggerId, body }) => updateWorkflowTrigger(workflowId, triggerId, body),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: (triggerId) => deleteWorkflowTrigger(workflowId, triggerId),
    onSuccess: invalidate,
  });

  return { createMutation, updateMutation, deleteMutation };
}
