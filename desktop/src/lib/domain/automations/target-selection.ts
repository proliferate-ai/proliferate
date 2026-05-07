import type {
  CloudRepoConfigSummary,
  CloudWorkspaceSummary,
} from "@/lib/access/cloud/client";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

export type AutomationExecutionTarget = "cloud" | "local";

export interface AutomationTargetSelection {
  executionTarget: AutomationExecutionTarget;
  gitOwner: string;
  gitRepoName: string;
}

export interface AutomationTargetRepoIdentity {
  gitOwner: string;
  gitRepoName: string;
}

export type AutomationTargetRow =
  | {
    kind: "target";
    id: string;
    repoKey: string;
    repoLabel: string;
    label: string;
    description: string | null;
    target: AutomationTargetSelection;
    disabledReason: string | null;
    selected: boolean;
  }
  | {
    kind: "configureCloud";
    id: string;
    repoKey: string;
    repoLabel: string;
    label: string;
    description: string | null;
    gitOwner: string;
    gitRepoName: string;
  };

export interface AutomationTargetGroup {
  repoKey: string;
  repoLabel: string;
  gitOwner: string;
  gitRepoName: string;
  rows: AutomationTargetRow[];
}

export interface AutomationTargetState {
  groups: AutomationTargetGroup[];
  selectedTarget: AutomationTargetSelection | null;
  selectedRow: Extract<AutomationTargetRow, { kind: "target" }> | null;
  canSubmit: boolean;
  disabledReason: string | null;
}

interface BuildAutomationTargetStateInput {
  repoConfigs: readonly CloudRepoConfigSummary[] | null | undefined;
  cloudWorkspaces?: readonly CloudWorkspaceSummary[] | null | undefined;
  repositories: readonly SettingsRepositoryEntry[] | null | undefined;
  selectedTarget: AutomationTargetSelection | null;
  savedTarget?: AutomationTargetSelection | null;
  editRepoIdentity?: AutomationTargetRepoIdentity | null;
  cloudAvailable?: boolean;
}

interface TargetRepoDraft {
  repoKey: string;
  gitOwner: string;
  gitRepoName: string;
  label: string;
  hasLocalRepository: boolean;
  hasConfiguredCloud: boolean;
  hasCloudWorkspace: boolean;
  hasCloudConfig: boolean;
  hasSavedCloudTarget: boolean;
  hasSavedLocalTarget: boolean;
}

export function buildAutomationTargetState({
  repoConfigs,
  cloudWorkspaces,
  repositories,
  selectedTarget,
  savedTarget = null,
  editRepoIdentity = null,
  cloudAvailable = true,
}: BuildAutomationTargetStateInput): AutomationTargetState {
  const repoDrafts = buildTargetRepoDrafts({
    repoConfigs,
    cloudWorkspaces,
    repositories,
    savedTarget,
    editRepoIdentity,
  });
  const defaultTarget = editRepoIdentity
    ? savedTarget
    : firstDefaultTarget(repoDrafts, cloudAvailable);
  const requestedTarget = selectedTarget ?? defaultTarget;
  const constrainedTarget = constrainTargetToRows(
    requestedTarget,
    repoDrafts,
    cloudAvailable,
  );
  const effectiveTarget = constrainedTarget ?? constrainTargetToRows(
    defaultTarget,
    repoDrafts,
    cloudAvailable,
  );
  const groups = repoDrafts.map((draft) =>
    buildTargetGroup(draft, effectiveTarget, cloudAvailable)
  );
  const selectedRow = findSelectedTargetRow(groups, effectiveTarget);
  const disabledReason = effectiveTarget
    ? selectedRow?.disabledReason ?? null
    : "Select a local worktree or configured cloud workspace.";

  return {
    groups,
    selectedTarget: effectiveTarget,
    selectedRow,
    canSubmit: Boolean(effectiveTarget && selectedRow && !selectedRow.disabledReason),
    disabledReason,
  };
}

export function isSameAutomationRepo(
  left: AutomationTargetRepoIdentity | null | undefined,
  right: AutomationTargetRepoIdentity | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && repoKey(left.gitOwner, left.gitRepoName) === repoKey(right.gitOwner, right.gitRepoName),
  );
}

