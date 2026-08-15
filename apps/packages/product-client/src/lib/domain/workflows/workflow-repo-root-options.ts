import type { RepoRoot } from "@anyharness/sdk";

/**
 * The repo choices both gen-2 workflow surfaces offer: the builder's default
 * repository and the trigger dialog's per-run repository.
 *
 * Both read RUNTIME repo roots (GET /v1/repo-roots), not cloud repo configs:
 * the runtime resolves `placement.repoConfigId` in its own id space, and a
 * definition's `defaultRepoConfigId` is what seeds that placement — so the two
 * pickers must draw from one list, mapped one way.
 */
export interface WorkflowRepoRootOption {
  id: string;
  label: string;
}

/**
 * `displayName` and the remote fields are optional on the wire, so the label
 * falls back the way the settings repository list falls back before showing a
 * raw id.
 */
export function workflowRepoRootOptions(
  repoRoots: readonly RepoRoot[],
): WorkflowRepoRootOption[] {
  return repoRoots.map((repoRoot) => ({
    id: repoRoot.id,
    label: repoRoot.displayName?.trim()
      || repoRoot.remoteRepoName?.trim()
      || repoRoot.path.split("/").filter(Boolean).pop()
      || repoRoot.id,
  }));
}
