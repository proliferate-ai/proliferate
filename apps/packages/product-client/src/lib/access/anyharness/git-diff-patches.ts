import {
  getAnyHarnessClient,
  resolveWorkspaceConnectionFromContext,
} from "@anyharness/sdk-react";
import type { CommitDiffTarget } from "#product/lib/domain/workspaces/creation/commit-message-generation";

export interface GitDiffPatch {
  path: string;
  patch: string | null;
  binary: boolean;
}

/**
 * Fetches the raw per-file patches for a set of commit diff targets, resolving
 * the workspace connection from the AnyHarness context. Used by the publish
 * workflow's leave-blank-to-generate commit-message path.
 */
export async function fetchGitDiffPatches(
  anyHarnessWorkspace: Parameters<typeof resolveWorkspaceConnectionFromContext>[0],
  workspaceId: string,
  targets: readonly CommitDiffTarget[],
): Promise<GitDiffPatch[]> {
  const resolved = await resolveWorkspaceConnectionFromContext(
    anyHarnessWorkspace,
    workspaceId,
  );
  const client = getAnyHarnessClient(resolved.connection);
  return Promise.all(targets.map(async (target) => {
    const diff = await client.git.getDiff(
      resolved.connection.anyharnessWorkspaceId,
      target.path,
      { scope: target.scope },
    );
    return { path: target.path, patch: diff.patch ?? null, binary: diff.binary };
  }));
}
