import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import type { WorkflowTargetMode } from "@proliferate/product-domain/workflows/model";
import {
  deriveLastUsedTarget,
  type WorkflowRunTargetRecord,
} from "@proliferate/product-domain/workflows/run-launch";
import { ProliferateClientError } from "@/lib/access/cloud/client";
import { useWorkflowRuns } from "@/hooks/access/cloud/workflows/use-workflows";
import { useLaunchWorkflowRun } from "@/hooks/access/cloud/workflows/use-launch-workflow-run";
import { useCloudRunTargetWorkspaces } from "@/hooks/access/cloud/workspaces/use-cloud-run-target-workspaces";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useWorkflowRunPillStore } from "@/stores/workflows/workflow-run-pill-store";
import type { WorkflowResponse } from "@/hooks/access/cloud/workflows/types";
import {
  WorkflowRunArgsModal,
  type WorkflowRunSubmit,
  type WorkflowRunTargetOption,
} from "@/components/workflows/home/WorkflowRunArgsModal";

// Mirrors gateway_grants.py's L22 fail-fast code (see WorkflowsHomeScreen).
const FUNCTION_PROVIDER_NOT_READY_CODE = "workflow_function_provider_not_ready";

interface LauncherState {
  workflow: WorkflowResponse;
  definition: WorkflowDefinition;
}

export interface WorkflowRunLauncher {
  /** Open the launch modal for a workflow (any of the R1 doors). */
  open: (workflow: WorkflowResponse, definition: WorkflowDefinition) => void;
  /** The modal element — render it once wherever the launcher is used. */
  modal: ReactNode;
  isPending: boolean;
}

/**
 * Shared launch controller behind all three run-from-chat doors (spec R1). Owns
 * the launch modal, run-target options, R6 last-used prefill, session bindings,
 * and the R2 stay-put run pill. Callers just `open(...)` and render `modal`.
 */
export function useWorkflowRunLauncher(): WorkflowRunLauncher {
  const navigate = useNavigate();
  const [state, setState] = useState<LauncherState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const runsQuery = useWorkflowRuns(null);
  const workspacesQuery = useWorkspaces();
  const cloudTargetsQuery = useCloudRunTargetWorkspaces();
  const launchMutation = useLaunchWorkflowRun();
  const showRunPill = useWorkflowRunPillStore((store) => store.show);

  const runs = runsQuery.data?.runs ?? [];

  const localWorkspaceOptions = useMemo<WorkflowRunTargetOption[]>(
    () =>
      (workspacesQuery.data?.localWorkspaces ?? []).map((workspace) => ({
        id: workspace.id,
        label: workspace.displayName || workspace.currentBranch || workspace.path,
      })),
    [workspacesQuery.data],
  );
  const cloudWorkspaceOptions = useMemo<WorkflowRunTargetOption[]>(
    () =>
      (cloudTargetsQuery.data ?? [])
        .filter((workspace) => workspace.status === "ready")
        .map((workspace) => ({
          id: workspace.id,
          label: workspace.displayName ?? workspace.repo.branch,
        })),
    [cloudTargetsQuery.data],
  );

  const runTargetRecords = useMemo<WorkflowRunTargetRecord[]>(
    () =>
      runs.map((run) => ({
        workflowId: run.workflowId,
        createdAt: run.startedAt ?? run.createdAt,
        targetMode: (run.targetMode as WorkflowTargetMode) ?? "local",
        workspaceId: run.anyharnessWorkspaceId,
      })),
    [runs],
  );

  const open = (workflow: WorkflowResponse, definition: WorkflowDefinition) => {
    setError(null);
    setErrorCode(null);
    setState({ workflow, definition });
  };

  const runNow = (workflow: WorkflowResponse, submit: WorkflowRunSubmit) => {
    setError(null);
    setErrorCode(null);
    launchMutation.mutate(
      {
        workflowId: workflow.id,
        args: submit.args,
        targetMode: submit.targetMode,
        localWorkspaceId: submit.localWorkspaceId,
        cloudWorkspaceId: submit.cloudWorkspaceId,
        sessionBindings: submit.sessionBindings,
      },
      {
        onSuccess: (run) => {
          setState(null);
          showRunPill({ runId: run.id, workflowId: workflow.id, workflowName: workflow.name });
        },
        onError: (launchError) => {
          setError(launchError.message);
          setErrorCode(launchError instanceof ProliferateClientError ? launchError.code : null);
        },
      },
    );
  };

  const modal = state
    ? (() => {
        const lastUsed = deriveLastUsedTarget(runTargetRecords, state.workflow.id);
        return (
          <WorkflowRunArgsModal
            open
            workflowName={state.workflow.name}
            args={state.definition.inputs}
            slots={state.definition.agents.map((agent) => ({
              slot: agent.slot,
              harness: agent.harness,
              model: agent.model,
            }))}
            localWorkspaces={localWorkspaceOptions}
            cloudWorkspaces={cloudWorkspaceOptions}
            defaultTargetMode={lastUsed?.targetMode ?? null}
            defaultLocalWorkspaceId={
              lastUsed?.targetMode === "local" ? lastUsed.workspaceId : null
            }
            defaultCloudWorkspaceId={
              lastUsed?.targetMode === "personal_cloud" ? lastUsed.workspaceId : null
            }
            hasIntegrations={state.definition.integrations.length > 0}
            busy={launchMutation.isPending}
            error={error}
            onOpenIntegrationsSettings={
              errorCode === FUNCTION_PROVIDER_NOT_READY_CODE
                ? () => navigate("/settings?section=integrations")
                : undefined
            }
            onClose={() => setState(null)}
            onSubmit={(submit) => runNow(state.workflow, submit)}
          />
        );
      })()
    : null;

  return { open, modal, isPending: launchMutation.isPending };
}
