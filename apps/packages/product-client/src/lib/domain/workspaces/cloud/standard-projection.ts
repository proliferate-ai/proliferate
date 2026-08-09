import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";

export interface StandardRepoProjection {
  repoRoots: RepoRoot[];
  localWorkspaces: Workspace[];
  cloudWorkspaces: CloudWorkspaceSummary[];
}

/**
 * The repositories rail's view of the workspace collections: real repositories
 * only, with retired cowork rows hidden.
 *
 * Cowork is deleted, but its rows are durable — a `kind: "managed"` repo root
 * (the runtime-owned `cowork/root` checkout, the only producer of managed
 * roots) and `surface: "cowork"` workspaces with generated UUID names. Listing
 * them floods the rail with a "Cowork" group of unopenable-looking UUIDs, so
 * the rail hides them. Hidden is not unreachable: a legacy cowork workspace
 * still resolves, opens, and answers repo-target queries when something refers
 * to it — the filter lives HERE and not in workspace resolution or selection,
 * so retired rows are simply never *offered*.
 *
 * (The pre-deletion version of this filter identified the cowork root by id
 * via the cowork status API; that API is gone, and the root's `managed` kind
 * is the durable marker.)
 */
export function buildStandardRepoProjection(args: {
  repoRoots: RepoRoot[];
  localWorkspaces: Workspace[];
  cloudWorkspaces: CloudWorkspaceSummary[];
}): StandardRepoProjection {
  return {
    repoRoots: args.repoRoots.filter((repoRoot) => repoRoot.kind !== "managed"),
    localWorkspaces: args.localWorkspaces.filter((workspace) =>
      workspace.surface !== "cowork"
    ),
    cloudWorkspaces: args.cloudWorkspaces,
  };
}
