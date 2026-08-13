import type { ReactNode } from "react";
import { GoalBar } from "#product/components/workspace/activity/GoalBar";
import { ActivityChips } from "#product/components/workspace/activity/ActivityChips";
import { LoopsPanel } from "#product/components/workspace/activity/LoopsPanel";
import { TerminalRosterRow } from "#product/components/workspace/activity/TerminalRosterRow";
import { AgentsRosterPanel } from "#product/components/workspace/activity/AgentsRosterPanel";
import { RosterPanel } from "#product/primitives/patterns/RosterPanel";
import { sortProcessesForDisplay } from "#product/domain/activity/process";
import { deriveActivityChips } from "#product/domain/activity/chips";
import type { LoopCapabilities, LoopWire } from "#product/domain/activity/loop";
import type { ActivityProcessWire } from "#product/domain/activity/process";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import type { ScenarioKey } from "#product/config/playground";
import { noop } from "#product/components/playground/PlaygroundComposerActions";
import {
  AGENTS_MIXED,
  LOOP_CAPABILITIES_EMULATED,
  LOOP_CAPABILITIES_NATIVE,
  LOOP_EMULATED,
  LOOP_SINGLE_NATIVE,
  LOOPS_FIRED_SEQUENCE,
  LOOPS_MANY,
  PROCESS_RUNNING,
  PROCESSES_MIXED,
  ACTIVITY_FIXTURE_NOW_MS,
} from "#product/lib/domain/chat/__fixtures__/playground/activity-fixtures";
import { GOAL_ACTIVE_SHORT, GOAL_CAPABILITIES_PAUSABLE } from "#product/lib/domain/chat/__fixtures__/playground/goal-fixtures";

const NO_GOAL_CAPABILITIES = {
  supported: false,
  native: false,
  pause: false,
  setEditTranscriptRows: false,
};

interface ActivityChipsFixtureInput {
  loops?: LoopWire[];
  loopCapabilities?: LoopCapabilities;
  processes?: ActivityProcessWire[];
  agents?: ActivitySubagentWire[];
}

function activityChips({
  loops = [],
  loopCapabilities = LOOP_CAPABILITIES_NATIVE,
  processes = [],
  agents = [],
}: ActivityChipsFixtureInput): ReactNode {
  const chips = deriveActivityChips({ loops, processes, agents });
  return (
    <ActivityChips
      chips={chips}
      panels={{
        loops: (
          <LoopsPanel
            loops={loops}
            capabilities={loopCapabilities}
            nowMs={ACTIVITY_FIXTURE_NOW_MS}
            onArm={noop}
            onDelete={noop}
          />
        ),
        terminals: (
          // The live wrapper (`LiveTerminalsRosterPanel`) owns feed streaming
          // and expansion state, which the playground has no SDK for; the
          // fixture composes the same `RosterPanel` + `TerminalRosterRow`
          // shape statically instead of carrying a second panel component.
          <RosterPanel
            title="Terminals"
            empty="No background terminals."
            data-terminals-roster-panel
          >
            {sortProcessesForDisplay(processes).map((process) => (
              <li key={process.id}>
                <TerminalRosterRow process={process} nowMs={ACTIVITY_FIXTURE_NOW_MS} />
              </li>
            ))}
          </RosterPanel>
        ),
        agents: (
          <AgentsRosterPanel agents={agents} nowMs={ACTIVITY_FIXTURE_NOW_MS} />
        ),
      }}
    />
  );
}

/**
 * Reproduces the exact "chips-only bar" shell `GoalBar` renders when there is
 * no live/composing goal state — same rounded chrome as the goal bar, no
 * goal content, so these fixtures match what `SessionActivityBar` actually
 * mounts for a session with activity but no goal set.
 */
function activityChipsFixture(input: ActivityChipsFixtureInput): ReactNode {
  return (
    <GoalBar
      goal={null}
      capabilities={NO_GOAL_CAPABILITIES}
      onEdit={noop}
      onPause={noop}
      onResume={noop}
      onClear={noop}
      onDismiss={noop}
      chips={activityChips(input)}
    />
  );
}

/**
 * Every activity chip/panel state from static fixtures: armed loops
 * (native/emulated/many/high fire count), background terminals
 * (running/mixed exit states), harness-native agents
 * (running/completed/failed), the combined row, the row stacked with a live
 * goal on the same bar, and the empty state (renders no bar by design).
 */
export function renderActivityChipsSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "activity-loops-native":
      return activityChipsFixture({ loops: [LOOP_SINGLE_NATIVE] });
    case "activity-loops-many":
      return activityChipsFixture({ loops: LOOPS_MANY });
    case "activity-loops-emulated":
      return activityChipsFixture({
        loops: [LOOP_EMULATED],
        loopCapabilities: LOOP_CAPABILITIES_EMULATED,
      });
    case "activity-loops-fired-sequence":
      return activityChipsFixture({ loops: LOOPS_FIRED_SEQUENCE });
    case "activity-terminals-running":
      return activityChipsFixture({ processes: [PROCESS_RUNNING] });
    case "activity-terminals-mixed":
      return activityChipsFixture({ processes: PROCESSES_MIXED });
    case "activity-agents-mixed":
      return activityChipsFixture({ agents: AGENTS_MIXED });
    case "activity-all-kinds":
      return activityChipsFixture({
        loops: LOOPS_MANY,
        processes: PROCESSES_MIXED,
        agents: AGENTS_MIXED,
      });
    case "activity-empty":
      return null;
    default:
      return null;
  }
}

/**
 * Chips stacked on the SAME bar row as a live goal
 * (session-activity-architecture §Locked decisions #5) — the combined-state
 * proof, rendered through `GoalBar`'s `chips` slot exactly as
 * `SessionActivityBar` composes it.
 */
export function renderActivityWithGoalSlot(scenario: ScenarioKey): ReactNode | null {
  if (scenario !== "activity-with-goal") {
    return null;
  }
  return (
    <GoalBar
      goal={GOAL_ACTIVE_SHORT}
      capabilities={GOAL_CAPABILITIES_PAUSABLE}
      onEdit={noop}
      onPause={noop}
      onResume={noop}
      onClear={noop}
      onDismiss={noop}
      chips={activityChips({
        loops: LOOPS_MANY,
        processes: PROCESSES_MIXED,
        agents: AGENTS_MIXED,
      })}
    />
  );
}
