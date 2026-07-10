import { useNavigate } from "react-router-dom";
import { useWorkflowRunPillStore } from "@/stores/workflows/workflow-run-pill-store";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowUpRight, Play, X } from "@proliferate/ui/icons";
import { useWorkflowsEnabled } from "@/hooks/access/cloud/use-server-features";

/**
 * App-wide host for the post-launch run pills (spec run-from-chat R2). Sits
 * next to the toast host; launching from any door drops a pill here so the
 * launcher stays put and can jump into the run when they choose. Links to the
 * run view route (phase 2 replaces this with the tab-group affordance).
 */
export function WorkflowRunPillHost() {
  const navigate = useNavigate();
  const workflowsEnabled = useWorkflowsEnabled();
  const pills = useWorkflowRunPillStore((state) => state.pills);
  const dismiss = useWorkflowRunPillStore((state) => state.dismiss);

  if (!workflowsEnabled || pills.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2"
      aria-live="polite"
    >
      {pills.map((pill) => (
        <div
          key={pill.runId}
          className="flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-3 pr-1.5 text-ui-sm text-card-foreground shadow-floating-dark animate-toast-in"
        >
          <Play className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-faint">Running</span>
          <span className="max-w-56 truncate font-medium text-foreground">{pill.workflowName}</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-6 gap-1 rounded-full px-2.5"
            onClick={() => {
              dismiss(pill.runId);
              navigate(`/workflows/${pill.workflowId}/runs/${pill.runId}`);
            }}
          >
            View
            <ArrowUpRight className="size-3" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            aria-label="Dismiss"
            onClick={() => dismiss(pill.runId)}
            className="shrink-0 px-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
