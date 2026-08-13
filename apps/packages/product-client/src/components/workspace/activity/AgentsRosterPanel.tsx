import { sortSubagentsForDisplay, type ActivitySubagentWire } from "#product/domain/activity/subagent";
import { RosterPanel } from "#product/primitives/patterns/RosterPanel";
import { SubagentRosterRow } from "./SubagentRosterRow";

export interface AgentsRosterPanelProps {
  agents: ActivitySubagentWire[];
  nowMs: number;
  onOpen?: (subagentId: string) => void;
}

/**
 * The ⑂ chip's click-in panel: a read-only summary of harness-native
 * subagents. Shows ONLY running subagents — finished ones leave the roster
 * immediately, while their durable nested work remains in the transcript.
 * This is the standalone rendering for this PR — a follow-up integration pass
 * merges this roster into the existing delegated-work surfaces
 * (`features/delegated-work.md`) as a new `subagent` source, inheriting
 * generated identity/color there.
 */
export function AgentsRosterPanel({ agents, nowMs, onOpen }: AgentsRosterPanelProps) {
  const runningAgents = agents.filter((agent) => agent.status.status === "running");
  const sorted = sortSubagentsForDisplay(runningAgents);
  return (
    <RosterPanel
      title="Native subagents"
      empty="No active native subagents."
      data-agents-roster-panel
    >
      {sorted.map((agent) => (
        <li key={agent.id}>
          <SubagentRosterRow subagent={agent} nowMs={nowMs} onOpen={onOpen} />
        </li>
      ))}
    </RosterPanel>
  );
}
