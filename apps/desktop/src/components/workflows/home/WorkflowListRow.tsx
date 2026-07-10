import type { ReactNode } from "react";
import type { WorkflowStepDotKind } from "@proliferate/product-domain/workflows/run-status";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@proliferate/ui/kit/DropdownMenu";
import { Calendar, CloudIcon, Monitor, MoreHorizontal, Pencil, Play, Trash, X as XIcon } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { IntegrationIcon } from "@/components/settings/panes/integrations/IntegrationIcon";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

export type WorkflowRowTarget = "cloud" | "local";

export function TargetGlyph({ target, className }: { target: WorkflowRowTarget; className?: string }) {
  const Icon = target === "cloud" ? CloudIcon : Monitor;
  return <Icon className={twMerge("size-3.5 text-faint", className)} />;
}

/**
 * Fully monochrome run dot (design-of-record list page): NO status colors on
 * the list — shape and motion carry state. Hollow = pending/skipped, filled =
 * done, pulsing = running, ✕ glyph = failed/attention.
 */
export function RunDot({ kind, className }: { kind: WorkflowStepDotKind; className?: string }) {
  if (kind === "failed" || kind === "attention") {
    return (
      <span className={twMerge("inline-flex shrink-0 items-center text-muted-foreground", className)} aria-hidden>
        <XIcon className="size-3" />
      </span>
    );
  }
  const hollow = kind === "pending" || kind === "skipped";
  return (
    <span className={twMerge("inline-flex shrink-0 items-center text-muted-foreground", className)} aria-hidden>
      <span
        className={twMerge(
          "size-2 rounded-full",
          hollow ? "border border-current bg-transparent" : "bg-current",
          kind === "running" ? "animate-pulse motion-reduce:animate-none" : "",
        )}
      />
    </span>
  );
}

/** Overlapping integration icon stack (avatar-group treatment). */
export function IntegrationStack({ namespaces }: { namespaces: readonly string[] }) {
  if (namespaces.length === 0) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center -space-x-1.5">
      {namespaces.map((ns) => (
        <IntegrationIcon key={ns} namespace={ns} className="size-5 rounded-full ring-2 ring-background" />
      ))}
    </span>
  );
}

/** Overlapping provider-glyph stack for the workflow's agents, in spine order. */
export function AgentStack({ providers }: { providers: readonly string[] }) {
  return (
    <span className="flex shrink-0 items-center -space-x-1.5">
      {providers.map((provider, i) => (
        <span
          key={i}
          className="flex size-5 items-center justify-center rounded-full border border-border bg-surface-elevated-secondary ring-2 ring-background"
        >
          <ProviderIcon kind={provider} className="size-3 text-muted-foreground" />
        </span>
      ))}
    </span>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 select-none items-center gap-1 rounded-full bg-surface-elevated-secondary px-2 py-0.5 text-xs leading-4 text-muted-foreground">
      {children}
    </span>
  );
}

export interface WorkflowListRowView {
  id: string;
  name: string;
  description: string | null;
  /** Provider per agent slot, in spine order (empty while detail loads). */
  agents: readonly string[];
  integrations: readonly string[];
  /** Human schedule summary when a schedule trigger exists. */
  scheduleLabel: string | null;
  /** Last-run-derived target; null when the workflow has never run. */
  target: WorkflowRowTarget | null;
  lastRun: { dotKind: WorkflowStepDotKind; agoLabel: string } | null;
  isSeed: boolean;
}

export interface WorkflowListRowProps {
  view: WorkflowListRowView;
  runDisabled?: boolean;
  onOpen: () => void;
  onRun: () => void;
  onEdit: () => void;
  /** Absent for seeds (read-only shared rows can't be archived). */
  onArchive?: () => void;
}

/** One workflow row (list page of record): name/description, agent +
 * integration stacks, schedule/target facts, mono last-run dot, hover Run. */
export function WorkflowListRow({ view, runDisabled = false, onOpen, onRun, onEdit, onArchive }: WorkflowListRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer items-center gap-4 rounded-xl border border-border bg-background px-4 py-3 shadow-sm transition-colors hover:border-border-heavy"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{view.name}</span>
          {view.isSeed ? <Chip>Starter</Chip> : null}
        </div>
        {view.description ? (
          <span className="truncate text-xs text-muted-foreground">{view.description}</span>
        ) : null}
        <div className="flex items-center gap-3 pt-1 text-xs text-faint">
          {view.agents.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <AgentStack providers={view.agents} />
              {view.agents.length} agent{view.agents.length === 1 ? "" : "s"}
            </span>
          ) : null}
          <IntegrationStack namespaces={view.integrations} />
          {view.scheduleLabel ? (
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3" />
              {view.scheduleLabel}
            </span>
          ) : null}
          {view.target ? (
            <span className="inline-flex items-center gap-1">
              <TargetGlyph target={view.target} className="size-3" />
              {view.target === "cloud" ? "cloud" : "local"}
            </span>
          ) : null}
        </div>
      </div>
      {view.lastRun ? (
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <RunDot kind={view.lastRun.dotKind} />
          <span>{view.lastRun.agoLabel}</span>
        </div>
      ) : (
        <span className="shrink-0 text-xs text-faint">never run</span>
      )}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          disabled={runDisabled}
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
          className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Play className="size-3.5" />
          Run
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Workflow actions"
              onClick={(e) => e.stopPropagation()}
              className="rounded p-1 text-faint transition-colors hover:bg-surface-elevated-secondary hover:text-muted-foreground"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5" />
              {view.isSeed ? "View workflow" : "Edit workflow"}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={runDisabled} onClick={onRun}>
              <Play className="size-3.5" />
              Run now
            </DropdownMenuItem>
            {onArchive ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onArchive}>
                  <Trash className="size-3.5" />
                  Archive
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export interface WorkflowRunRowView {
  id: string;
  dotKind: WorkflowStepDotKind;
  statusLabel: string;
  /** "Scheduled · 2m ago" / "Manual · yesterday" line. */
  originLabel: string;
  durationLabel: string | null;
  target: WorkflowRowTarget | null;
}

/** One run row inside a workflow's drill-in: status, origin, duration, target. */
export function WorkflowRunRow({ view, onOpen }: { view: WorkflowRunRowView; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-background px-4 py-2.5 shadow-sm transition-colors hover:border-border-heavy"
    >
      <RunDot kind={view.dotKind} />
      <span className="w-32 shrink-0 truncate text-sm font-medium text-foreground">{view.statusLabel}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{view.originLabel}</span>
      {view.durationLabel ? <span className="shrink-0 text-xs tabular-nums text-faint">{view.durationLabel}</span> : null}
      {view.target ? <TargetGlyph target={view.target} className="size-3 shrink-0" /> : null}
      <span className="shrink-0 text-xs text-faint opacity-0 transition-opacity group-hover:opacity-100">open run →</span>
    </div>
  );
}
