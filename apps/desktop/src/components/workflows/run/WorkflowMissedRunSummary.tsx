import { workflowRunStatusDetail } from "@proliferate/product-domain/workflows/run-status";
import { workflowTriggerLabel } from "@proliferate/product-domain/workflows/model";
import { WorkflowStatusPill } from "@proliferate/product-ui/workflows/WorkflowStatusPill";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowLeft } from "@proliferate/ui/icons";
import { formatAutomationTimestamp } from "@/lib/domain/automations/schedule/schedule";
import type { WorkflowRunResponse } from "@/hooks/access/cloud/workflows/types";

export interface WorkflowMissedRunSummaryProps {
  run: WorkflowRunResponse;
  workflowName: string | null;
  onBack: () => void;
}

/**
 * The quiet detail view for a `missed` run row (1c: missed-run policy,
 * mental-model §4). A missed row never launched a sandbox and has no resolved
 * plan/timeline — this deliberately does not render {@link WorkflowRunView}'s
 * step timeline, just the honest "this occurrence wasn't run" summary, with
 * the same status-pill atom the run list uses elsewhere.
 */
export function WorkflowMissedRunSummary({ run, workflowName, onBack }: WorkflowMissedRunSummaryProps) {
  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1.5 text-ui-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Workflows
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-foreground">{workflowName ?? "Run"}</h1>
        <WorkflowStatusPill label="Missed" tone="muted" title={workflowRunStatusDetail("missed")} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-sm text-muted-foreground">
        <span>{workflowTriggerLabel(run.triggerKind)}</span>
        <span>· scheduled for {formatAutomationTimestamp(run.scheduledFor)}</span>
      </div>
      <p className="rounded-md border border-border bg-surface-elevated-secondary/40 px-3 py-2 text-ui-sm text-muted-foreground">
        This occurrence wasn&apos;t run. The trigger&apos;s missed-run policy recorded it as
        history instead of firing — no sandbox launched, nothing to review.
      </p>
    </div>
  );
}
