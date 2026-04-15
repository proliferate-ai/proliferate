import type {
  AgentSummary,
  GitBranchRef,
  ModelRegistry,
  Workspace,
} from "@anyharness/sdk";
import { compareChatLaunchKinds } from "@/config/chat-launch";
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
