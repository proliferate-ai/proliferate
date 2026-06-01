import type { ComputeLaunchTargetOption } from "@/lib/domain/compute/target-options";
import type {
  AutomationTargetGroup,
  AutomationTargetRow,
  AutomationTargetSelection,
  TargetRepoDraft,
} from "@/lib/domain/automations/target/selection-types";
import {
  automationTargetId,
  isSameAutomationTarget,
  repoKey,
} from "@/lib/domain/automations/target/selection-identity";

export function buildTargetGroups(
  repoDrafts: TargetRepoDraft[],
  selectedTarget: AutomationTargetSelection | null,
  cloudAvailable: boolean,
  sshTargets: readonly ComputeLaunchTargetOption[],
): AutomationTargetGroup[] {
  return repoDrafts.map((draft) =>
    buildTargetGroup(draft, selectedTarget, cloudAvailable, sshTargets)
  );
}

export function firstDefaultTarget(
  repoDrafts: TargetRepoDraft[],
  cloudAvailable: boolean,
): AutomationTargetSelection | null {
  if (cloudAvailable) {
    const cloudDraft = repoDrafts.find((draft) =>
      draft.hasConfiguredCloud || draft.hasCloudWorkspace
    );
    if (cloudDraft) {
      return {
        executionTarget: "cloud",
        gitOwner: cloudDraft.gitOwner,
        gitRepoName: cloudDraft.gitRepoName,
      };
    }
  }

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

  if (target.executionTarget === "ssh") {
    return target.cloudTargetId ? target : firstDefaultTarget([draft], cloudAvailable);
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
  sshTargets: readonly ComputeLaunchTargetOption[],
): AutomationTargetGroup {
  const rows: AutomationTargetRow[] = [];
  const hasCloudTargetRow =
    draft.hasConfiguredCloud || draft.hasCloudWorkspace || draft.hasSavedCloudTarget;

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

  if (!draft.hasConfiguredCloud && !draft.hasCloudWorkspace
    && (draft.hasCloudConfig || draft.hasLocalRepository)) {
    rows.push({
      kind: "configureCloud",
      id: `${draft.repoKey}:configure-cloud`,
      repoKey: draft.repoKey,
      repoLabel: draft.label,
      label: "Configure cloud workspace",
      description: "Set tracked files before running this automation in cloud.",
      gitOwner: draft.gitOwner,
      gitRepoName: draft.gitRepoName,
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

  for (const sshTarget of sshTargets) {
    const target = {
      executionTarget: "ssh",
      gitOwner: draft.gitOwner,
      gitRepoName: draft.gitRepoName,
      cloudTargetId: sshTarget.id,
    } satisfies AutomationTargetSelection;
    rows.push({
      kind: "target",
      id: automationTargetId(target),
      repoKey: draft.repoKey,
      repoLabel: draft.label,
      label: sshTarget.label,
      description: sshTarget.detail,
      target,
      computeTargetOption: sshTarget,
      disabledReason: sshTarget.disabledReason,
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
