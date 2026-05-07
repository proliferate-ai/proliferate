import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type {
  LocalAutomationRunClaimResponse,
} from "@/lib/access/cloud/client";

export interface LocalAutomationRepositoryIdentity {
  provider: string;
  owner: string;
  name: string;
}

export interface LocalAutomationRepoCandidate {
  repoRoot: RepoRoot;
  representativeWorkspace: Workspace | null;
  identity: LocalAutomationRepositoryIdentity;
}

export interface LocalAutomationWorktreePlan {
  repoRootId: string;
  branchName: string;
  workspaceName: string;
  displayName: string;
  targetPath: string;
  baseRef: string;
  setupScript: string | null;
}

const MAX_WORKSPACE_DISPLAY_NAME_LENGTH = 160;
const DEFAULT_AUTOMATION_WORKSPACE_DISPLAY_NAME = "Automation run";

export const LOCAL_AUTOMATION_ERROR_CODES = {
  repoNotAvailable: "local_repo_not_available",
  agentNotReady: "local_agent_not_ready",
  workspaceCreateFailed: "local_workspace_create_failed",
  workspaceSetupFailed: "local_workspace_setup_failed",
  sessionCreateFailed: "local_session_create_failed",
  configApplyFailed: "local_config_apply_failed",
  promptSendFailed: "local_prompt_send_failed",
  dispatchUncertain: "dispatch_uncertain",
  staleClaim: "stale_claim",
  unexpectedExecutorError: "local_unexpected_executor_error",
} as const;

export function canonicalAutomationRepoIdentity(
  provider: string | null | undefined,
  owner: string | null | undefined,
  name: string | null | undefined,
): LocalAutomationRepositoryIdentity | null {
  const normalizedProvider = provider?.trim().toLowerCase();
  const normalizedOwner = owner?.trim().toLowerCase();
  const normalizedName = name?.trim().toLowerCase();
  if (!normalizedProvider || !normalizedOwner || !normalizedName) {
    return null;
  }
  return {
    provider: normalizedProvider,
    owner: normalizedOwner,
    name: normalizedName,
  };
}

export function automationRepoIdentityKey(identity: LocalAutomationRepositoryIdentity): string {
  return `${identity.provider}:${identity.owner}/${identity.name}`;
}

export function buildLocalAutomationRepoCandidates(args: {
  repoRoots: readonly RepoRoot[];
  workspaces: readonly Workspace[];
}): LocalAutomationRepoCandidate[] {
  const workspacesByRepoRoot = new Map<string, Workspace[]>();
  for (const workspace of args.workspaces) {
    if (!workspace.repoRootId) continue;
    const entries = workspacesByRepoRoot.get(workspace.repoRootId) ?? [];
    entries.push(workspace);
    workspacesByRepoRoot.set(workspace.repoRootId, entries);
  }

  const byIdentity = new Map<string, LocalAutomationRepoCandidate>();
  for (const repoRoot of args.repoRoots) {
    const identity = canonicalAutomationRepoIdentity(
      repoRoot.remoteProvider,
      repoRoot.remoteOwner,
      repoRoot.remoteRepoName,
    );
    if (!identity || identity.provider !== "github") {
      continue;
    }
    const repoWorkspaces = [...(workspacesByRepoRoot.get(repoRoot.id) ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id)
    );
    const representativeWorkspace =
      repoWorkspaces.find((workspace) => workspace.kind === "local")
      ?? repoWorkspaces[0]
      ?? null;
    const candidate = { repoRoot, representativeWorkspace, identity };
    const key = automationRepoIdentityKey(identity);
    const current = byIdentity.get(key);
    if (!current || repoRoot.id.localeCompare(current.repoRoot.id) < 0) {
      byIdentity.set(key, candidate);
    }
  }

  return [...byIdentity.values()].sort((a, b) => a.repoRoot.id.localeCompare(b.repoRoot.id));
}

