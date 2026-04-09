import type { Workspace } from "@anyharness/sdk";
import type { AuthUser } from "@/lib/integrations/auth/proliferate-auth";
import type { BranchPrefixType } from "@/stores/preferences/user-preferences-store";

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

export function buildFirstSessionBranchNamingPrompt(args: {
  placeholderBranch: string;
  prefixType: BranchPrefixType;
  user: AuthUser | null | undefined;
}): string {
  const prefix = resolveBranchPrefix(args.prefixType, args.user);
  return `Before doing anything else on the first user message in this session, if the current branch is still "${args.placeholderBranch}", rename it immediately to "${prefix}<relevant-branch-name>". Derive the suffix from that first message, use concise kebab-case, and complete the rename before any other tool call or user-facing response.`;
}

export function workspaceCurrentBranchName(
  workspace: Pick<Workspace, "currentBranch" | "originalBranch">,
): string | null {
  return workspace.currentBranch?.trim()
    || workspace.originalBranch?.trim()
    || null;
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
