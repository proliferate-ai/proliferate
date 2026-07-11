import type {
  CurrentPullRequestResponse,
  GitStatusSnapshot,
} from "@anyharness/sdk";
import type {
  PublishIntent,
  PublishWorkflowStep,
} from "@/lib/domain/workspaces/creation/publish-workflow-model";

export function publishStatusLabel(input: {
  gitStatus: GitStatusSnapshot | null;
  wantsPublish: boolean;
  hasDirtyChanges: boolean;
}): string | null {
  if (!input.gitStatus || !input.wantsPublish || input.hasDirtyChanges) return null;
  const upstream = input.gitStatus.upstreamBranch?.trim() || null;
  if (input.gitStatus.ahead > 0 && upstream) {
    return `Push ${input.gitStatus.ahead} local commit${input.gitStatus.ahead === 1 ? "" : "s"} to ${upstream}.`;
  }
  if (!upstream && input.gitStatus.actions.canPush) {
    return "Publish this branch and set its upstream.";
  }
  if (upstream) {
    return `This branch is up to date with ${upstream}.`;
  }
  return "This branch has no upstream yet.";
}

export function publishWorkflowSummary(input: {
  intent: PublishIntent;
  gitStatus: GitStatusSnapshot | null;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  publishStatus: string | null;
  workflowSteps: PublishWorkflowStep[];
}): string {
  const hasStageStep = input.workflowSteps.some((step) => step.kind === "stage");
  const hasCommitStep = input.workflowSteps.some((step) => step.kind === "commit");
  const hasPushStep = input.workflowSteps.some((step) => step.kind === "push");
  const hasCreatePrStep = input.workflowSteps.some((step) => step.kind === "create_pull_request");
  const pushLabel = (input.gitStatus?.actions.pushLabel ?? "Publish").toLowerCase();

  if (input.workflowSteps.length === 0) {
    if (input.intent === "pull_request" && input.existingPr) {
      return "A pull request already exists for this branch.";
    }
    if (input.publishStatus) {
      return input.publishStatus;
    }
    if (input.intent === "commit") {
      return "Commit changes in this workspace.";
    }
    if (input.intent === "publish") {
      return "Publish local commits when this branch is ready.";
    }
    return "Create a pull request from this branch.";
  }

  if (input.intent === "commit") {
    return hasStageStep
      ? "Stage unstaged changes, then commit them."
      : "Commit the selected staged changes.";
  }

  if (input.intent === "publish") {
    if (hasCommitStep && hasPushStep) {
      return hasStageStep
        ? `Stage unstaged changes, commit them, then ${pushLabel}.`
        : `Commit changes, then ${pushLabel}.`;
    }
    if (hasPushStep) {
      return input.publishStatus ?? "Publish this branch.";
    }
    return "Commit changes before publishing this branch.";
  }

  if (input.existingPr && !hasCreatePrStep) {
    if (hasCommitStep && hasPushStep) {
      return hasStageStep
        ? "Stage unstaged changes, commit them, then update the existing pull request branch."
        : "Commit changes, then update the existing pull request branch.";
    }
    if (hasPushStep) {
      return "Update the existing pull request branch.";
    }
    return "A pull request already exists for this branch.";
  }

  if (hasCommitStep && hasPushStep && hasCreatePrStep) {
    return hasStageStep
      ? "Stage unstaged changes, commit them, publish the branch, then create a pull request."
      : "Commit changes, publish the branch, then create a pull request.";
  }
  if (hasPushStep && hasCreatePrStep) {
    return "Publish this branch, then create a pull request.";
  }
  if (hasCommitStep && hasCreatePrStep) {
    return hasStageStep
      ? "Stage unstaged changes, commit them, then create a pull request."
      : "Commit changes, then create a pull request.";
  }
  if (hasCreatePrStep) {
    return "Create a pull request from this branch.";
  }
  if (hasPushStep) {
    return "Publish this branch.";
  }
  return "Prepare this branch for a pull request.";
}

export function publishPrimaryLabel(input: {
  intent: PublishIntent;
  gitStatus: GitStatusSnapshot | null;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  hasDirtyChanges: boolean;
  workflowSteps: PublishWorkflowStep[];
}): string {
  if (input.intent === "pull_request") {
    const hasUnpushedCommits = (input.gitStatus?.ahead ?? 0) > 0
      || Boolean(input.gitStatus?.actions.canPush);
    if (input.hasDirtyChanges) {
      if (!input.existingPr) return "Commit, publish, create PR";
      const label = input.gitStatus?.actions.pushLabel ?? "Publish";
      return `Commit and ${label.toLowerCase()}`;
    }
    if (input.existingPr && !hasUnpushedCommits && input.workflowSteps.length === 0) {
      return "View pull request";
    }
    if (!input.existingPr && hasUnpushedCommits && input.workflowSteps.length === 0) {
      return "Publish and create PR";
    }
    const hasCommitStep = input.workflowSteps.some((step) => step.kind === "commit");
    const hasPushStep = input.workflowSteps.some((step) => step.kind === "push");
    const hasCreatePrStep = input.workflowSteps.some((step) => step.kind === "create_pull_request");
    if (hasCommitStep && hasPushStep && hasCreatePrStep) return "Commit, publish, create PR";
    if (hasPushStep && hasCreatePrStep) return "Publish and create PR";
    if (hasCreatePrStep) return hasCommitStep ? "Commit and create PR" : "Create PR";
    if (hasCommitStep && hasPushStep) {
      const label = input.gitStatus?.actions.pushLabel ?? "Publish";
      return `Commit and ${label.toLowerCase()}`;
    }
    if (hasPushStep) return input.gitStatus?.actions.pushLabel ?? "Publish";
    return input.existingPr ? "View pull request" : "Create PR";
  }
  if (input.intent === "publish") {
    const label = input.gitStatus?.actions.pushLabel ?? "Publish";
    return input.hasDirtyChanges ? `Commit and ${label.toLowerCase()}` : label;
  }
  return "Commit";
}
