import type { Workspace } from "@anyharness/sdk";
import { WORKSPACE_ANIMAL_NAMES } from "@proliferate/product-domain/workspaces/workspace-name-catalog.generated";
import { localWorkspaceGroupKey } from "@/lib/domain/workspaces/cloud/collections";

function randomIndex(length: number): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0]! % length;
}

export function pickGeneratedWorkspaceName(existingNames: ReadonlySet<string>): string {
  const available = WORKSPACE_ANIMAL_NAMES.filter((name) => !existingNames.has(name));
  if (available.length > 0) {
    return available[randomIndex(available.length)]!;
  }

  const base = WORKSPACE_ANIMAL_NAMES[randomIndex(WORKSPACE_ANIMAL_NAMES.length)]!;
  for (let i = 2; i < 100000; i++) {
    const candidate = `${base}-${i}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

export function generateWorkspaceSlug(existingNames: ReadonlySet<string>): string {
  return pickGeneratedWorkspaceName(existingNames);
}

export function collectWorktreeBasenamesForRepo(
  workspaces: readonly Workspace[],
  source: Workspace,
): Set<string> {
  const sourceGroupKey = localWorkspaceGroupKey(source);
  const basenames = new Set<string>();
  for (const workspace of workspaces) {
    if (workspace.kind !== "worktree") continue;
    if (localWorkspaceGroupKey(workspace) !== sourceGroupKey) continue;
    const basename = workspace.path.split("/").filter(Boolean).pop();
    if (basename) basenames.add(basename);
  }
  return basenames;
}
