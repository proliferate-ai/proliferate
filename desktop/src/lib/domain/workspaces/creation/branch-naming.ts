import type { Workspace } from "@anyharness/sdk";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { BranchPrefixType } from "@/lib/domain/preferences/user-preferences";

export function resolveBranchPrefix(
  prefixType: BranchPrefixType,
  user: AuthUser | null | undefined,
): string {
  if (prefixType === "proliferate") {
    return "proliferate/";
  }

  if (prefixType === "github_username" && user?.github_login?.trim()) {
    return `${user.github_login.trim()}/`;
  }

  return "";
}

export function buildBranchName(
  baseSlug: string,
  prefixType: BranchPrefixType,
  user: AuthUser | null | undefined,
): string {
  return `${resolveBranchPrefix(prefixType, user)}${baseSlug}`;
}

export function workspaceCurrentBranchName(
  workspace: Pick<Workspace, "currentBranch" | "originalBranch">,
): string | null {
  const currentBranch = normalizeBranchName(workspace.currentBranch);
  if (currentBranch && currentBranch !== "HEAD") {
    return currentBranch;
  }

  return normalizeBranchName(workspace.originalBranch);
}

function normalizeBranchName(branchName: string | null | undefined): string | null {
  const trimmed = branchName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function humanizeBranchName(branchName: string): string {
  const trimmed = branchName.trim();
  if (!trimmed) {
    return branchName;
  }

  const suffix = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
  const spaced = suffix.replace(/[-_]+/g, " ").trim();
  if (!spaced) {
    return suffix;
  }

  return `${spaced[0]!.toUpperCase()}${spaced.slice(1)}`;
}
