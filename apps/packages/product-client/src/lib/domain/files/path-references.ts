import { splitPathLineSuffix } from "#product/lib/domain/files/path-detection";

export interface ResolvedFileReference {
  rawPath: string;
  path: string;
  line: number | null;
  column: number | null;
  absolutePath: string | null;
  workspacePath: string | null;
}

export type FileReferencePathKind = "file" | "directory";
export type FileReferencePrimaryAction = "open-viewer" | "reveal" | "unavailable";

/**
 * Keep primary file-reference behavior host-independent and fail closed while
 * the path kind is unknown. A directory must never be routed through the file
 * viewer, and a file must never silently fall back to Finder.
 */
export function resolveFileReferencePrimaryAction(args: {
  pathKind: FileReferencePathKind | null;
  canOpenViewer: boolean;
  canReveal: boolean;
}): FileReferencePrimaryAction {
  if (args.pathKind === "file") {
    return args.canOpenViewer ? "open-viewer" : "unavailable";
  }
  if (args.pathKind === "directory") {
    return args.canReveal ? "reveal" : "unavailable";
  }
  return "unavailable";
}

export function resolveFileReference(args: {
  rawPath: string;
  workspaceRoot: string | null;
  resolveAbsolute: (rawPath: string) => string | null;
  workspacePathOverride?: string | null;
}): ResolvedFileReference {
  const trimmed = args.rawPath.trim();
  const { path, line, column } = splitPathLineSuffix(trimmed);
  const workspacePath = args.workspacePathOverride !== undefined
    ? normalizeWorkspacePathOverride(args.workspacePathOverride)
    : resolveWorkspacePathFromReference(path, args.workspaceRoot);

  return {
    rawPath: args.rawPath,
    path,
    line,
    column,
    absolutePath: args.resolveAbsolute(path),
    workspacePath,
  };
}

/**
 * Best-effort correction for a workspace file path that does not resolve to a
 * real file (e.g. an agent dropped leading directories): given candidate paths
 * from a basename search, return the single candidate whose path equals or ends
 * with the target path. Returns null when the target already appears among the
 * candidates (it exists), or when the suffix match is absent or ambiguous.
 */
export function pickFuzzyPathMatch(
  targetPath: string,
  candidatePaths: readonly string[],
): string | null {
  // Compare case-insensitively (the workspace search is case-insensitive, and
  // a ref may differ in case from the real file) but return the real casing.
  const target = targetPath.toLowerCase();
  if (!target || candidatePaths.some((candidate) => candidate.toLowerCase() === target)) {
    return null;
  }
  const suffix = `/${target}`;
  const matches = candidatePaths.filter((candidate) => {
    const lower = candidate.toLowerCase();
    return lower === target || lower.endsWith(suffix);
  });
  return matches.length === 1 ? matches[0] : null;
}

function normalizeWorkspacePathOverride(path: string | null): string | null {
  if (!path) {
    return null;
  }
  return stripRelativePrefix(path.trim());
}

function resolveWorkspacePathFromReference(
  path: string,
  workspaceRoot: string | null,
): string | null {
  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedRoot = normalizeRoot(workspaceRoot);
  if (trimmed.startsWith("/")) {
    if (!normalizedRoot) {
      return null;
    }
    if (trimmed === normalizedRoot) {
      return null;
    }
    const prefix = `${normalizedRoot}/`;
    return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : null;
  }

  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("../")) {
    return null;
  }

  return stripRelativePrefix(trimmed);
}

function stripRelativePrefix(path: string): string {
  let next = path;
  while (next.startsWith("./")) {
    next = next.slice(2);
  }
  return next;
}

function normalizeRoot(root: string | null): string | null {
  if (!root) {
    return null;
  }
  return root.endsWith("/") ? root.slice(0, -1) : root;
}
