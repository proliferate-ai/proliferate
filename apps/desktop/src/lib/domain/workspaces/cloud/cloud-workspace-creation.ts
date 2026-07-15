import { cloudRepositoryKey } from "@/lib/domain/settings/repositories";
import {
  type CloudWorkspaceSummary,
  type CreateCloudWorkspaceRequest,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { RepoConfigResponse } from "@proliferate/cloud-sdk";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { BranchPrefixType } from "@/lib/domain/preferences/user/model";
import { generateWorkspaceSlug } from "@/lib/domain/workspaces/creation/workspace-slug";
import {
  buildBranchName,
  resolveBranchPrefix,
} from "@/lib/domain/workspaces/creation/branch-naming";

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
  repoConfigs: readonly RepoConfigResponse[] | null | undefined,
): Set<string> {
  return new Set(
    (repoConfigs ?? [])
      .filter((repo) => repo.environments.some((environment) => environment.kind === "cloud"))
      .map((repo) => cloudRepositoryKey(repo.gitOwner, repo.gitRepoName)),
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
      generatedName: true,
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
      generatedName: request.generatedName ?? false,
    },
    triedBranchNames: new Set([branchName]),
  };
}

export function isCloudWorkspaceBranchConflictError(error: unknown): boolean {
  const code = error instanceof Error
    ? (error as { code?: unknown }).code
    : null;
  return code === "github_branch_already_exists"
    || code === "cloud_branch_already_exists";
}

function cloudWorkspaceErrorCode(error: unknown): string | null {
  const code = error instanceof Error ? (error as { code?: unknown }).code : null;
  return typeof code === "string" ? code : null;
}

// Stable server-side codes for a routine billing gate on the cloud start path
// (see server billing/authorization.py). Includes the legacy pre-split code so
// an older server still surfaces a useful message.
const CLOUD_WORKSPACE_BILLING_BLOCK_CODES = new Set<string>([
  "billing_credits_exhausted",
  "billing_start_blocked",
  "billing_resume_blocked",
]);

export function isCloudWorkspaceBillingBlockError(error: unknown): boolean {
  const code = cloudWorkspaceErrorCode(error);
  return code !== null && CLOUD_WORKSPACE_BILLING_BLOCK_CODES.has(code);
}

/**
 * Resolve the user-facing message for a failed cloud workspace creation.
 *
 * The server already returns a clear message on a billing gate (a 402 with a
 * human message + stable code); we surface that verbatim instead of a generic
 * "interrupted" string. When the block is specifically "out of included hours"
 * we append an actionable pointer to Settings → Billing.
 */
export function resolveCloudWorkspaceCreateFailureMessage(
  error: unknown,
  fallback: string,
): string {
  const base = error instanceof Error && error.message ? error.message : fallback;
  if (cloudWorkspaceErrorCode(error) === "billing_credits_exhausted") {
    return `${base} Upgrade your plan in Settings → Billing.`;
  }
  return base;
}
