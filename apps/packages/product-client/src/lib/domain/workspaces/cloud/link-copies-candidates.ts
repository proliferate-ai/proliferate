import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { canonicalRepoKey } from "@proliferate/product-domain/repos/repo-id";
import {
  normalizeLogicalWorkspaceBranchKey,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-id";
import {
  workspaceBranchKey,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-source";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";

/** A plausible local workspace the user might link to the Cloud copy. Exact
 * linkability (clean state, exact HEAD) is proven per-candidate at action time
 * from the runtime git status; this only narrows to same-repo/same-branch
 * unlinked locals so the host has an explicit candidate set to choose from. */
export interface LinkCandidate {
  anyharnessWorkspaceId: string;
  worktreePath: string;
  displayName: string;
  branch: string;
  provider: string;
  owner: string;
  repoName: string;
}

/** Index every active visible local association on this installation. The
 * server redacts other-install runtime ids, so every id present here is safe to
 * compare and proves that a candidate is already owned by a Cloud workspace. */
export function linkedCloudWorkspaceByAnyharnessId(
  cloudWorkspaces: readonly CloudWorkspaceSummary[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const cloudWorkspace of cloudWorkspaces) {
    for (const row of cloudWorkspace.materializations ?? []) {
      if (
        row.targetKind === "local_desktop"
        && row.anyharnessWorkspaceId
      ) {
        result.set(row.anyharnessWorkspaceId, cloudWorkspace.id);
      }
    }
  }
  return result;
}

/**
 * Enumerate the plausible local link candidates for a Cloud workspace: local
 * workspaces whose repo root canonically matches the Cloud repository and whose
 * branch matches the Cloud branch, excluding any that is already this install's
 * linked local materialization. Pure so LINK-02's "multiple candidates require
 * explicit selection; never auto-pick the oldest/first" rule is unit-testable.
 *
 * The result is deterministically ordered (createdAt, then id) ONLY so the list
 * renders stably — the caller must NOT auto-select index 0 when the length > 1.
 */
export function collectLinkCandidates(args: {
  localWorkspaces: Workspace[];
  repoRoots: RepoRoot[];
  cloudRepo: { provider: string; owner: string; name: string } | null;
  cloudBranch: string | null;
  /** AnyHarness ids already linked to this Cloud workspace (excluded). */
  alreadyLinkedAnyharnessIds?: ReadonlySet<string>;
}): LinkCandidate[] {
  const { cloudRepo, cloudBranch } = args;
  if (!cloudRepo || !cloudBranch) {
    return [];
  }
  const repoRootsById = new Map(args.repoRoots.map((root) => [root.id, root]));
  const cloudRepoKey = canonicalRepoKey(cloudRepo.provider, cloudRepo.owner, cloudRepo.name);
  const cloudBranchKey = normalizeLogicalWorkspaceBranchKey(cloudBranch);
  const alreadyLinked = args.alreadyLinkedAnyharnessIds ?? new Set<string>();

  const matches: { workspace: Workspace; root: RepoRoot }[] = [];
  for (const workspace of args.localWorkspaces) {
    if (alreadyLinked.has(workspace.id)) {
      continue;
    }
    const root = repoRootsById.get(workspace.repoRootId);
    if (
      !root?.remoteProvider
      || !root.remoteOwner
      || !root.remoteRepoName
    ) {
      continue;
    }
    if (canonicalRepoKey(root.remoteProvider, root.remoteOwner, root.remoteRepoName) !== cloudRepoKey) {
      continue;
    }
    if (workspaceBranchKey(workspace) !== cloudBranchKey) {
      continue;
    }
    matches.push({ workspace, root });
  }

  return matches
    .sort((left, right) => {
      const byCreatedAt =
        new Date(left.workspace.createdAt).getTime() - new Date(right.workspace.createdAt).getTime();
      return byCreatedAt !== 0 ? byCreatedAt : left.workspace.id.localeCompare(right.workspace.id);
    })
    .map(({ workspace, root }) => ({
      anyharnessWorkspaceId: workspace.id,
      worktreePath: workspace.path,
      displayName: workspace.displayName?.trim() || workspace.currentBranch?.trim() || workspace.id,
      branch: workspace.currentBranch?.trim() || cloudBranch,
      provider: root.remoteProvider!,
      owner: root.remoteOwner!,
      repoName: root.remoteRepoName!,
    }));
}
