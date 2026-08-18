import {
  sortProcessesForDisplay,
  type ActivityProcessWire,
} from "#product/domain/activity/process";
import { TerminalRosterRow } from "#product/components/workspace/activity/TerminalRosterRow";
import { RosterPanel } from "#product/primitives/patterns/RosterPanel";

export interface LiveTerminalsRosterPanelProps {
  processes: ActivityProcessWire[];
  nowMs: number;
  /** Opens the pane's `BackgroundTerminalView` detail seam for this row (rung R3). */
  onOpen?: (processId: string) => void;
}

/**
 * The Background work pane's Terminals roster group: a read-only summary of
 * agent-spawned background processes. Row selection routes to
 * `BackgroundWorkPane`'s `BackgroundTerminalView` detail seam (Design
 * Handoff — MODIFIED `TerminalRosterRow`; Delivery Spec — Background Work
 * Slice 1, rung R3) rather than expanding a live tail inline — the detail
 * view owns the feed wiring now, so this panel stays a plain, stateless
 * roster like `AgentsRosterPanel`.
 */
export function LiveTerminalsRosterPanel({ processes, nowMs, onOpen }: LiveTerminalsRosterPanelProps) {
  const sorted = sortProcessesForDisplay(processes);
  return (
    <RosterPanel title="Terminals" empty="No background terminals." data-terminals-roster-panel>
      {sorted.map((process) => (
        <li key={process.id}>
          <TerminalRosterRow process={process} nowMs={nowMs} onOpen={onOpen} />
        </li>
      ))}
    </RosterPanel>
  );
}
