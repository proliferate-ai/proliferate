import {
  fileWorkspaceShellTabKey,
  parseWorkspaceShellTabKey,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";

export interface WorkspaceFileTabSeed {
  shellOrderKeys: WorkspaceShellTabKey[];
  initialOpenTabs: string[];
  initialActiveFilePath: string | null;
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
    const canonicalKey = parsed.kind === "chat"
      ? `chat:${parsed.sessionId}`
      : fileWorkspaceShellTabKey(parsed.path);
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
  const initialOpenTabs: string[] = [];
  const seenPaths = new Set<string>();

  for (const key of shellOrderKeys) {
    const parsed = parseWorkspaceShellTabKey(key);
    if (parsed?.kind !== "file" || seenPaths.has(parsed.path)) {
      continue;
    }
    seenPaths.add(parsed.path);
    initialOpenTabs.push(parsed.path);
  }

  const activeParsed = args.activeShellTabKey
    ? parseWorkspaceShellTabKey(args.activeShellTabKey)
    : null;
  const initialActiveFilePath = activeParsed?.kind === "file"
    && seenPaths.has(activeParsed.path)
    ? activeParsed.path
    : null;

  return {
    shellOrderKeys,
    initialOpenTabs,
    initialActiveFilePath,
  };
}
