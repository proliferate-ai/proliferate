import { useMemo } from "react";
import { flattenWorkflowSteps, type WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import {
  coerceRunStatus,
  deriveRunTimeline,
  formatRunCostTokens,
  formatRunCostUsd,
  formatRunDuration,
  isTerminalRunStatus,
  laneStatusLabel,
  laneStatusTone,
  workflowArgChips,
  workflowRunStatusDetail,
  workflowRunStatusLabel,
  workflowRunStatusTone,
  type WorkflowStepActionSummary,
  type WorkflowStepRunView,
  type WorkflowStepSessionLink,
} from "@proliferate/product-domain/workflows/run-status";
import { workflowTriggerLabel } from "@proliferate/product-domain/workflows/model";
import { workflowStepPreview } from "@proliferate/product-domain/workflows/presentation";
import { WorkflowRunTimelineRow } from "@proliferate/product-ui/workflows/WorkflowRunTimelineRow";
import { WorkflowStatusPill } from "@proliferate/product-ui/workflows/WorkflowStatusPill";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowLeft } from "@proliferate/ui/icons";
import type { StepActionResponse, WorkflowRunResponse } from "@/hooks/access/cloud/workflows/types";

export interface WorkflowRunViewProps {
  run: WorkflowRunResponse;
  /** The run's step-action ledger rows (spec 1.2) — feeds delivery chips. */
  stepActions: readonly StepActionResponse[];
  definition: WorkflowDefinition;
  workflowName: string | null;
  /** Live approve/deny for local runs; cloud-run approvals are read-only in v1. */
  approvalEnabled?: boolean;
  approvalBusy?: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
  /** Take-over/stop (spec: cancel endpoint doubles as the UI's take-over action).
   * Omitted while the run is terminal — there is nothing left to stop. */
  onCancel?: () => void;
  cancelBusy?: boolean;
  onBack: () => void;
  onOpenSession: (link: WorkflowStepSessionLink) => void;
}