export function findCandidateForClaim(
  candidates: readonly LocalAutomationRepoCandidate[],
  claim: Pick<
    LocalAutomationRunClaimResponse,
    "gitProviderSnapshot" | "gitOwnerSnapshot" | "gitRepoNameSnapshot"
  >,
): LocalAutomationRepoCandidate | null {
  const identity = canonicalAutomationRepoIdentity(
    claim.gitProviderSnapshot,
    claim.gitOwnerSnapshot,
    claim.gitRepoNameSnapshot,
  );
  if (!identity) {
    return null;
  }
  const key = automationRepoIdentityKey(identity);
  return candidates.find((candidate) => automationRepoIdentityKey(candidate.identity) === key)
    ?? null;
}

export function safeAutomationSlug(title: string, fallback: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 48)
    .replace(/\.{2,}/g, ".")
    .replace(/^[-._]+|[-._]+$/g, "");
  return slug || fallback;
}

export function normalizeAutomationWorkspaceDisplayName(title: string): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  const truncated = normalized.slice(0, MAX_WORKSPACE_DISPLAY_NAME_LENGTH).trim();
  return truncated || DEFAULT_AUTOMATION_WORKSPACE_DISPLAY_NAME;
}

export function shouldUpdateAutomationWorkspaceDisplayName(args: {
  currentDisplayName: string | null | undefined;
  workspaceName: string;
}): boolean {
  const current = args.currentDisplayName?.trim();
  return !current || current === args.workspaceName;
}

export function buildLocalAutomationWorktreePlan(args: {
  claim: LocalAutomationRunClaimResponse;
  candidate: LocalAutomationRepoCandidate;
  homeDir: string;
  defaultBranch?: string | null;
  setupScript?: string | null;
}): LocalAutomationWorktreePlan {
  const runSuffix = args.claim.id.replace(/-/g, "").slice(0, 16) || "run";
  const slug = safeAutomationSlug(args.claim.titleSnapshot, "run");
  const workspaceName = `automation-${slug}-${runSuffix}`;
  const repoName =
    args.candidate.repoRoot.remoteRepoName?.trim()
    || args.candidate.representativeWorkspace?.gitRepoName
    || args.candidate.repoRoot.path.split("/").filter(Boolean).pop()
    || "repo";
  const baseRef =
    args.defaultBranch?.trim()
    || args.candidate.repoRoot.defaultBranch?.trim()
    || args.candidate.representativeWorkspace?.currentBranch?.trim()
    || args.candidate.representativeWorkspace?.originalBranch?.trim()
    || "HEAD";

  return {
    repoRootId: args.candidate.repoRoot.id,
    branchName: `automation/${slug}-${runSuffix}`,
    workspaceName,
    displayName: normalizeAutomationWorkspaceDisplayName(args.claim.titleSnapshot),
    targetPath: `${args.homeDir}/.proliferate/worktrees/${repoName}/${workspaceName}`,
    baseRef,
    setupScript: args.setupScript?.trim() || null,
  };
}

export function workspaceMatchesAutomationPlan(args: {
  workspace: Workspace;
  repoRoot: RepoRoot | null;
  plan: Pick<LocalAutomationWorktreePlan, "branchName" | "repoRootId">;
  claim: Pick<
    LocalAutomationRunClaimResponse,
    "gitProviderSnapshot" | "gitOwnerSnapshot" | "gitRepoNameSnapshot"
  >;
}): boolean {
  if (args.workspace.repoRootId !== args.plan.repoRootId) {
    return false;
  }
  const branch = args.workspace.currentBranch?.trim() || args.workspace.originalBranch?.trim();
  if (branch !== args.plan.branchName) {
    return false;
  }
  const workspaceIdentity = canonicalAutomationRepoIdentity(
    args.repoRoot?.remoteProvider ?? args.workspace.gitProvider,
    args.repoRoot?.remoteOwner ?? args.workspace.gitOwner,
    args.repoRoot?.remoteRepoName ?? args.workspace.gitRepoName,
  );
  const claimIdentity = canonicalAutomationRepoIdentity(
    args.claim.gitProviderSnapshot,
    args.claim.gitOwnerSnapshot,
    args.claim.gitRepoNameSnapshot,
  );
  return Boolean(
    workspaceIdentity
    && claimIdentity
    && automationRepoIdentityKey(workspaceIdentity) === automationRepoIdentityKey(claimIdentity),
  );
}
