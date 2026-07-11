import { useState } from "react";
import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowUpRight, ChevronDown, ChevronRight, CircleAlert } from "@proliferate/ui/icons";
import { formatAutomationTimestamp } from "@/lib/domain/automations/schedule/schedule";
import { useWorkflowTriggerItems } from "@/hooks/access/cloud/workflows/use-workflow-trigger-items";
import type { WorkflowTriggerItemResponse, WorkflowTriggerResponse } from "@/hooks/access/cloud/workflows/types";

export function PollTriggerStatusRow({
  trigger,
  onOpenRun,
}: {
  trigger: WorkflowTriggerResponse;
  onOpenRun?: (runId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const itemsQuery = useWorkflowTriggerItems(trigger.workflowId, trigger.id, expanded);
  const poll = trigger.poll;
  if (!poll) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface-elevated-secondary/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate font-mono">{poll.url}</span>
          <span className="shrink-0 text-faint">
            · {poll.lastPollAt ? `last polled ${formatAutomationTimestamp(poll.lastPollAt)}` : "not polled yet"}
          </span>
        </div>
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          onClick={() => setExpanded((value) => !value)}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-list-hover hover:text-foreground"
        >
          {expanded ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
          Items
        </Button>
      </div>

      {poll.lastPollError ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {poll.lastPollError}
        </p>
      ) : null}

      {expanded ? (
        <TriggerItemsList
          items={itemsQuery.data ?? []}
          loading={itemsQuery.isPending}
          onOpenRun={onOpenRun}
        />
      ) : null}
    </div>
  );
}

const ITEM_STATUS_TONE: Record<string, BadgeTone> = {
  spawned: "success",
  invalid: "warning",
  error: "destructive",
};

function TriggerItemsList({
  items,
  loading,
  onOpenRun,
}: {
  items: readonly WorkflowTriggerItemResponse[];
  loading: boolean;
  onOpenRun?: (runId: string) => void;
}) {
  if (loading) {
    return <p className="px-1 py-1 text-xs text-faint">Loading items…</p>;
  }
  if (items.length === 0) {
    return <p className="px-1 py-1 text-xs text-faint">No items seen yet.</p>;
  }
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-1.5">
      {items.map((item) => (
        <div key={item.itemId} className="flex items-start justify-between gap-2 px-1 py-0.5 text-xs">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <Badge tone={ITEM_STATUS_TONE[item.status] ?? "neutral"} className="text-[11px]">
                {item.status}
              </Badge>
              <span className="min-w-0 truncate font-mono text-faint">{item.itemId}</span>
              <span className="shrink-0 text-faint">· {formatAutomationTimestamp(item.receivedAt)}</span>
            </div>
            {item.errorMessage ? <p className="text-destructive">{item.errorMessage}</p> : null}
          </div>
          {item.status === "spawned" && item.runId && onOpenRun ? (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              onClick={() => onOpenRun(item.runId!)}
              className="flex shrink-0 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              Open run
              <ArrowUpRight className="size-3" aria-hidden />
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
