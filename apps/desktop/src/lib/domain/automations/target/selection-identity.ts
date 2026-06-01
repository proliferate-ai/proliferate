import type {
  AutomationTargetRepoIdentity,
  AutomationTargetSelection,
} from "@/lib/domain/automations/target/selection-types";

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
  return [
    repoKey(target.gitOwner, target.gitRepoName),
    target.executionTarget,
    target.cloudTargetId ?? null,
  ].filter(Boolean).join(":");
}

export function isSameAutomationTarget(
  left: AutomationTargetSelection | null | undefined,
  right: AutomationTargetSelection | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.executionTarget === right.executionTarget
    && (left.executionTarget !== "ssh" || left.cloudTargetId === right.cloudTargetId)
    && isSameAutomationRepo(left, right),
  );
}

export function repoKey(gitOwner: string, gitRepoName: string): string {
  return `${gitOwner.trim().toLowerCase()}/${gitRepoName.trim().toLowerCase()}`;
}
