import {
  isMobilityPromptPrimaryActionPending,
  type MobilityPromptState,
} from "@/lib/domain/workspaces/mobility/mobility-prompt";

export function isMobilityFooterPromptActionPending(
  prompt: MobilityPromptState | null,
  pending: {
    isBranchSyncing: boolean;
    isGitHubSignInSubmitting: boolean;
    isOpeningGitHubAccess: boolean;
  },
): boolean {
  if (!prompt) {
    return false;
  }

  return isMobilityPromptPrimaryActionPending(prompt, {
    isBranchSyncing: pending.isBranchSyncing,
  })
    || (prompt.primaryActionKind === "connect_github" && pending.isGitHubSignInSubmitting)
    || (prompt.primaryActionKind === "manage_github_access" && pending.isOpeningGitHubAccess);
}
