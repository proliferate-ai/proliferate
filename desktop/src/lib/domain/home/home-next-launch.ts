import type {
  AgentSummary,
  GitBranchRef,
  ModelRegistry,
  Workspace,
} from "@anyharness/sdk";
import { compareChatLaunchKinds } from "@/config/chat-launch";
import {
  buildAgentModelGroups,
  resolveAgentModelInfo,
  resolveEffectiveAgentModelSelection,
  type AgentModelGroup,
  type AgentModelInfo,
  type AgentModelOption,
  type AgentModelSelection,
} from "@/lib/domain/agents/model-options";
import { resolveModelForRegistry } from "@/lib/domain/chat/session-config";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

export type HomeNextRepositorySelection =
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "repository"; sourceRoot: string };

export interface HomeNextAgentOption {
  kind: string;
  displayName: string;
  modelId: string | null;
  modelDisplayName: string | null;
  disabledReason: string | null;
}

export interface HomeNextRepositoryTarget {
  kind: "repository";
  repository: SettingsRepositoryEntry;
  branchName: string;
  existingWorkspaceId: string | null;
}

export interface HomeNextCoworkTarget {
  kind: "cowork";
}

export type HomeNextLaunchTarget = HomeNextCoworkTarget | HomeNextRepositoryTarget;

export type HomeNextDestination = "cowork" | "repository";

export type HomeNextRepoLaunchKind = "worktree" | "local" | "cloud";

export type HomeNextModelSelection = AgentModelSelection;
export type HomeNextModelOption = AgentModelOption;
export type HomeNextModelGroup = AgentModelGroup;
export type HomeNextModelInfo = AgentModelInfo;

export interface HomeNextLaunchPreferences {
  defaultChatAgentKind: string;
  defaultChatModelId: string;
}

export type HomeLaunchTarget =
  | { kind: "cowork" }
  | { kind: "local"; sourceRoot: string; existingWorkspaceId: string | null }
  | { kind: "worktree"; repoRootId: string; sourceWorkspaceId: string | null; baseBranch: string }
  | { kind: "cloud"; gitOwner: string; gitRepoName: string; baseBranch: string };

export function buildHomeNextAgentOptions(
  agents: AgentSummary[],
  modelRegistries: ModelRegistry[],
): HomeNextAgentOption[] {
  const registryByKind = new Map(modelRegistries.map((registry) => [registry.kind, registry]));

  return agents
    .filter((agent) => agent.readiness === "ready")
    .map((agent) => {
      const registry = registryByKind.get(agent.kind) ?? null;
      const model = registry ? resolveModelForRegistry(registry, registry.defaultModelId) : null;
      return {
        kind: agent.kind,
        displayName: registry?.displayName ?? agent.displayName,
        modelId: model?.id ?? null,
        modelDisplayName: model?.displayName ?? null,
        disabledReason: model ? null : "No launchable model",
      } satisfies HomeNextAgentOption;
    })
    .sort((left, right) =>
      compareChatLaunchKinds(
        left.kind,
        right.kind,
        left.displayName,
        right.displayName,
      )
    );
}

export function buildHomeNextModelGroups(
  agents: AgentSummary[],
  modelRegistries: ModelRegistry[],
  selected: HomeNextModelSelection | null,
): HomeNextModelGroup[] {
  return buildAgentModelGroups({ agents, modelRegistries, selected });
}

export function resolveEffectiveHomeModelSelection(
  groups: HomeNextModelGroup[],
  override: HomeNextModelSelection | null | undefined,
  preferences: HomeNextLaunchPreferences,
): HomeNextModelSelection | null {
  return resolveEffectiveAgentModelSelection(groups, override, {
    defaultAgentKind: preferences.defaultChatAgentKind,
    defaultModelId: preferences.defaultChatModelId,
  });
}

export function resolveHomeNextModelInfo(
  groups: HomeNextModelGroup[],
  modelRegistries: ModelRegistry[],
  selection: HomeNextModelSelection | null | undefined,
): HomeNextModelInfo | null {
  return resolveAgentModelInfo(groups, modelRegistries, selection);
}

export function resolveSelectedHomeNextAgentOption(
  options: HomeNextAgentOption[],
  selectedKind: string | null,
): HomeNextAgentOption | null {
  return (
    options.find((option) => option.kind === selectedKind)
    ?? options.find((option) => option.modelId !== null)
    ?? options[0]
    ?? null
  );
}

export function resolveHomeNextRepositorySelection(
  repositories: SettingsRepositoryEntry[],
  selection: HomeNextRepositorySelection,
): SettingsRepositoryEntry | null {
  if (selection.kind === "none") {
    return null;
  }
  if (selection.kind === "repository") {
    return repositories.find((repository) => repository.sourceRoot === selection.sourceRoot)
      ?? repositories[0]
      ?? null;
  }
  return repositories[0] ?? null;
}

