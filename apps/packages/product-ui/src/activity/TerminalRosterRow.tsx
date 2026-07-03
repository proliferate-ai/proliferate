import { SquareTerminal } from "lucide-react";
import {
  processElapsedLabel,
  processStatusLabel,
  processStatusTone,
  type ActivityProcessWire,
  type ProcessTone,
} from "@proliferate/product-domain/activity/process";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

const TONE_CLASSNAME: Record<ProcessTone, string> = {
  default: "text-muted-foreground",
  positive: "text-success",
  danger: "text-destructive",
  muted: "text-faint",
};

export interface TerminalRosterRowProps {
  process: ActivityProcessWire;
  nowMs: number;
  /** Optional per-row click-in, e.g. to focus this row in the terminals pane. */
  onOpen?: (processId: string) => void;
}

/**
 * A read-only, agent-attributed roster row for a background process (Claude
 * background bash, Cursor detached terminal, …). Structured header only
 * (command/pid/elapsed/exit) — designed to embed into the existing terminals
 * pane (`features/terminals.md`) once its live bytes flow through a
 * `FeedRef`; for now this renders the lifecycle facts the runtime mirror
 * already has, with no PTY content of its own (that pane owns real,
 * interactive PTYs — these rows are watch-only).
 */
export function TerminalRosterRow({ process, nowMs, onOpen }: TerminalRosterRowProps) {
  const tone = processStatusTone(process);
  const content = (
    <>
      <SquareTerminal className={twMerge("mt-0.5 size-3.5 shrink-0", TONE_CLASSNAME[tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs text-foreground" data-telemetry-mask>
          {process.command}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span className={TONE_CLASSNAME[tone]}>{processStatusLabel(process)}</span>
          <span aria-hidden>·</span>
          <span>{processElapsedLabel(process, nowMs)}</span>
          {process.pid !== null && (
            <>
              <span aria-hidden>·</span>
              <span>pid {process.pid}</span>
            </>
          )}
          {process.cwd && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate" data-telemetry-mask>{process.cwd}</span>
            </>
          )}
        </div>
      </div>
    </>
  );

  if (!onOpen) {
    return (
      <div
        className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left"
        data-terminal-roster-row
        data-process-id={process.id}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/40"
      onClick={() => onOpen(process.id)}
      data-terminal-roster-row
      data-process-id={process.id}
    >
      {content}
    </button>
  );
}
