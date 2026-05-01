import type { GitBranchRef } from "@anyharness/sdk";

export function resolveAutoDetectedBranch(branchRefs: GitBranchRef[]): string | null {
  const branches = branchRefs
    .filter((branch) => !branch.isRemote)
    .sort((a, b) => a.name.localeCompare(b.name));

  const gitDefault = branches.find((branch) => branch.isDefault)
    ?? branches.find((branch) => branch.name === "main")
    ?? branches[0];

  return gitDefault?.name ?? null;
}
