import { sortSubagentsForDisplay, type ActivitySubagentWire } from "@proliferate/product-domain/activity/subagent";
import { SubagentRosterRow } from "./SubagentRosterRow";

export interface AgentsRosterPanelProps {
  agents: ActivitySubagentWire[];
  nowMs: number;
  onOpen?: (subagentId: string) => void;
}

/**
 * The ⑂ chip's click-in panel: a read-only summary of harness-native
 * subagents. Shows ONLY running subagents — finished ones leave the roster
 * immediately and appear as a quiet done-line in the transcript instead. This
 * is the standalone rendering for this PR — a follow-up integration pass
 * merges this roster into the existing delegated-work surfaces
 * (`features/delegated-work.md`) as a new `subagent` source, inheriting
 * generated identity/color there.
 */
export function AgentsRosterPanel({ agents, nowMs, onOpen }: AgentsRosterPanelProps) {
  const runningAgents = agents.filter((agent) => agent.status.status === "running");
  const sorted = sortSubagentsForDisplay(runningAgents);
  return (
    <div className="flex flex-col gap-1.5" data-agents-roster-panel>
      <div className="px-1 pt-0.5">
        <span className="text-xs font-medium text-foreground">Native subagents</span>
      </div>
      {sorted.length === 0 ? (
        <p className="px-1 pb-1 text-xs text-muted-foreground">No active native subagents.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {sorted.map((agent) => (
            <li key={agent.id}>
              <SubagentRosterRow subagent={agent} nowMs={nowMs} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
