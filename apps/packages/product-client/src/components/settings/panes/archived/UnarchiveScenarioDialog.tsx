import { useEffect, useState } from "react";
import type {
  WorkspaceUnarchiveBranchStrategy,
  WorkspaceUnarchiveScenario,
  WorkspaceUnarchiveStrategy,
} from "@anyharness/sdk";
import { Button } from "#product/primitives/Button";
import { ModalShell } from "#product/primitives/patterns/ModalShell";
import { RadioCardGroup, type RadioCardOption } from "#product/primitives/RadioCardGroup";
import type { UnarchiveScenarioState } from "#product/hooks/workspaces/workflows/use-workspace-archive-actions";
import type { UnarchiveScenarioAnswer } from "#product/lib/domain/workspaces/archived/archive-knob-resolution";

const STRATEGY_OPTIONS: Record<
  WorkspaceUnarchiveStrategy,
  RadioCardOption<WorkspaceUnarchiveStrategy>
> = {
  recreate_at_sha: {
    value: "recreate_at_sha",
    label: "Recreate at the archived commit",
    description: "Rebuilds the branch exactly as it was when this workspace was archived.",
  },
  restore_detached: {
    value: "restore_detached",
    label: "Restore detached",
    description: "Restores the snapshot's files without recreating the branch.",
  },
  restore_branch_tip: {
    value: "restore_branch_tip",
    label: "Restore at the branch's current tip",
    description:
      "Uses the branch's latest commit instead of the archived one — some archived history will not carry over.",
  },
  overwrite: {
    value: "overwrite",
    label: "Overwrite",
    description: "Replaces what's currently at that location with the restored snapshot.",
  },
};

function scenarioDescription(scenario: WorkspaceUnarchiveScenario): string {
  switch (scenario) {
    case "branch_diverged":
      return "The branch has moved on since this workspace was archived. Choose how to restore it.";
    case "checked_out_elsewhere":
      return "This branch is already checked out somewhere else. Choose how to restore this workspace.";
    case "snapshot_lost":
      return "The archived snapshot is no longer available.";
    case "path_occupied":
    default:
      return "That location is occupied.";
  }
}

export interface UnarchiveScenarioDialogProps {
  /** Null renders nothing (and closes the dialog): there is no open/closed
   * prop split, the presence of a scenario IS the open state. */
  state: UnarchiveScenarioState | null;
  onCancel: () => void;
  onConfirm: (workspaceId: string, answer: UnarchiveScenarioAnswer) => void;
}

/**
 * Renders exactly the payload's `strategies` list and nothing else — no
 * client-side inference about which strategies apply (§3.8, §9.7). A
 * `path_occupied` live claim is informational (no overwrite offered, whatever
 * the client sends the server refuses it); an unclaimed directory offers a
 * destructive Overwrite.
 */
export function UnarchiveScenarioDialog({ state, onCancel, onConfirm }: UnarchiveScenarioDialogProps) {
  const [selected, setSelected] = useState<WorkspaceUnarchiveStrategy | null>(null);

  useEffect(() => {
    setSelected(state?.strategies[0] ?? null);
  }, [state]);

  if (!state) {
    return null;
  }

  const liveClaim = state.scenario === "path_occupied"
    && state.occupantName !== null
    && state.occupantLifecycle !== "archived";
  const archivedClaim = state.scenario === "path_occupied"
    && state.occupantName !== null
    && state.occupantLifecycle === "archived";
  const informational = liveClaim || archivedClaim;

  const description = liveClaim
    ? `That location belongs to ${state.occupantName} — archive it first.`
    : archivedClaim
      ? `That location holds archived work from ${state.occupantName} — unarchive or delete that workspace first.`
      : scenarioDescription(state.scenario);

  const options = state.strategies.map((strategy) => STRATEGY_OPTIONS[strategy]);

  const handleConfirm = () => {
    if (!selected) {
      return;
    }
    const answer: UnarchiveScenarioAnswer = selected === "overwrite"
      ? { overwrite: true }
      : { branchStrategy: selected as WorkspaceUnarchiveBranchStrategy };
    onConfirm(state.workspaceId, answer);
  };

  return (
    <ModalShell
      open
      onClose={onCancel}
      title={`Can't restore "${state.workspaceName}" as-is`}
      description={description}
      footer={(
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {informational ? null : (
            <Button
              type="button"
              variant={selected === "overwrite" ? "destructive" : "primary"}
              disabled={!selected}
              onClick={handleConfirm}
            >
              {selected === "overwrite" ? "Overwrite" : "Restore"}
            </Button>
          )}
        </>
      )}
    >
      {informational || options.length === 0 ? null : (
        <RadioCardGroup
          value={selected}
          options={options}
          onChange={setSelected}
          orientation="vertical"
        />
      )}
    </ModalShell>
  );
}
