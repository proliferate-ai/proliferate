import { useEffect, useMemo, useState } from "react";
import type { WorkflowRunDocV2, WorkflowRunV2 } from "@anyharness/sdk";
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
import {
  useWorkflowPane,
  useWorkflowRunRoster,
} from "#product/hooks/workflows/facade/use-workflow-pane";
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
 * One run's own composition inside the pane: the resume banner when it is
 * parked, its chain drawn as a graph on the pannable canvas, a docked
 * inspector for the selected node (the full card, controls and dialogs
 * included), and the documents it has produced.
 *
 * Every control on the inspector card comes from `workflowNodeControls`, so
 * this file decides nothing about what is legal — it only routes the
 * callbacks the facade owns. Selection is presentation state and lives here,
 * per rail: a node the projection no longer carries simply stops resolving,
 * so a stale id closes that rail's inspector rather than crashing it.
 *
 * `showRunLabel` is the entire disambiguation surface the ADR asks for: with
 * one visible run it stays false and this renders byte-for-byte what the
 * pane rendered before concurrent runs existed; with more than one, the rail
 * grows one extra header line naming the run so two live graphs are never
 * mistaken for one.
 */
function WorkflowRunRail({
  workspaceId,
  run,
  showRunLabel,
  openDoc,
  onHeaderRunChange,
}: {
  workspaceId: string;
  run: WorkflowRunV2;
  showRunLabel: boolean;
  openDoc: (doc: WorkflowRunDocV2) => void;
  /**
   * Set only for the single-visible-run pane header, which shows this rail's
   * status chip in the shared `PaneHeader` rather than inline (byte-for-byte
   * what rendered before concurrent runs existed). The header has to read the
   * polled projection, same as the rail's own inline chip would, so the rail
   * reports its resolved run up rather than the container re-deriving it.
   */
  onHeaderRunChange?: (run: WorkflowRunV2) => void;
}) {
  const pane = useWorkflowPane({ workspaceId, run });
  const [selectedNodeRowId, setSelectedNodeRowId] = useState<string | null>(null);
  useEffect(() => {
    if (pane.run) {
      onHeaderRunChange?.(pane.run);
    }
  }, [pane.run, onHeaderRunChange]);
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

  if (pane.status === "loading") {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center gap-2 text-ui text-muted-foreground"
      >
        <Spinner className="icon-compact" />
        {WORKFLOW_RUN_VIEW_COPY.loading}
      </div>
    );
  }
  if (pane.status === "error") {
    return (
      <NoticeBanner
        tone="destructive"
        icon={<Workflow />}
        title={WORKFLOW_RUN_VIEW_COPY.errorTitle}
      >
        {WORKFLOW_RUN_VIEW_COPY.errorDescription}
      </NoticeBanner>
    );
  }

  return (
    <>
      {showRunLabel ? (
        <div className="flex items-center gap-1.5 px-1 text-ui-sm text-muted-foreground">
          <span className="truncate">{WORKFLOW_RUN_VIEW_COPY.runRailLabel(run)}</span>
          <WorkflowRunStatusChip run={pane.run} />
        </div>
      ) : null}

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
        className="min-h-48 flex-1"
        slots={pane.slots}
        needsInputNodeRowIds={pane.needsInputNodeRowIds}
        selectedNodeRowId={selectedNodeRowId}
        onSelectNode={setSelectedNodeRowId}
      />

      {selectedVm ? (
        <section className="flex shrink-0 flex-col gap-1">
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

      <section className="flex max-h-44 shrink-0 flex-col gap-2 overflow-y-auto">
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
    </>
  );
}

/**
 * The Workflows gen-2 run view, as the workspace's right-panel pane.
 *
 * Mounted once per workspace, but the workspace surface disambiguates
 * concurrent runs rather than only ever showing one: `useWorkflowRunRoster`
 * decides which runs are visible (ordinarily one; `existing_workspace`
 * placement can adopt a workspace into a second live run), and this renders
 * one `WorkflowRunRail` per visible run, each with its own graph, docked
 * inspector and document group. With exactly one visible run — the case
 * every workspace was in before concurrent runs existed — this renders
 * exactly what it rendered before: the single rail's own header chip sits on
 * the pane header exactly as `pane.run`'s did, and no extra wrapper appears
 * around its content.
 */
export function WorkflowPane({ workspaceId }: { workspaceId: string }) {
  const roster = useWorkflowRunRoster(workspaceId);
  const openDoc = useWorkflowDocOpen(workspaceId);
  const singleRun = roster.visibleRuns.length === 1 ? roster.visibleRuns[0] : null;
  // The single rail's polled projection, reported up so the shared header can
  // show the same status the rail itself would — the roster's own copy never
  // polls, so the header would otherwise lag behind a run parking or resuming
  // while the pane stays open.
  const [singleRunHeader, setSingleRunHeader] = useState<WorkflowRunV2 | null>(null);

  return (
    <section
      aria-label={WORKFLOW_RUN_VIEW_COPY.paneTitle}
      aria-busy={roster.status === "loading"}
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
        right={singleRun ? (
          <WorkflowRunStatusChip
            run={singleRunHeader?.id === singleRun.id ? singleRunHeader : singleRun}
          />
        ) : null}
      />
      <div
        className={`min-h-0 flex-1 px-3 py-3 ${roster.status === "ready" ? "flex flex-col" : "overflow-y-auto"}`}
      >
        {roster.status === "loading" ? (
          <div
            role="status"
            className="flex h-full items-center justify-center gap-2 text-ui text-muted-foreground"
          >
            <Spinner className="icon-compact" />
            {WORKFLOW_RUN_VIEW_COPY.loading}
          </div>
        ) : roster.status === "error" ? (
          <NoticeBanner
            tone="destructive"
            icon={<Workflow />}
            title={WORKFLOW_RUN_VIEW_COPY.errorTitle}
          >
            {WORKFLOW_RUN_VIEW_COPY.errorDescription}
          </NoticeBanner>
        ) : roster.status === "empty" ? (
          <EmptyState
            title={WORKFLOW_RUN_VIEW_COPY.emptyTitle}
            description={WORKFLOW_RUN_VIEW_COPY.emptyDescription}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {roster.visibleRuns.map((run) => (
              <WorkflowRunRail
                key={run.id}
                workspaceId={workspaceId}
                run={run}
                showRunLabel={roster.visibleRuns.length > 1}
                openDoc={openDoc}
                onHeaderRunChange={singleRun ? setSingleRunHeader : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
