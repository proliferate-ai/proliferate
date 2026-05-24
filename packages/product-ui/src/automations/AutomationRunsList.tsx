import { ExternalLink } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { Button } from "@proliferate/ui/primitives/Button";
import type { AutomationRunInventoryItemView } from "@proliferate/product-model/automations/inventory";
import { AutomationStatusGlyph } from "./AutomationStatusGlyph";

export interface AutomationRunsListProps {
  runs: readonly AutomationRunInventoryItemView[];
  loading?: boolean;
  pendingLabel?: string;
  onRunSelect?: (runId: string) => void;
}

export function AutomationRunsList({
  runs,
  loading = false,
  pendingLabel = "Opening...",
  onRunSelect,
}: AutomationRunsListProps) {
  if (loading) {
    return (
      <div className="py-4 text-xs text-muted-foreground" role="status" aria-live="polite">
        Loading runs
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="py-4 text-xs text-muted-foreground">
        No runs queued yet.
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 overflow-hidden pb-8" role="list" aria-label="Automation run history">
      {runs.map((run) => (
        <AutomationRunRow
          key={run.id}
          run={run}
          pendingLabel={pendingLabel}
          onRunSelect={onRunSelect}
        />
      ))}
    </div>
  );
}

function AutomationRunRow({
  run,
  pendingLabel,
  onRunSelect,
}: {
  run: AutomationRunInventoryItemView;
  pendingLabel: string;
  onRunSelect?: (runId: string) => void;
}) {
  const openable = run.openState === "openable" && typeof onRunSelect === "function";
  const opening = run.openState === "opening";
  const rowClass = twMerge(
    "group relative grid h-12 w-full grid-cols-[18px_minmax(0,1fr)_4rem] items-center gap-x-3 rounded-[5px] px-3 py-1 text-left transition-colors sm:grid-cols-[18px_minmax(0,1fr)_7rem_4rem] md:grid-cols-[18px_minmax(0,1fr)_7rem_8rem_4rem]",
    openable
      ? "cursor-pointer hover:bg-foreground/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
      : "cursor-default",
  );

  const inner = (
    <>
      <span className="inline-flex shrink-0 items-center justify-center">
        <AutomationStatusGlyph status={run.statusKind} size={14} />
      </span>

      <span className="min-w-0" title={run.errorLabel ?? run.title}>
        <span className="block min-w-0 truncate text-sm font-medium leading-5 text-foreground">
          {run.title}
        </span>
        <span className="block min-w-0 truncate text-xs leading-4 text-muted-foreground">
          {run.timestampLabel}
        </span>
      </span>

      <MetadataCell className="hidden sm:flex" label={run.triggerLabel} />
      <MetadataCell className="hidden md:flex" label={run.targetLabel} />

      <span className="relative flex min-w-0 items-center justify-end text-right text-xs leading-4 text-muted-foreground">
        <span
          className={twMerge(
            "truncate transition-opacity",
            openable ? "group-hover:opacity-0 group-focus-visible:opacity-0" : "",
          )}
        >
          {opening ? pendingLabel : run.statusLabel}
        </span>
        {openable ? (
          <span
            className="pointer-events-none absolute right-0 flex size-7 items-center justify-center text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          >
            <ExternalLink className="size-3.5" />
          </span>
        ) : null}
      </span>
    </>
  );

  if (!openable) {
    return (
      <div className={rowClass} role="listitem" aria-label={runRowAriaLabel(run)}>
        {inner}
      </div>
    );
  }

  return (
    <div role="listitem">
      <Button
        variant="unstyled"
        size="unstyled"
        type="button"
        onClick={() => onRunSelect?.(run.id)}
        className={rowClass}
        aria-label={`${runRowAriaLabel(run)}, open workspace`}
      >
        {inner}
      </Button>
    </div>
  );
}

function MetadataCell({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span
      className={twMerge("min-w-0 items-center text-xs leading-4 text-muted-foreground", className)}
      title={label}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function runRowAriaLabel(run: AutomationRunInventoryItemView): string {
  return [
    run.title,
    run.timestampLabel,
    `trigger ${run.triggerLabel}`,
    `target ${run.targetLabel}`,
    `status ${run.statusLabel}`,
  ].join(", ");
}
