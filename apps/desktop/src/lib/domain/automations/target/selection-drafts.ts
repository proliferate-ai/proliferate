import type {
  AutomationTargetRepoIdentity,
  AutomationTargetSelection,
  BuildAutomationTargetStateInput,
  TargetRepoDraft,
} from "@/lib/domain/automations/target/selection-types";
import {
  isSameAutomationRepo,
  repoKey,
} from "@/lib/domain/automations/target/selection-identity";

export function buildTargetRepoDrafts(input: {
  repoConfigs: BuildAutomationTargetStateInput["repoConfigs"];
  cloudWorkspaces?: BuildAutomationTargetStateInput["cloudWorkspaces"];
  repositories: BuildAutomationTargetStateInput["repositories"];
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
