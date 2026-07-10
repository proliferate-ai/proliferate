import type { WorkflowCardView } from "@proliferate/product-domain/workflows/presentation";
import type { WorkflowStatusTone } from "@proliferate/product-domain/workflows/run-status";
import { Button } from "@proliferate/ui/primitives/Button";
import { WorkflowStepGlyphStrip } from "@proliferate/product-ui/workflows/WorkflowStepGlyphStrip";
import { MoreHorizontal, Play } from "@proliferate/ui/icons";

const DOT_TONE: Record<WorkflowStatusTone, string> = {
  muted: "bg-muted-foreground",
  running: "bg-info",
  positive: "bg-success",
  attention: "bg-warning",
  danger: "bg-destructive",
};

export interface WorkflowCardProps {
  view: WorkflowCardView;
  lastRunTone?: WorkflowStatusTone;
  runBusy?: boolean;
  runDisabled?: boolean;
  onOpen: () => void;
  onRun: () => void;
  onOverflow?: () => void;
}

/** A workflow home card (spec 3.6): name, step-glyph strip, triggers, last-run, Run. */
export function WorkflowCard({
  view,
  lastRunTone = "muted",
  runBusy = false,
  runDisabled = false,
  onOpen,
  onRun,
  onOverflow,
}: WorkflowCardProps) {
  return (
    <div className="group flex flex-col gap-3 rounded-[12px] border border-border bg-background p-4 transition-colors hover:border-foreground/20">
      <div className="flex items-start justify-between gap-2">
        <Button type="button" variant="unstyled" size="unstyled" onClick={onOpen} className="min-w-0 text-left">
          <h3 className="truncate text-ui font-medium text-foreground">{view.name}</h3>
          {view.description ? (
            <p className="mt-0.5 line-clamp-2 text-ui-sm text-muted-foreground">{view.description}</p>
          ) : null}
        </Button>
        {onOverflow ? (
          <Button variant="ghost" size="icon-sm" onClick={onOverflow} aria-label="Workflow options">
            <MoreHorizontal className="size-4" />
          </Button>
        ) : null}
      </div>

      <Button type="button" variant="unstyled" size="unstyled" onClick={onOpen} className="flex items-center gap-2 text-left">
        <WorkflowStepGlyphStrip glyphs={view.glyphs} />
        <span className="text-xs text-faint">
          {view.stepCount} {view.stepCount === 1 ? "step" : "steps"}
        </span>
      </Button>

      <div className="flex flex-wrap items-center gap-1.5">
        {view.triggers.map((trigger) => (
          <span
            key={trigger.kind}
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
              trigger.live
                ? "border-border bg-accent text-muted-foreground"
                : "border-dashed border-border text-faint"
            }`}
          >
            {trigger.label}
            {trigger.live ? null : " · soon"}
          </span>
        ))}
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {view.lastRun ? (
            <>
              <span className={`size-1.5 shrink-0 rounded-full ${DOT_TONE[lastRunTone]}`} aria-hidden />
              <span className="truncate">{view.lastRun.atLabel}</span>
            </>
          ) : (
            <span className="text-faint">No runs yet</span>
          )}
        </span>
        <Button size="sm" onClick={onRun} loading={runBusy} disabled={runDisabled}>
          <Play className="size-3.5" />
          Run
        </Button>
      </div>
    </div>
  );
}
