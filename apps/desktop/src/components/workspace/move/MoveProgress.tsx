import { Button } from "@proliferate/ui/primitives/Button";
import { CheckCircleFilled, Circle, CircleAlert, Spinner } from "@proliferate/ui/icons";
import type { MovePhase } from "@/lib/domain/workspaces/move/move-model";
import {
  resolveMoveProgressSteps,
  type MoveProgressStepStatus,
} from "@/lib/domain/workspaces/move/move-progress";

interface MoveProgressProps {
  phase: MovePhase | "running";
  /** Set when a post-cutover cleanup step failed -- the saga stays at phase "cutover"
   *  server-side and the move is committed, so the only actions are retry (no abandon,
   *  locked failure-semantics decision). */
  error?: string | null;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export function MoveProgress({ phase, error = null, onRetry, isRetrying = false }: MoveProgressProps) {
  const steps = resolveMoveProgressSteps(phase);

  return (
    <div className="space-y-4">
      <ul className="space-y-2.5">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2.5 text-ui">
            <MoveProgressStepIcon status={error && step.status === "active" ? "error" : step.status} />
            <span className={step.status === "pending" ? "text-muted-foreground" : "text-foreground"}>
              {step.label}
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-ui-sm text-destructive">{error}</p>
          <p className="text-ui-sm text-muted-foreground">
            {phase === "cutover"
              ? "Moved. Cleanup is pending -- retry when ready."
              : "Source untouched -- retry or cancel."}
          </p>
          {onRetry && (
            <Button type="button" variant="outline" size="sm" loading={isRetrying} onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function MoveProgressStepIcon({ status }: { status: MoveProgressStepStatus | "error" }) {
  switch (status) {
    case "done":
      return <CheckCircleFilled className="size-4 shrink-0 text-git-green" />;
    case "active":
      return <Spinner className="size-4 shrink-0 text-foreground" />;
    case "error":
      return <CircleAlert className="size-4 shrink-0 text-destructive" />;
    case "pending":
      return <Circle className="size-4 shrink-0 text-muted-foreground/50" />;
  }
}
