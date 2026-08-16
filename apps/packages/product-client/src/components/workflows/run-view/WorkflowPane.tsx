import { useMemo, useState } from "react";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import { Button } from "#product/primitives/Button";
import { IconButton } from "#product/primitives/IconButton";
import { Spinner } from "#product/primitives/Spinner";
import { StatusDot } from "#product/primitives/StatusDot";
import { X } from "#product/primitives/icons/core";
import { Workflow } from "#product/primitives/icons/product";
import { EmptyState } from "#product/primitives/patterns/EmptyState";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { PaneHeader } from "#product/components/workspace/pane/PaneHeader";
import { workflowRunStatusDotTone } from "#product/components/workflows/workflow-run-status-dot";
import { WorkflowDocsList } from "#product/components/workflows/run-view/WorkflowDocsList";
import { WorkflowGraphNodeCard } from "#product/components/workflows/run-view/WorkflowGraphNodeCard";
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
 * resume banner when the run is parked, the chain drawn as a graph on the
 * pannable canvas, a docked inspector for the selected node (the full card,
 * controls and dialogs included), and the documents the run has produced.
 *
 * Every control on the inspector card comes from `workflowNodeControls`, so
 * this file decides nothing about what is legal — it only routes the
 * callbacks the facade owns. Selection is presentation state and lives here:
 * a node the projection no longer carries simply stops resolving, so a stale
 * id closes the inspector rather than crashing it.
 */
export function WorkflowPane({ workspaceId }: { workspaceId: string }) {
  const pane = useWorkflowPane({ workspaceId });
  const openDoc = useWorkflowDocOpen(workspaceId);
  const [selectedNodeRowId, setSelectedNodeRowId] = useState<string | null>(null);
  const selectedVm = useMemo(() => {
    if (selectedNodeRowId === null) {
      return null;
    }
    for (const slot of pane.slots) {
      for (const vm of [...slot.attempts, ...slot.adhoc]) {
        if (vm.node.id === selectedNodeRowId) {
          return vm;
        }
      }
    }
    return null;
  }, [pane.slots, selectedNodeRowId]);

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
      <div
        className={`min-h-0 flex-1 ${pane.status === "ready" ? "flex flex-col" : "overflow-y-auto px-3 py-3"}`}
      >
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
          <div className="flex min-h-0 flex-1 flex-col">
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

            <WorkflowGraphView
              className="min-h-48 flex-1 border-b border-border/70"
              slots={pane.slots}
              needsInputNodeRowIds={pane.needsInputNodeRowIds}
              selectedNodeRowId={selectedNodeRowId}
              onSelectNode={setSelectedNodeRowId}
            />

            {selectedVm ? (
              <section className="flex shrink-0 flex-col gap-1 px-3 pt-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-ui font-medium text-foreground">
                    {WORKFLOW_RUN_VIEW_COPY.inspectorTitle}
                  </h3>
                  <IconButton
                    size="sm"
                    aria-label={WORKFLOW_RUN_VIEW_COPY.inspectorCloseLabel}
                    title={WORKFLOW_RUN_VIEW_COPY.inspectorCloseLabel}
                    onClick={() => setSelectedNodeRowId(null)}
                  >
                    <X className="icon-compact" aria-hidden />
                  </IconButton>
                </div>
                <WorkflowGraphNodeCard
                  vm={selectedVm}
                  needsInput={pane.needsInputNodeRowIds.has(selectedVm.node.id)}
                  busy={pane.busy}
                  onFocusSession={pane.actions.focusNodeSession}
                  onApprove={pane.actions.approve}
                  onFailRedo={pane.actions.failRedo}
                  onFlipType={pane.actions.flipType}
                  onAddAdhoc={pane.actions.addAdhocNode}
                />
              </section>
            ) : null}

            <section className="flex max-h-44 shrink-0 flex-col gap-2 overflow-y-auto p-3">
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
