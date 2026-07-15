import { sortProcessesForDisplay, type ActivityProcessWire } from "@proliferate/product-domain/activity/process";
import { TerminalRosterRow } from "./TerminalRosterRow";

export interface TerminalsRosterPanelProps {
  processes: ActivityProcessWire[];
  nowMs: number;
  onOpen?: (processId: string) => void;
}

/**
 * The ▸ chip's click-in panel: a read-only summary of agent-spawned
 * background processes. This is the standalone rendering for this PR — a
 * follow-up integration pass embeds `TerminalRosterRow` directly into the
 * existing terminals pane (`features/terminals.md`) once its `FeedRef`
 * bytes are wired through `TerminalViewport`.
 */
export function TerminalsRosterPanel({ processes, nowMs, onOpen }: TerminalsRosterPanelProps) {
  const sorted = sortProcessesForDisplay(processes);
  return (
    <div className="flex flex-col gap-1.5" data-terminals-roster-panel>
      <div className="px-1 pt-0.5">
        <span className="text-xs font-medium text-foreground">Terminals</span>
      </div>
      {sorted.length === 0 ? (
        <p className="px-1 pb-1 text-xs text-muted-foreground">No background terminals.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {sorted.map((process) => (
            <li key={process.id}>
              <TerminalRosterRow process={process} nowMs={nowMs} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
