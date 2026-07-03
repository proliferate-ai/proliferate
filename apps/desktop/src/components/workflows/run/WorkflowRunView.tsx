import { useMemo } from "react";
import type { WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import {
  coerceRunStatus,
  deriveStepRunViews,
  formatRunCostTokens,
  formatRunCostUsd,
  formatRunDuration,
  isTerminalRunStatus,
  workflowArgChips,
  workflowRunStatusLabel,
  workflowRunStatusTone,
  type WorkflowStepSessionLink,
} from "@proliferate/product-domain/workflows/run-status";
import { workflowTriggerLabel } from "@proliferate/product-domain/workflows/model";
import { WorkflowRunTimelineRow } from "@proliferate/product-ui/workflows/WorkflowRunTimelineRow";
import { WorkflowStatusPill } from "@proliferate/product-ui/workflows/WorkflowStatusPill";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowLeft } from "@proliferate/ui/icons";
import type { WorkflowRunResponse } from "@/hooks/access/cloud/workflows/types";

export interface WorkflowRunViewProps {
  run: WorkflowRunResponse;
  definition: WorkflowDefinition;
  workflowName: string | null;
  onBack: () => void;
  onOpenSession: (link: WorkflowStepSessionLink) => void;
}

/** The run observability view (spec 3.6): header + typed step timeline. */
export function WorkflowRunView({ run, definition, workflowName, onBack, onOpenSession }: WorkflowRunViewProps) {
  const status = coerceRunStatus(run.status);
  const terminal = isTerminalRunStatus(status);
  const duration = formatRunDuration(run.startedAt, run.finishedAt);
  const cost = formatRunCostUsd(run.costUsd) ?? formatRunCostTokens(run.costTokens);
  const argChips = useMemo(
    () => workflowArgChips(run.args as Record<string, unknown> | null),
    [run.args],
  );
  const views = useMemo(
    () =>
      deriveStepRunViews({
        definition,
        runStatus: status,
        stepCursor: run.stepCursor,
        stepOutputs: run.stepOutputs as Record<string, unknown> | null,
        anyharnessWorkspaceId: run.anyharnessWorkspaceId,
      }),
    [definition, status, run.stepCursor, run.stepOutputs, run.anyharnessWorkspaceId],
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
            label={workflowRunStatusLabel(status)}
            tone={workflowRunStatusTone(status)}
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
      </div>

      <div className="rounded-[12px] border border-border bg-background p-4">
        {views.map((view, index) => (
          <WorkflowRunTimelineRow
            key={view.index}
            view={view}
            connector={index < views.length - 1}
            onOpenSession={onOpenSession}
            approvalControls={
              view.status === "waiting_approval" ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled title="Approvals resolve here — coming soon">
                    Approve
                  </Button>
                  <Button size="sm" variant="ghost" disabled>
                    Deny
                  </Button>
                </div>
              ) : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
