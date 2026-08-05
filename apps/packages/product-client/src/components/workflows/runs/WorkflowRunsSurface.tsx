import type { ManagedWorkflowOpenTarget } from "@proliferate/cloud-sdk";
import type { WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import { WorkflowRunDetail } from "#product/components/workflows/WorkflowRunDetail";
import { WorkflowRunForm } from "#product/components/workflows/WorkflowRunForm";
import { WorkflowRunList } from "#product/components/workflows/WorkflowRunList";
import { useWorkflowRunDetailActions } from "#product/hooks/workflows/workflows/use-workflow-run-detail-actions";
import { useWorkflowRunLaunchActions } from "#product/hooks/workflows/workflows/use-workflow-run-launch-actions";
import type { WorkflowRunOpenResult } from "#product/lib/domain/workflows/workflow-run-state";
import { WorkflowResourceState } from "../WorkflowResourceState";

export interface WorkflowDefinitionRunsPanelProps {
  authCacheScope: string;
  definition: WorkflowDefinition;
  managedRunsEnabled: boolean;
  onOpenRun: (runId: string) => void;
}

export function WorkflowDefinitionRunsPanel({
  authCacheScope,
  definition,
  managedRunsEnabled,
  onOpenRun,
}: WorkflowDefinitionRunsPanelProps) {
  const actions = useWorkflowRunLaunchActions({
    authCacheScope,
    definition,
    managedRunsEnabled,
    onOpenRun,
  });

  return (
    <div className="mt-6 space-y-4">
      <WorkflowRunForm
        inputs={actions.inputs}
        draft={actions.draft}
        issues={actions.issues}
        blockers={actions.blockers}
        requiredForRunInputNames={actions.requiredForRunInputNames}
        capabilityEnabled={actions.capabilityEnabled}
        launchBlocked={actions.launchBlocked}
        submitting={actions.submitting}
        serverError={actions.serverError}
        attemptMessage={actions.attemptMessage}
        onChange={actions.onChange}
        onSubmit={actions.onSubmit}
        onRetryAttempt={actions.onRetryAttempt}
      />
      <WorkflowRunList
        runs={actions.runs}
        loading={actions.historyLoading}
        error={actions.historyError}
        hasMore={actions.hasMore}
        loadingMore={actions.loadingMore}
        onSelect={actions.onSelectRun}
        onLoadMore={actions.onLoadMore}
        onRetry={actions.onRetryHistory}
      />
    </div>
  );
}

export interface WorkflowRunsSurfaceProps {
  authCacheScope: string;
  workflowDefinitionId: string;
  runId: string;
  managedRunsEnabled: boolean;
  onBack: () => void;
  onOpenSession: (target: ManagedWorkflowOpenTarget) => Promise<WorkflowRunOpenResult>;
}

export function WorkflowRunsSurface({
  authCacheScope,
  workflowDefinitionId,
  runId,
  managedRunsEnabled,
  onBack,
  onOpenSession,
}: WorkflowRunsSurfaceProps) {
  const actions = useWorkflowRunDetailActions({
    authCacheScope,
    workflowDefinitionId,
    runId,
    managedRunsEnabled,
    onOpenSession,
  });

  if (actions.kind === "loading") {
    return (
      <WorkflowResourceState
        loading
        title="Loading run"
        description="Loading the current managed status."
        onBack={onBack}
      />
    );
  }
  if (actions.kind === "not-found") {
    return (
      <WorkflowResourceState
        title="Run not found"
        description="It may have been deleted or you may not have access."
        onBack={onBack}
        onRetry={actions.refresh}
      />
    );
  }
  if (actions.kind === "unavailable") {
    return (
      <WorkflowResourceState
        title="Run unavailable"
        description="The current managed status could not be loaded. Try again."
        onBack={onBack}
        onRetry={actions.refresh}
      />
    );
  }

  return (
    <WorkflowRunDetail
      run={actions.run}
      presentation={actions.presentation}
      deliveryCapabilityEnabled={actions.deliveryCapabilityEnabled}
      busy={actions.busy}
      actionError={actions.actionError}
      openSessionUnavailable={actions.openSessionUnavailable}
      onBack={onBack}
      onRefresh={actions.refresh}
      onStartDelivery={actions.startDelivery}
      onCancel={actions.cancel}
      onOpenSession={actions.openSession}
    />
  );
}
