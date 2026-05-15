import { splitPathLineSuffix } from "@/lib/domain/files/path-detection";

export interface ResolvedFileReference {
  rawPath: string;
  path: string;
  line: number | null;
  column: number | null;
  absolutePath: string | null;
  workspacePath: string | null;
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
