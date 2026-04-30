import { cloudRepositoryKey } from "@/lib/domain/settings/repositories";
import {
  type CloudRepoConfigSummary,
  type CloudWorkspaceSummary,
  type CreateCloudWorkspaceRequest,
  ProliferateClientError,
} from "@/lib/integrations/cloud/client";
import type { AuthUser } from "@/lib/integrations/auth/proliferate-auth";
import type { BranchPrefixType } from "@/stores/preferences/user-preferences-store";
import { generateWorkspaceSlug } from "./arrival";
import {
  buildBranchName,
  resolveBranchPrefix,
} from "./branch-naming";

export interface CloudWorkspaceRepoTarget {
  gitOwner: string;
  gitRepoName: string;
  baseBranch?: string | null;
}

export type CloudWorkspaceCreateInput =
  | CloudWorkspaceRepoTarget
  | CreateCloudWorkspaceRequest;

export type CloudRepoActionState =
  | { kind: "hidden"; label: null }
  | { kind: "loading"; label: "Loading cloud..." }
  | { kind: "configure"; label: "Configure cloud" }
  | { kind: "create"; label: "New cloud workspace" };

interface CloudRepoActionRepository {
  sourceRoot: string;
  gitOwner?: string | null;
  gitRepoName?: string | null;
}

export function buildConfiguredCloudRepoKeys(
  configs: readonly CloudRepoConfigSummary[] | null | undefined,
): Set<string> {
  return new Set(
    (configs ?? [])
      .filter((config) => config.configured)
      .map((config) => cloudRepositoryKey(config.gitOwner, config.gitRepoName)),
  );
}

export function resolveCloudRepoActionState(args: {
  repoTarget: CloudWorkspaceRepoTarget | null;
  configuredRepoKeys: ReadonlySet<string>;
  isInitialConfigLoad: boolean;
}): CloudRepoActionState {
  if (!args.repoTarget) {
    return { kind: "hidden", label: null };
  }
  if (args.isInitialConfigLoad) {
    return { kind: "loading", label: "Loading cloud..." };
  }

  return args.configuredRepoKeys.has(
    cloudRepositoryKey(args.repoTarget.gitOwner, args.repoTarget.gitRepoName),
  )
    ? { kind: "create", label: "New cloud workspace" }
    : { kind: "configure", label: "Configure cloud" };
}

export function buildCloudRepoActionBySourceRoot(args: {
  repositories: readonly CloudRepoActionRepository[];
  cloudActive: boolean;
  configuredRepoKeys: ReadonlySet<string>;
  isInitialConfigLoad: boolean;
}): Record<string, CloudRepoActionState> {
  const actions: Record<string, CloudRepoActionState> = {};
  for (const repository of args.repositories) {
    const gitOwner = repository.gitOwner?.trim();
    const gitRepoName = repository.gitRepoName?.trim();
    const repoTarget = gitOwner && gitRepoName
      ? { gitOwner, gitRepoName }
      : null;
    actions[repository.sourceRoot] = args.cloudActive
      ? resolveCloudRepoActionState({
        repoTarget,
        configuredRepoKeys: args.configuredRepoKeys,
        isInitialConfigLoad: args.isInitialConfigLoad,
      })
      : { kind: "hidden", label: null };
  }
  return actions;
}

export function collectKnownCloudBranchNames(args: {
  target: CloudWorkspaceRepoTarget;
  cloudWorkspaces: readonly CloudWorkspaceSummary[];
}): Set<string> {
  return new Set(
    args.cloudWorkspaces
      .filter((workspace) =>
        workspace.repo.provider === "github"
        && workspace.repo.owner === args.target.gitOwner
        && workspace.repo.name === args.target.gitRepoName
      )
      .map((workspace) => workspace.repo.branch.trim())
      .filter(Boolean),
  );
}

export function isCreateCloudWorkspaceRequest(
  input: CloudWorkspaceCreateInput,
): input is CreateCloudWorkspaceRequest {
  return "gitProvider" in input;
}

export function getCloudWorkspaceRepoTarget(
  input: CloudWorkspaceCreateInput,
): CloudWorkspaceRepoTarget {
  const baseTarget = {
    gitOwner: input.gitOwner,
    gitRepoName: input.gitRepoName,
  };
  const baseBranch = input.baseBranch?.trim();
  return baseBranch ? { ...baseTarget, baseBranch } : baseTarget;
}

export function collectTakenCloudWorkspaceSlugs(args: {
  branchPrefixType: BranchPrefixType;
  authUser: AuthUser | null;
  knownBranchNames: ReadonlySet<string>;
  triedBranchNames: ReadonlySet<string>;
}): Set<string> {
  const prefix = resolveBranchPrefix(args.branchPrefixType, args.authUser);
  const taken = new Set<string>();

  for (const branchName of [...args.knownBranchNames, ...args.triedBranchNames]) {
    const trimmed = branchName.trim();
    if (!trimmed) {
      continue;
    }
    if (!prefix) {
      taken.add(trimmed);
      continue;
    }
    if (!trimmed.startsWith(prefix)) {
      continue;
    }
    const suffix = trimmed.slice(prefix.length).trim();
    if (suffix) {
      taken.add(suffix);
    }
  }

  return taken;
}

export function buildNextCloudWorkspaceAttempt(args: {
  target: CloudWorkspaceRepoTarget;
  branchPrefixType: BranchPrefixType;
  authUser: AuthUser | null;
  knownBranchNames: ReadonlySet<string>;
  triedBranchNames: ReadonlySet<string>;
}): {
  branchName: string;
  request: CreateCloudWorkspaceRequest;
  triedBranchNames: Set<string>;
} {
  const branchSlug = generateWorkspaceSlug(
    collectTakenCloudWorkspaceSlugs({
      branchPrefixType: args.branchPrefixType,
      authUser: args.authUser,
      knownBranchNames: args.knownBranchNames,
      triedBranchNames: args.triedBranchNames,
    }),
  );
  const branchName = buildBranchName(
    branchSlug,
    args.branchPrefixType,
    args.authUser,
  );
  const nextTriedBranchNames = new Set(args.triedBranchNames);
  nextTriedBranchNames.add(branchName);

  return {
    branchName,
    request: {
      gitProvider: "github",
      gitOwner: args.target.gitOwner,
      gitRepoName: args.target.gitRepoName,
      baseBranch: args.target.baseBranch?.trim() || undefined,
      branchName,
      displayName: null,
    },
    triedBranchNames: nextTriedBranchNames,
  };
}

export function buildCloudWorkspaceAttemptFromRequest(
  request: CreateCloudWorkspaceRequest,
): {
  branchName: string;
  request: CreateCloudWorkspaceRequest;
  triedBranchNames: Set<string>;
} {
  const branchName = request.branchName.trim();
  return {
    branchName,
    request: {
      ...request,
      branchName,
      displayName: request.displayName ?? null,
    },
    triedBranchNames: new Set([branchName]),
  };
}

export function isCloudWorkspaceBranchConflictError(error: unknown): boolean {
  return error instanceof ProliferateClientError
    && (
      error.code === "github_branch_already_exists"
      || error.code === "cloud_branch_already_exists"
    );
}
