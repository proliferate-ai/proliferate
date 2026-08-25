import type {
  AutomationTargetGroup,
  AutomationTargetRow,
  AutomationTargetSelection,
  TargetRepoDraft,
} from "#product/lib/domain/automations/target/selection-types";
import {
  automationTargetId,
  isSameAutomationTarget,
  repoKey,
} from "#product/lib/domain/automations/target/selection-identity";

export function buildTargetGroups(
  repoDrafts: TargetRepoDraft[],
  selectedTarget: AutomationTargetSelection | null,
  cloudAvailable: boolean,
): AutomationTargetGroup[] {
  return repoDrafts.map((draft) =>
    buildTargetGroup(draft, selectedTarget, cloudAvailable)
  );
}

export function firstDefaultTarget(
  repoDrafts: TargetRepoDraft[],
  _cloudAvailable?: boolean,
): AutomationTargetSelection | null {
  // Cloud is culled (PRO-10): new automations never default to a cloud target.
  // Existing cloud-target automations still render their saved row (badged
  // unavailable) in edit mode, but creation no longer offers cloud.
  const localDraft = repoDrafts.find((draft) => draft.hasLocalRepository);
  return localDraft
    ? {
      executionTarget: "local",
      gitOwner: localDraft.gitOwner,
      gitRepoName: localDraft.gitRepoName,
    }
    : null;
}

export function constrainTargetToRows(
  target: AutomationTargetSelection | null,
  repoDrafts: TargetRepoDraft[],
  cloudAvailable: boolean,
): AutomationTargetSelection | null {
  if (!target) {
    return null;
  }

  const draft = repoDrafts.find((candidate) =>
    candidate.repoKey === repoKey(target.gitOwner, target.gitRepoName)
  );
  if (!draft) {
    return null;
  }

  if (target.executionTarget === "cloud") {
    return draft.hasConfiguredCloud || draft.hasCloudWorkspace || draft.hasSavedCloudTarget
      ? target
      : firstDefaultTarget([draft], cloudAvailable);
  }

  return draft.hasLocalRepository || draft.hasSavedLocalTarget
    ? target
    : firstDefaultTarget([draft], cloudAvailable);
}

export function findSelectedTargetRow(
  groups: AutomationTargetGroup[],
  selectedTarget: AutomationTargetSelection | null,
): Extract<AutomationTargetRow, { kind: "target" }> | null {
  if (!selectedTarget) {
    return null;
  }

  for (const group of groups) {
    for (const row of group.rows) {
      if (row.kind === "target" && isSameAutomationTarget(row.target, selectedTarget)) {
        return row;
      }
    }
  }

  return null;
}

function buildTargetGroup(
  draft: TargetRepoDraft,
  selectedTarget: AutomationTargetSelection | null,
  cloudAvailable: boolean,
): AutomationTargetGroup {
  const rows: AutomationTargetRow[] = [];
  // Cloud is culled (PRO-10): the picker no longer offers a cloud target for a
  // fresh automation. Only a saved cloud target (edit mode) still renders its
  // row, badged unavailable, so an existing cloud automation is honest about
  // its now-inactive target instead of silently switching to local.
  const hasCloudTargetRow = draft.hasSavedCloudTarget;

  if (hasCloudTargetRow) {
    const target = {
      executionTarget: "cloud",
      gitOwner: draft.gitOwner,
      gitRepoName: draft.gitRepoName,
    } satisfies AutomationTargetSelection;
    rows.push({
      kind: "target",
      id: automationTargetId(target),
      repoKey: draft.repoKey,
      repoLabel: draft.label,
      label: "Cloud workspace",
      description: "Run in cloud with saved repo files and setup.",
      target,
      disabledReason: !cloudAvailable
        ? "Cloud is unavailable."
        : draft.hasConfiguredCloud || draft.hasCloudWorkspace
          ? null
          : "Cloud workspace is not configured.",
      selected: isSameAutomationTarget(selectedTarget, target),
    });
  }

  if (draft.hasLocalRepository || draft.hasSavedLocalTarget) {
    const target = {
      executionTarget: "local",
      gitOwner: draft.gitOwner,
      gitRepoName: draft.gitRepoName,
    } satisfies AutomationTargetSelection;
    rows.push({
      kind: "target",
      id: automationTargetId(target),
      repoKey: draft.repoKey,
      repoLabel: draft.label,
      label: "Local worktree",
      description: "Run on this device in a local AnyHarness worktree.",
      target,
      disabledReason: draft.hasLocalRepository ? null : "Local repository is unavailable.",
      selected: isSameAutomationTarget(selectedTarget, target),
    });
  }

  return {
    repoKey: draft.repoKey,
    repoLabel: draft.label,
    gitOwner: draft.gitOwner,
    gitRepoName: draft.gitRepoName,
    rows,
  };
}
