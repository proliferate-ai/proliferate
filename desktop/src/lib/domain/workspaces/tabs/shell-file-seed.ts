import {
  getWorkspaceShellTabKey,
  parseWorkspaceShellTabKey,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { viewerTargetKey, type ViewerTarget } from "@/lib/domain/workspaces/viewer-target";

export interface WorkspaceFileTabSeed {
  shellOrderKeys: WorkspaceShellTabKey[];
  initialOpenTargets: ViewerTarget[];
  initialActiveTargetKey: string | null;
}

export function sanitizeWorkspaceShellTabKeys(
  keys: readonly WorkspaceShellTabKey[] | null | undefined,
): WorkspaceShellTabKey[] {
  const next: WorkspaceShellTabKey[] = [];
  const seen = new Set<WorkspaceShellTabKey>();

  for (const key of keys ?? []) {
    const parsed = parseWorkspaceShellTabKey(key);
    if (!parsed) {
      continue;
    }
    const canonicalKey = getWorkspaceShellTabKey(parsed);
    if (!seen.has(canonicalKey)) {
      seen.add(canonicalKey);
      next.push(canonicalKey);
    }
  }

  return next;
}

export function deriveWorkspaceFileTabSeed(args: {
  shellOrderKeys: readonly WorkspaceShellTabKey[] | null | undefined;
  activeShellTabKey: WorkspaceShellTabKey | null | undefined;
}): WorkspaceFileTabSeed {
  const shellOrderKeys = sanitizeWorkspaceShellTabKeys(args.shellOrderKeys);
  const initialOpenTargets: ViewerTarget[] = [];
  const seenTargetKeys = new Set<string>();

  for (const key of shellOrderKeys) {
    const parsed = parseWorkspaceShellTabKey(key);
    if (parsed?.kind !== "viewer") {
      continue;
    }
    const targetKey = viewerTargetKey(parsed.target);
    if (seenTargetKeys.has(targetKey)) {
      continue;
    }
    seenTargetKeys.add(targetKey);
    initialOpenTargets.push(parsed.target);
  }

  const activeParsed = args.activeShellTabKey
    ? parseWorkspaceShellTabKey(args.activeShellTabKey)
    : null;
  const initialActiveTargetKey = activeParsed?.kind === "viewer"
    && seenTargetKeys.has(viewerTargetKey(activeParsed.target))
    ? viewerTargetKey(activeParsed.target)
    : null;

  return {
    shellOrderKeys,
    initialOpenTargets,
    initialActiveTargetKey,
  };
}
