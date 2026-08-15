import type { WorkflowRunV2 } from "@anyharness/sdk";
import { Button } from "#product/primitives/Button";
import { Spinner } from "#product/primitives/Spinner";
import { StatusDot } from "#product/primitives/StatusDot";
import { Workflow } from "#product/primitives/icons/product";
import { EmptyState } from "#product/primitives/patterns/EmptyState";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { PaneHeader } from "#product/components/workspace/pane/PaneHeader";
import { workflowRunStatusDotTone } from "#product/components/workflows/workflow-run-status-dot";
import { WorkflowDocsList } from "#product/components/workflows/run-view/WorkflowDocsList";
import { WorkflowGraphView } from "#product/components/workflows/run-view/WorkflowGraphView";
import { WORKFLOW_RUN_VIEW_COPY } from "#product/copy/workflows/workflow-run-view-copy";
import { workflowRunStatusTone } from "#product/domain/workflows/run-view-model";
import { useWorkflowPane } from "#product/hooks/workflows/facade/use-workflow-pane";
import { useWorkflowDocOpen } from "#product/hooks/workflows/ui/use-workflow-doc-open";

/**
 * The run's own state on the pane header: status dot plus label, the same
 * treatment the design's run header wears. Renders nothing while the pane has
 * no run, and nothing for a status this build has no words for (a newer
 * runtime's status stays a silent dot-less header, never an invented label).
 */
function WorkflowRunStatusChip({ run }: { run: WorkflowRunV2 | null }) {
  if (!run) {
    return null;
  }
  const label = WORKFLOW_RUN_VIEW_COPY.runStatusLabel(run.status);
  if (!label) {
    return null;
  }
  return (
    <span className="flex items-center gap-1.5 px-1 text-ui-sm text-muted-foreground">
      <StatusDot tone={workflowRunStatusDotTone(workflowRunStatusTone(run.status))} />
      {label}
    </span>
  );
}

/**
 * The Workflows gen-2 run view, as the workspace's right-panel pane: the
 * resume banner when the run is parked, the chain of node cards (every
 * attempt visible, ad hoc side nodes subordinate to the slot they hang off),
 * and the documents the run has produced.
 *
 * Every control on a card comes from `workflowNodeControls`, so this file
 * decides nothing about what is legal — it only routes the callbacks the
 * facade owns.
 */
export function WorkflowPane({ workspaceId }: { workspaceId: string }) {
  const pane = useWorkflowPane({ workspaceId });
  const openDoc = useWorkflowDocOpen(workspaceId);

  return (
    <section
      aria-label={WORKFLOW_RUN_VIEW_COPY.paneTitle}
      aria-busy={pane.status === "loading"}
      // Ground and ink come from `RightPanelFrame`, exactly as the sibling
      // Agents pane inherits them; the pane paints no surface of its own.
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      <PaneHeader
        left={(
          <div className="flex min-w-0 items-center px-1">
            <span className="truncate text-message font-medium text-sidebar-foreground">
              {WORKFLOW_RUN_VIEW_COPY.paneTitle}
            </span>
          </div>
        )}
        right={<WorkflowRunStatusChip run={pane.run} />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {pane.status === "loading" ? (
          <div
            role="status"
            className="flex h-full items-center justify-center gap-2 text-ui text-muted-foreground"
          >
            <Spinner className="icon-compact" />
            {WORKFLOW_RUN_VIEW_COPY.loading}
          </div>
        ) : pane.status === "error" ? (
          <NoticeBanner
            tone="destructive"
            icon={<Workflow />}
            title={WORKFLOW_RUN_VIEW_COPY.errorTitle}
          >
            {WORKFLOW_RUN_VIEW_COPY.errorDescription}
          </NoticeBanner>
        ) : pane.status === "empty" ? (
          <EmptyState
            title={WORKFLOW_RUN_VIEW_COPY.emptyTitle}
            description={WORKFLOW_RUN_VIEW_COPY.emptyDescription}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {pane.interrupted ? (
              <NoticeBanner
                tone="warning"
                icon={<Workflow />}
                title={WORKFLOW_RUN_VIEW_COPY.resumeTitle}
                action={(
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pane.busy}
                    onClick={pane.actions.resume}
                  >
                    {WORKFLOW_RUN_VIEW_COPY.resumeAction}
                  </Button>
                )}
              >
                {WORKFLOW_RUN_VIEW_COPY.resumeBody}
              </NoticeBanner>
            ) : null}

            <section className="flex flex-col gap-2">
              <h3 className="px-1 text-ui font-medium text-foreground">
                {WORKFLOW_RUN_VIEW_COPY.graphSectionTitle}
              </h3>
              <WorkflowGraphView
                slots={pane.slots}
                needsInputNodeRowIds={pane.needsInputNodeRowIds}
                busy={pane.busy}
                onFocusSession={pane.actions.focusNodeSession}
                onApprove={pane.actions.approve}
                onFailRedo={pane.actions.failRedo}
                onFlipType={pane.actions.flipType}
                onAddAdhoc={pane.actions.addAdhocNode}
              />
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="px-1 text-ui font-medium text-foreground">
                {WORKFLOW_RUN_VIEW_COPY.docsSectionTitle}
              </h3>
              {pane.docs.length === 0 ? (
                <p className="px-1 text-ui-sm text-muted-foreground">
                  {WORKFLOW_RUN_VIEW_COPY.docsEmpty}
                </p>
              ) : (
                <WorkflowDocsList
                  docs={pane.docs}
                  nodesById={pane.nodesById}
                  onOpenDoc={openDoc}
                />
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