export function localBranchNames(branchRefs: GitBranchRef[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const branch of branchRefs) {
    const name = branch.name.trim();
    if (!name || branch.isRemote || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }

  return names.sort((left, right) => left.localeCompare(right));
}

export function resolveHomeNextDefaultBranchName(input: {
  branchRefs: GitBranchRef[];
  savedDefaultBranch?: string | null;
  repoRootDefaultBranch?: string | null;
}): string | null {
  const branchNames = localBranchNames(input.branchRefs);
  const branchNameSet = new Set(branchNames);
  const savedDefaultBranch = input.savedDefaultBranch?.trim();
  if (savedDefaultBranch && branchNameSet.has(savedDefaultBranch)) {
    return savedDefaultBranch;
  }

  const repoRootDefaultBranch = input.repoRootDefaultBranch?.trim();
  if (repoRootDefaultBranch && branchNameSet.has(repoRootDefaultBranch)) {
    return repoRootDefaultBranch;
  }

  const gitDefaultBranch = input.branchRefs.find((branch) =>
    branch.isDefault && !branch.isRemote && branchNameSet.has(branch.name.trim())
  )?.name.trim();
  if (gitDefaultBranch) {
    return gitDefaultBranch;
  }

  return branchNames[0] ?? null;
}

export function findHomeNextLocalWorkspace(input: {
  workspaces: Workspace[];
  repoRootId: string;
  archivedWorkspaceIds: string[];
  workspaceLastInteracted: Record<string, string>;
}): Workspace | null {
  const archivedWorkspaceIdSet = new Set(input.archivedWorkspaceIds);
  return input.workspaces
    .filter((workspace) =>
      workspace.repoRootId === input.repoRootId
      && workspace.kind === "local"
      && workspace.surface !== "cowork"
      && !archivedWorkspaceIdSet.has(workspace.id)
    )
    .sort((left, right) => {
      const byInteraction =
        timestamp(input.workspaceLastInteracted[right.id])
        - timestamp(input.workspaceLastInteracted[left.id]);
      if (byInteraction !== 0) {
        return byInteraction;
      }

      const byUpdatedAt = timestamp(right.updatedAt) - timestamp(left.updatedAt);
      if (byUpdatedAt !== 0) {
        return byUpdatedAt;
      }

      return left.id.localeCompare(right.id);
    })[0] ?? null;
}

export function resolveHomeLaunchTarget(input: {
  destination: HomeNextDestination;
  repository: SettingsRepositoryEntry | null;
  repoLaunchKind: HomeNextRepoLaunchKind;
  baseBranch: string | null;
  existingLocalWorkspaceId: string | null;
}): HomeLaunchTarget | null {
  if (input.destination === "cowork") {
    return { kind: "cowork" };
  }

  const repository = input.repository;
  if (!repository) {
    return null;
  }

  if (input.repoLaunchKind === "local") {
    return {
      kind: "local",
      sourceRoot: repository.sourceRoot,
      existingWorkspaceId: input.existingLocalWorkspaceId,
    };
  }

  if (!input.baseBranch) {
    return null;
  }

  if (input.repoLaunchKind === "cloud") {
    const gitOwner = repository.gitOwner?.trim();
    const gitRepoName = repository.gitRepoName?.trim();
    if (!gitOwner || !gitRepoName) {
      return null;
    }

    return {
      kind: "cloud",
      gitOwner,
      gitRepoName,
      baseBranch: input.baseBranch,
    };
  }

  return {
    kind: "worktree",
    repoRootId: repository.repoRootId,
    sourceWorkspaceId: repository.localWorkspaceId,
    baseBranch: input.baseBranch,
  };
}

function rawWorkspaceBranch(workspace: Pick<Workspace, "currentBranch" | "originalBranch">): string | null {
  return workspace.currentBranch?.trim()
    || workspace.originalBranch?.trim()
    || null;
}

function timestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function findHomeNextMatchingWorkspace(input: {
  workspaces: Workspace[];
  repoRootId: string;
  branchName: string;
  archivedWorkspaceIds: string[];
  workspaceLastInteracted: Record<string, string>;
}): Workspace | null {
  const archivedWorkspaceIdSet = new Set(input.archivedWorkspaceIds);

  return input.workspaces
    .filter((workspace) =>
      workspace.repoRootId === input.repoRootId
      && workspace.surface !== "cowork"
      && !archivedWorkspaceIdSet.has(workspace.id)
      && rawWorkspaceBranch(workspace) === input.branchName
    )
    .sort((left, right) => {
      const byInteraction =
        timestamp(input.workspaceLastInteracted[right.id])
        - timestamp(input.workspaceLastInteracted[left.id]);
      if (byInteraction !== 0) {
        return byInteraction;
      }

      const byUpdatedAt = timestamp(right.updatedAt) - timestamp(left.updatedAt);
      if (byUpdatedAt !== 0) {
        return byUpdatedAt;
      }

      return left.id.localeCompare(right.id);
    })[0] ?? null;
}