export function automationTargetId(target: AutomationTargetSelection): string {
  return `${repoKey(target.gitOwner, target.gitRepoName)}:${target.executionTarget}`;
}

function buildTargetRepoDrafts(input: {
  repoConfigs: readonly CloudRepoConfigSummary[] | null | undefined;
  cloudWorkspaces?: readonly CloudWorkspaceSummary[] | null | undefined;
  repositories: readonly SettingsRepositoryEntry[] | null | undefined;
  savedTarget?: AutomationTargetSelection | null;
  editRepoIdentity?: AutomationTargetRepoIdentity | null;
}): TargetRepoDraft[] {
  const draftsByKey = new Map<string, TargetRepoDraft>();

  const ensureDraft = (
    gitOwner: string | null | undefined,
    gitRepoName: string | null | undefined,
  ): TargetRepoDraft | null => {
    const owner = gitOwner?.trim();
    const name = gitRepoName?.trim();
    if (!owner || !name) {
      return null;
    }
    if (input.editRepoIdentity && !isSameAutomationRepo(input.editRepoIdentity, {
      gitOwner: owner,
      gitRepoName: name,
    })) {
      return null;
    }

    const key = repoKey(owner, name);
    const existing = draftsByKey.get(key);
    if (existing) {
      return existing;
    }

    const draft: TargetRepoDraft = {
      repoKey: key,
      gitOwner: owner,
      gitRepoName: name,
      label: `${owner}/${name}`,
      hasLocalRepository: false,
      hasConfiguredCloud: false,
      hasCloudWorkspace: false,
      hasCloudConfig: false,
      hasSavedCloudTarget: false,
      hasSavedLocalTarget: false,
    };
    draftsByKey.set(key, draft);
    return draft;
  };

  for (const repository of input.repositories ?? []) {
    if (repository.gitProvider && repository.gitProvider !== "github") {
      continue;
    }
    const draft = ensureDraft(repository.gitOwner, repository.gitRepoName);
    if (draft) {
      draft.hasLocalRepository = true;
      draft.label = repository.name || draft.label;
    }
  }

  for (const repoConfig of input.repoConfigs ?? []) {
    const draft = ensureDraft(repoConfig.gitOwner, repoConfig.gitRepoName);
    if (draft) {
      draft.hasCloudConfig = true;
      draft.hasConfiguredCloud = draft.hasConfiguredCloud || repoConfig.configured;
    }
  }

  for (const workspace of input.cloudWorkspaces ?? []) {
    if (workspace.repo.provider !== "github") {
      continue;
    }
    const draft = ensureDraft(workspace.repo.owner, workspace.repo.name);
    if (draft) {
      draft.hasCloudWorkspace = true;
    }
  }

  if (input.savedTarget) {
    const draft = ensureDraft(input.savedTarget.gitOwner, input.savedTarget.gitRepoName);
    if (draft) {
      if (input.savedTarget.executionTarget === "cloud") {
        draft.hasSavedCloudTarget = true;
      } else {
        draft.hasSavedLocalTarget = true;
      }
    }
  }

  return Array.from(draftsByKey.values()).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function buildTargetGroup(
  draft: TargetRepoDraft,
  selectedTarget: AutomationTargetSelection | null,
  cloudAvailable: boolean,
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

  return {
    repoKey: draft.repoKey,
    repoLabel: draft.label,
    gitOwner: draft.gitOwner,
    gitRepoName: draft.gitRepoName,
    rows,
  };
}

function firstDefaultTarget(
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

function constrainTargetToRows(
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

function findSelectedTargetRow(
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

function isSameAutomationTarget(
  left: AutomationTargetSelection | null | undefined,
  right: AutomationTargetSelection | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.executionTarget === right.executionTarget
    && isSameAutomationRepo(left, right),
  );
}

function repoKey(gitOwner: string, gitRepoName: string): string {
  return `${gitOwner.trim().toLowerCase()}/${gitRepoName.trim().toLowerCase()}`;
}
