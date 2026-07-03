import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  archiveWorkflow,
  createWorkflow,
  startWorkflowRun,
  updateWorkflow,
  type StartRunRequest,
  type WorkflowCreateRequest,
  type WorkflowDetailResponse,
  type WorkflowResponse,
  type WorkflowRunResponse,
  type WorkflowUpdateRequest,
} from "@/lib/access/cloud/workflows";
import {
  workflowDetailKey,
  workflowRunsKey,
  workflowsRootKey,
} from "./query-keys";

export interface UpdateWorkflowVariables {
  workflowId: string;
  body: WorkflowUpdateRequest;
}

export interface StartRunVariables {
  workflowId: string;
  body: StartRunRequest;
}

export function useWorkflowMutations() {
  const queryClient = useQueryClient();

  const invalidateWorkflow = useCallback(
    async (workflowId?: string) => {
      await queryClient.invalidateQueries({ queryKey: workflowsRootKey() });
      if (!workflowId) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workflowDetailKey(workflowId) }),
        queryClient.invalidateQueries({ queryKey: workflowRunsKey(workflowId) }),
      ]);
    },
    [queryClient],
  );

  const createMutation = useMutation<WorkflowDetailResponse, Error, WorkflowCreateRequest>({
    mutationFn: (body) => createWorkflow(body),
    onSuccess: (detail) => invalidateWorkflow(detail.workflow.id),
  });

  const updateMutation = useMutation<WorkflowDetailResponse, Error, UpdateWorkflowVariables>({
    mutationFn: ({ workflowId, body }) => updateWorkflow(workflowId, body),
    onSuccess: (detail) => invalidateWorkflow(detail.workflow.id),
  });

  const archiveMutation = useMutation<WorkflowResponse, Error, string>({
    mutationFn: (workflowId) => archiveWorkflow(workflowId),
    onSuccess: (workflow) => invalidateWorkflow(workflow.id),
  });

  const startRunMutation = useMutation<WorkflowRunResponse, Error, StartRunVariables>({
    mutationFn: ({ workflowId, body }) => startWorkflowRun(workflowId, body),
    onSuccess: (run) => invalidateWorkflow(run.workflowId),
  });

  return { createMutation, updateMutation, archiveMutation, startRunMutation, invalidateWorkflow };
}
