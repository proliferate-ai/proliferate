import { buildRecentWorkItems } from "@proliferate/product-domain/workspaces/cloud-work-inventory";
import type { RecentWorkItemView } from "@proliferate/product-domain/workspaces/cloud-work-inventory";
import {
  formatGitRepoId,
  normalizeGitRepoId,
  parseGitRepoId,
} from "@proliferate/product-domain/repos/repo-id";

const HOME_RECENT_LIMIT = 6;

export interface RepoOption {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  label: string;
  description: string;
}

export type RuntimeOption =
  {
  id: "cloud";
  kind: "cloud";
  label: string;
  description: string;
  online: true;
  targetId: null;
};

export type HomeRepoConfig = {
  gitOwner: string;
  gitRepoName: string;
  configured: boolean;
};

export type HomeRuntimeTarget = {
  id: string;
  kind: string;
  displayName?: string | null;
  status: string;
  statusDetail?: {
    statusDetail?: string | null;
  } | null;
};

export function homeRecentItems(
  workspaces: Parameters<typeof buildRecentWorkItems>[0],
): RecentWorkItemView[] {
  const items = buildRecentWorkItems(workspaces, { nowMs: Date.now() });
  const nonErrorItems = items.filter((item) => item.statusIndicator.kind !== "error");
  const activeItems = nonErrorItems.filter((item) => item.statusIndicator.kind !== "idle");
  return (activeItems.length >= 3 ? activeItems : nonErrorItems).slice(0, HOME_RECENT_LIMIT);
}

export function buildRuntimeOptions(
  targets: readonly HomeRuntimeTarget[] | undefined,
): RuntimeOption[] {
  void targets;
  return [
    {
      id: "cloud",
      kind: "cloud",
      label: "Cloud sandbox",
      description: "Run in managed cloud compute",
      online: true,
      targetId: null,
    },
  ];
}

export function buildRepoOptions(
  configs: readonly HomeRepoConfig[],
  defaultRepo: string | null,
): RepoOption[] {
  const options = new Map<string, RepoOption>();
  for (const config of configs) {
    if (!config.configured) {
      continue;
    }
    const id = formatGitRepoId({
      gitOwner: config.gitOwner,
      gitRepoName: config.gitRepoName,
    });
    options.set(id, {
      id,
      gitOwner: config.gitOwner,
      gitRepoName: config.gitRepoName,
      label: id,
      description: "Configured cloud repo",
    });
  }

  const normalizedDefault = normalizeGitRepoId(defaultRepo);
  if (normalizedDefault && !options.has(normalizedDefault)) {
    const parsed = parseGitRepoId(normalizedDefault);
    if (parsed) {
      options.set(normalizedDefault, {
        id: normalizedDefault,
        gitOwner: parsed.gitOwner,
        gitRepoName: parsed.gitRepoName,
        label: normalizedDefault,
        description: "Development default",
      });
    }
  }
  return Array.from(options.values());
}

export function buildBranchOptions(input: {
  branches?: readonly string[] | null;
  defaultBranch?: string | null;
  selectedBranch?: string | null;
}): string[] {
  const options: string[] = [];
  addUniqueBranch(options, input.defaultBranch);
  addUniqueBranch(options, input.selectedBranch);
  for (const branch of input.branches ?? []) {
    addUniqueBranch(options, branch);
  }
  return options;
}

export function buildBranchName(prompt: string, nowMs = Date.now()): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 42)
    .replace(/-+$/gu, "") || "web-task";
  return `proliferate/${slug}-${nowMs.toString(36)}`;
}

export function buildWorkspaceDisplayName(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/u)[0]?.trim() || "Web task";
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

export function normalizeAgentAuthAgentKind(agentKind: string) {
  return agentKind === "claude"
    || agentKind === "codex"
    || agentKind === "opencode"
    || agentKind === "gemini"
    ? agentKind
    : null;
}

function addUniqueBranch(options: string[], branch: string | null | undefined): void {
  const trimmed = branch?.trim();
  if (trimmed && !options.includes(trimmed)) {
    options.push(trimmed);
  }
}
