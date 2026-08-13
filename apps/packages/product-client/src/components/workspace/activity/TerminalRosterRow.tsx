import { SquareTerminal } from "#product/primitives/icons/workspace";
import {
  processElapsedLabel,
  processStatusLabel,
  processStatusTone,
  type ActivityProcessWire,
  type ProcessTone,
} from "#product/domain/activity/process";
import { statusDotToneTextClass, type StatusDotTone } from "#product/primitives/StatusDot";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { twMerge } from "#product/primitives/utils/tw-merge";

const PROCESS_STATUS_DOT_TONE: Record<ProcessTone, StatusDotTone> = {
  default: "muted",
  positive: "success",
  danger: "danger",
  muted: "muted",
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
  const tone = PROCESS_STATUS_DOT_TONE[processStatusTone(process)];

  return (
    <RosterRow
      leading={<SquareTerminal className={twMerge("icon-paired", statusDotToneTextClass(tone))} aria-hidden />}
      title={<span className="font-mono" data-telemetry-mask title={process.command}>{process.command}</span>}
      secondary={(
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className={statusDotToneTextClass(tone)}>{processStatusLabel(process)}</span>
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
        </span>
      )}
      onSelect={onOpen ? () => onOpen(process.id) : undefined}
      data-terminal-roster-row=""
      data-process-id={process.id}
    />
  );
}
