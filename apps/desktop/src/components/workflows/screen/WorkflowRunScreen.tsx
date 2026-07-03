import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Spinner } from "@proliferate/ui/primitives/Spinner";
import { useWorkflowDetail, useWorkflowRun } from "@/hooks/access/cloud/workflows/use-workflows";
import { WorkflowRunView } from "../run/WorkflowRunView";

export interface WorkflowRunScreenProps {
  workflowId: string;
  runId: string;
}

export function WorkflowRunScreen({ workflowId, runId }: WorkflowRunScreenProps) {
  const navigate = useNavigate();
  const runQuery = useWorkflowRun(runId);
  const detailQuery = useWorkflowDetail(workflowId);

  const run = runQuery.data ?? null;
  const workflowName = detailQuery.data?.workflow.name ?? null;

  // The resolved plan carried by the run IS the (interpolated) definition, so
  // the timeline needs no separate version fetch.
  const definition = useMemo<WorkflowDefinition | null>(
    () => (run ? parseWorkflowDefinition(run.resolvedPlan) : null),
    [run],
  );

  return (
    <MainSidebarPageShell>
      <div className="mx-auto flex h-full w-full min-w-0 max-w-3xl flex-col overflow-y-auto px-8 pb-16 pt-10">
        {runQuery.isLoading && !run ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Spinner />
          </div>
        ) : runQuery.isError || run === null || definition === null ? (
          <EmptyState
            title="Run not found"
            description="This run may have been removed or is not accessible."
          />
        ) : (
          <WorkflowRunView
            run={run}
            definition={definition}
            workflowName={workflowName}
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
