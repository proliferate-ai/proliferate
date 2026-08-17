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
export type FileReferencePrimaryAction =
  | "open-viewer"
  | "open-external"
  | "reveal"
  | "unavailable";

export function resolveWorkspaceStatPathKind(stat: {
  kind: "file" | "directory" | "symlink";
  sizeBytes?: number | null;
} | undefined): FileReferencePathKind | null {
  if (!stat) {
    return null;
  }
  if (stat.kind !== "symlink") {
    return stat.kind;
  }
  // AnyHarness stats symlinks after following the target: file targets carry
  // a byte size (including zero), while directory targets do not.
  return typeof stat.sizeBytes === "number" ? "file" : "directory";
}

/**
 * Keep primary file-reference behavior host-independent and fail closed while
 * the path kind is unknown. A directory must never be routed through the file
 * viewer, and an external file must use the configured external open target
 * rather than silently falling back to Finder.
 */
export function resolveFileReferencePrimaryAction(args: {
  pathKind: FileReferencePathKind | null;
  canOpenViewer: boolean;
  canOpenExternal: boolean;
  canReveal: boolean;
}): FileReferencePrimaryAction {
  if (args.pathKind === "file") {
    if (args.canOpenViewer) {
      return "open-viewer";
    }
    return args.canOpenExternal ? "open-external" : "unavailable";
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
  homeDirectory?: string | null;
  workspacePathOverride?: string | null;
}): ResolvedFileReference {
  const trimmed = args.rawPath.trim();
  const { path, line, column } = splitPathLineSuffix(trimmed);
  // The SDK normalizes both an omitted wire field and an explicit null to
  // `null`, so absence cannot safely mean "authoritatively external" here.
  // Use a non-empty override when supplied; otherwise classify the raw path.
  const workspacePath = normalizeWorkspacePathOverride(args.workspacePathOverride)
    ?? resolveWorkspacePathFromReference(path, args.workspaceRoot);

  return {
    rawPath: args.rawPath,
    path,
    line,
    column,
    absolutePath: resolveAbsoluteFileReferencePath(
      path,
      args.homeDirectory,
      args.resolveAbsolute,
    ),
    workspacePath,
  };
}

export function isHomeRelativeFileReference(value: string): boolean {
  const { path } = splitPathLineSuffix(value.trim());
  return path === "~" || path.startsWith("~/");
}

function resolveAbsoluteFileReferencePath(
  path: string,
  homeDirectory: string | null | undefined,
  resolveAbsolute: (rawPath: string) => string | null,
): string | null {
  if (!isHomeRelativeFileReference(path)) {
    return resolveAbsolute(path);
  }
  const trimmedHome = homeDirectory?.trim();
  if (!trimmedHome) {
    return null;
  }
  const homeRoot = trimmedHome === "/" ? "" : trimmedHome.replace(/\/+$/, "");
  const suffix = path === "~" ? "" : path.slice(1);
  return `${homeRoot}${suffix}` || "/";
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

/**
 * Human-readable label for an inline file reference.
 *
 * A line-anchored reference reads as `basename (line N)`: the raw `path:line`
 * form (and the absolute directory chain in front of it) is machine syntax, and
 * what matters about a jump target is the file and the line. References without
 * a line keep their path — with no line to anchor on, the path is what
 * identifies the file. Either way this is display only; the reference's raw
 * path stays the click target and the tooltip.
 */
export function inlineFileReferenceLabel(
  reference: Pick<ResolvedFileReference, "path" | "workspacePath" | "line">,
): string {
  const path = reference.workspacePath ?? reference.path;
  if (reference.line === null) {
    return path;
  }
  return `${fileReferenceBasename(path)} (line ${reference.line})`;
}

export function fileReferenceBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function normalizeWorkspacePathOverride(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  const trimmed = stripRelativePrefix(path.trim());
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    return null;
  }
  const normalized = normalizeLexicalPath(trimmed);
  return normalized && !normalized.startsWith("/") ? normalized : null;
}

function resolveWorkspacePathFromReference(
  path: string,
  workspaceRoot: string | null,
): string | null {
  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === "~" || trimmed.startsWith("~/")) {
    return null;
  }

  const normalizedPath = normalizeLexicalPath(trimmed);
  if (!normalizedPath) {
    return null;
  }

  const normalizedRoot = normalizeRoot(workspaceRoot);
  if (normalizedPath.startsWith("/")) {
    if (!normalizedRoot) {
      return null;
    }
    if (normalizedPath === normalizedRoot) {
      return null;
    }
    const prefix = normalizedRoot === "/" ? "/" : `${normalizedRoot}/`;
    return normalizedPath.startsWith(prefix)
      ? normalizedPath.slice(prefix.length)
      : null;
  }

  return normalizedPath;
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
  const normalized = normalizeLexicalPath(root.trim());
  return normalized?.startsWith("/") ? normalized : null;
}

function normalizeLexicalPath(path: string): string | null {
  const absolute = path.startsWith("/");
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    return absolute ? "/" : null;
  }
  return `${absolute ? "/" : ""}${segments.join("/")}`;
}