/** The run observability view (spec 3.6): header + typed step timeline. */
export function WorkflowRunView({
  run,
  stepActions,
  definition,
  workflowName,
  approvalEnabled = false,
  approvalBusy = false,
  onApprove,
  onDeny,
  onCancel,
  cancelBusy = false,
  onBack,
  onOpenSession,
}: WorkflowRunViewProps) {
  const status = coerceRunStatus(run.status);
  const terminal = isTerminalRunStatus(status);
  const duration = formatRunDuration(run.startedAt, run.finishedAt);
  const cost = formatRunCostUsd(run.costUsd) ?? formatRunCostTokens(run.costTokens);
  const argChips = useMemo(
    () => workflowArgChips(run.args as Record<string, unknown> | null),
    [run.args],
  );
  const actionSummaries = useMemo<WorkflowStepActionSummary[]>(
    () =>
      stepActions.map((action) => ({
        stepKey: action.stepKey,
        actionKind: action.actionKind,
        status: action.status,
        errorMessage: action.errorMessage,
      })),
    [stepActions],
  );
  const flatSteps = useMemo(() => flattenWorkflowSteps(definition), [definition]);
  // Two-dimensional timeline (L30 / track 3a phase 3): a flat definition
  // derives exactly one sequential segment, byte-identical to the pre-lanes
  // single-column render (regression); a parallel group becomes its own
  // segment whose lanes render side-by-side.
  const segments = useMemo(
    () =>
      deriveRunTimeline({
        definition,
        runStatus: status,
        stepCursor: run.stepCursor,
        stepOutputs: run.stepOutputs as Record<string, unknown> | null,
        anyharnessWorkspaceId: run.anyharnessWorkspaceId,
        stepActions: actionSummaries,
      }),
    [definition, status, run.stepCursor, run.stepOutputs, run.anyharnessWorkspaceId, actionSummaries],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-fit items-center gap-1.5 text-ui-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Workflows
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-foreground">{workflowName ?? "Run"}</h1>
          <WorkflowStatusPill
            label={workflowRunStatusLabel(status, status === "unknown" ? run.status : run.errorCode)}
            tone={workflowRunStatusTone(status)}
            title={workflowRunStatusDetail(status, run.errorCode)}
            live={!terminal}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-sm text-muted-foreground">
          <span>{workflowTriggerLabel(run.triggerKind)}</span>
          {duration ? <span className="tabular-nums">· {duration}</span> : null}
          {cost ? <span className="tabular-nums">· {cost}</span> : null}
          {run.targetMode ? (
            <span>· {run.targetMode === "local" ? "This Mac" : "Cloud"}</span>
          ) : null}
        </div>
        {argChips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {argChips.map((chip) => (
              <span
                key={chip.name}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-accent px-2 py-0.5 text-xs text-muted-foreground"
              >
                <span className="text-faint">{chip.name}</span>
                <span className="text-foreground" data-telemetry-mask>
                  {chip.value}
                </span>
              </span>
            ))}
          </div>
        ) : null}
        {run.errorMessage ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">
            {run.errorMessage}
          </p>
        ) : null}
        {!terminal && onCancel ? (
          <div className="flex items-center justify-end gap-1.5 border-t border-border/60 pt-3">
            <span className="text-xs text-faint">Can't be resumed once cancelled</span>
            <Button size="sm" variant="destructive" loading={cancelBusy} disabled={cancelBusy} onClick={onCancel}>
              Cancel run
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        {segments.map((segment, segmentIndex) => {
          const approvalControlsFor = (view: WorkflowStepRunView) =>
            view.status === "waiting_approval" ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  loading={approvalBusy}
                  disabled={!approvalEnabled || approvalBusy}
                  title={approvalEnabled ? undefined : "Cloud-run approvals aren't available in the desktop yet"}
                  onClick={onApprove}
                >
                  Approve
                </Button>
                <Button size="sm" variant="ghost" disabled={!approvalEnabled || approvalBusy} onClick={onDeny}>
                  Deny
                </Button>
              </div>
            ) : undefined;

          if (segment.kind === "sequential") {
            if (segment.steps.length === 0) {
              return null;
            }
            return (
              <div key={segmentIndex} className="rounded-[12px] border border-border bg-background p-4">
                {segment.steps.map((view, i) => (
                  <WorkflowRunTimelineRow
                    key={view.index}
                    view={view}
                    preview={flatSteps[view.index] ? workflowStepPreview(flatSteps[view.index]!.step) : null}
                    connector={i < segment.steps.length - 1}
                    onOpenSession={onOpenSession}
                    approvalControls={approvalControlsFor(view)}
                  />
                ))}
              </div>
            );
          }

          // A parallel group (L30 / D-031): lanes render side-by-side, each
          // its own status pill + step list — layout distinguishes lanes, not
          // color/border ownership treatments (UI rule; color = status only).
          return (
            <div key={segmentIndex} className="rounded-[12px] border border-border bg-background p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Run together</span>
                <span className="text-xs text-muted-foreground">
                  — concurrent agents; a sibling always finishes before the run fails
                </span>
              </div>
              <div className="flex flex-wrap items-start gap-4">
                {segment.lanes.map((lane) => (
                  <div key={lane.lane} className="flex min-w-[240px] flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-medium text-foreground">{lane.lane}</span>
                      <WorkflowStatusPill label={laneStatusLabel(lane.status)} tone={laneStatusTone(lane.status)} />
                    </div>
                    <div className="flex flex-col">
                      {lane.steps.map((view, i) => (
                        <WorkflowRunTimelineRow
                          key={view.index}
                          view={view}
                          preview={flatSteps[view.index] ? workflowStepPreview(flatSteps[view.index]!.step) : null}
                          connector={i < lane.steps.length - 1}
                          onOpenSession={onOpenSession}
                          approvalControls={approvalControlsFor(view)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
