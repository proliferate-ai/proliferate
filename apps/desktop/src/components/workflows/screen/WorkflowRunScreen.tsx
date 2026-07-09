import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import {
  coerceRunStatus,
  isTerminalRunStatus,
} from "@proliferate/product-domain/workflows/run-status";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Spinner } from "@proliferate/ui/primitives/Spinner";
import { useWorkflowDetail, useWorkflowRun } from "@/hooks/access/cloud/workflows/use-workflows";
import { useCloudRunRefreshPoll } from "@/hooks/access/cloud/workflows/use-cloud-run-refresh";
import { useResolveWorkflowApproval } from "@/hooks/access/cloud/workflows/use-workflow-approval";
import { useCancelWorkflowRun } from "@/hooks/access/cloud/workflows/use-cancel-workflow-run";
import { WorkflowRunView } from "../run/WorkflowRunView";
import { WorkflowMissedRunSummary } from "../run/WorkflowMissedRunSummary";

export interface WorkflowRunScreenProps {
  workflowId: string;
  runId: string;
}

export function WorkflowRunScreen({ workflowId, runId }: WorkflowRunScreenProps) {
  const navigate = useNavigate();
  const runQuery = useWorkflowRun(runId);
  const detailQuery = useWorkflowDetail(workflowId);
  const approvalMutation = useResolveWorkflowApproval();
  const cancelMutation = useCancelWorkflowRun();

  const run = runQuery.data?.run ?? null;
  const stepActions = runQuery.data?.stepActions ?? [];
  const workflowName = detailQuery.data?.workflow.name ?? null;

  const isCloudRun = run?.targetMode === "personal_cloud";
  const isLocalRun = run?.targetMode === "local";
  const terminal = run ? isTerminalRunStatus(coerceRunStatus(run.status)) : false;
  // 1c: a `missed` row never delivered a plan (resolved_plan is empty) — it has
  // no step timeline to render, so it gets its own quiet summary below instead
  // of going through WorkflowRunView's definition/timeline path at all.
  const isMissed = run?.status === "missed";

  // Cloud runs have no push channel — poll the refresh endpoint while non-terminal
  // (local runs stay fresh via the desktop relay writing the server /status).
  useCloudRunRefreshPoll(runId, Boolean(isCloudRun) && !terminal);

  // The resolved plan carried by the run IS the (interpolated) definition, so
  // the timeline needs no separate version fetch.
  const definition = useMemo<WorkflowDefinition | null>(
    () => (run && !isMissed ? parseWorkflowDefinition(run.resolvedPlan) : null),
    [run, isMissed],
  );

  return (
    <MainSidebarPageShell>
      <div className="mx-auto flex h-full w-full min-w-0 max-w-3xl flex-col overflow-y-auto px-8 pb-16 pt-10">
        {runQuery.isLoading && !run ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Spinner />
          </div>
        ) : runQuery.isError || run === null ? (
          <EmptyState
            title="Run not found"
            description="This run may have been removed or is not accessible."
          />
        ) : isMissed ? (
          <WorkflowMissedRunSummary
            run={run}
            workflowName={workflowName}
            onBack={() => navigate("/workflows")}
          />
        ) : definition === null ? (
          <EmptyState
            title="Run not found"
            description="This run may have been removed or is not accessible."
          />
        ) : (
          <WorkflowRunView
            run={run}
            stepActions={stepActions}
            definition={definition}
            workflowName={workflowName}
            approvalEnabled={isLocalRun}
            approvalBusy={approvalMutation.isPending}
            onApprove={() => approvalMutation.mutate({ runId, approve: true })}
            onDeny={() => approvalMutation.mutate({ runId, approve: false })}
            onCancel={() => cancelMutation.mutate({ runId })}
            cancelBusy={cancelMutation.isPending}
            onBack={() => navigate("/workflows")}
            onOpenSession={(link) => {
              if (link.workspaceId) {
                navigate(`/workspaces/${link.workspaceId}`);
              }
            }}
          />
        )}
      </div>
    </MainSidebarPageShell>
  );
}
