/**
 * Activity chip summaries — the compact `⟳ 2 loops · ▸ 2 terminals · ⑂ 1
 * agent` row that stacks on the goal bar's row (session-activity-architecture
 * §Locked decisions #5). One chip per non-empty roster; the row (and its
 * host bar) renders nothing when every roster is empty.
 */

import type { ActivityProcessWire } from "./process";
import { isProcessRunning } from "./process";
import type { LoopWire } from "./loop";
import type { ActivitySubagentWire } from "./subagent";

export type ActivityChipKind = "loops" | "terminals" | "agents";

export interface ActivityChipDescriptor {
  kind: ActivityChipKind;
  /** Total roster count (both live and recently-finished elements). */
  count: number;
  /** Count still actively live — armed loops / running processes / running agents. */
  liveCount: number;
  label: string;
}

export interface ActivityChipsInput {
  loops: readonly LoopWire[];
  processes: readonly ActivityProcessWire[];
  agents: readonly ActivitySubagentWire[];
}

export function deriveActivityChips(input: ActivityChipsInput): ActivityChipDescriptor[] {
  const chips: ActivityChipDescriptor[] = [];

  const armedLoops = input.loops.filter((loop) => loop.status === "active");
  if (armedLoops.length > 0) {
    chips.push({
      kind: "loops",
      count: armedLoops.length,
      liveCount: armedLoops.length,
      label: pluralize(armedLoops.length, "loop"),
    });
  }

  if (input.processes.length > 0) {
    const liveCount = input.processes.filter((process) => isProcessRunning(process)).length;
    chips.push({
      kind: "terminals",
      count: input.processes.length,
      liveCount,
      label: pluralize(input.processes.length, "terminal"),
    });
  }

  // Native subagents leave the roster the instant they finish (locked design:
  // session-activity-architecture). The chip must therefore count RUNNING
  // subagents only and disappear when none are running — otherwise the chip
  // would advertise "3 native subagents" while the panel shows "No active
  // native subagents". This mirrors the armed-only loops chip. (Terminals are
  // intentionally different: exited processes stay in the roster so users can
  // inspect output/exit codes, so that chip counts all processes.)
  const runningAgents = input.agents.filter((agent) => agent.status.status === "running");
  if (runningAgents.length > 0) {
    chips.push({
      kind: "agents",
      count: runningAgents.length,
      liveCount: runningAgents.length,
      label: pluralize(runningAgents.length, "native subagent"),
    });
  }

  return chips;
}

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}
