import { splitPathLineSuffix } from "#product/lib/domain/files/path-detection";

export type WorkspaceFilesystemOrigin = "desktop-local" | "remote";

export type WorkspaceFilesystemOriginState =
  | { status: "pending"; origin: null }
  | { status: "settled"; origin: WorkspaceFilesystemOrigin }
  | { status: "rejected"; origin: null };

export type RuntimeWorkspaceRootState =
  | { status: "pending"; path: null }
  | { status: "settled"; path: string }
  | { status: "unavailable"; path: null };

export type FileReferenceUnavailableLocatorReason =
  | "empty"
  | "invalid"
  | "traversal"
  | "native_host_required"
  | "remote_filesystem"
  | "home_unavailable"
  | "filesystem_origin_unavailable"
  | "workspace_root_unavailable";

export type ResolvedFileLocator =
  | {
      authority: "workspace";
      workspacePath: string;
      localCompanionPath: string | null;
    }
  | {
      authority: "desktop";
      absolutePath: string;
      syntax: "absolute" | "home-relative";
    }
  | {
      authority: "unavailable";
      reason: FileReferenceUnavailableLocatorReason;
    };

export interface ResolvedFileReference {
  rawPath: string;
  parsedPath: string;
  displayPath: string;
  line: number | null;
  column: number | null;
  locator: ResolvedFileLocator;
}

export type FileReferencePathKind = "file" | "directory";
export type FileReferencePrimaryAction =
  | "open-viewer"
  | "open-external"
  | "reveal"
  | "unavailable";

interface ResolveFileReferenceInput {
  rawPath: string;
  workspacePathOverride?: string | null;
  workspaceRoot: RuntimeWorkspaceRootState;
  filesystemOrigin: WorkspaceFilesystemOriginState;
  desktopBridgeAvailable: boolean;
  homeDirectory?: string | null;
}

/**
 * The one decode a raw file reference gets: a single case-insensitive `%20`
 * pass, nothing else.
 *
 * A Markdown destination that survives the transcript repair carries its spaces
 * as `%20`, so this is what turns a rendered mention back into the name the
 * author wrote. It is deliberately not `decodeURIComponent`: general URI
 * decoding would let `%2F`, `%5C`, `%2E%2E`, and `%00` manufacture separators,
 * traversal, or NUL out of an inert literal. `+` is not a space here, and
 * nothing is decoded twice, so `%2520` stays `%2520`.
 *
 * Accepted compatibility tradeoff: a real filename containing the literal
 * characters `%20` resolves as a space-bearing name at this seam. That
 * ambiguity is narrower and safer than general decoding, and it is the only
 * meaning-changing case.
 */
export function decodeFileReferenceSpaces(rawReference: string): string {
  return rawReference.replace(/%20/gi, " ");
}

/** Classify one rendered reference into exactly one filesystem authority. */
export function resolveFileReference(args: ResolveFileReferenceInput): ResolvedFileReference {
  // Ordered exactly: trim once, decode `%20` once, never trim again, then split
  // the terminal `:line[:column]`. Skipping the second trim is what lets an
  // encoded terminal filename space survive into the parsed path.
  const decodedReference = decodeFileReferenceSpaces(args.rawPath.trim());
  const { path: parsedPath, line, column } = splitPathLineSuffix(decodedReference);
  const locator = typeof args.workspacePathOverride === "string"
    ? classifyStructuredWorkspacePath(args.workspacePathOverride, args)
    : classifyRawPath(parsedPath, args);

  return {
    rawPath: args.rawPath,
    parsedPath,
    displayPath: displayPathForLocator(locator, parsedPath),
    line,
    column,
    locator,
  };
}

export function resolveWorkspaceStatPathKind(stat: {
  kind: "file" | "directory" | "symlink";
} | undefined): FileReferencePathKind | null {
  return stat?.kind === "file" || stat?.kind === "directory" ? stat.kind : null;
}

export function resolveFileReferencePrimaryAction(args: {
  pathKind: FileReferencePathKind | null;
  canOpenViewer: boolean;
  canOpenExternal: boolean;
  canReveal: boolean;
}): FileReferencePrimaryAction {
  if (args.pathKind === "file") {
    if (args.canOpenViewer) return "open-viewer";
    return args.canOpenExternal ? "open-external" : "unavailable";
  }
  if (args.pathKind === "directory") {
    return args.canReveal ? "reveal" : "unavailable";
  }
  return "unavailable";
}

export function isHomeRelativeFileReference(value: string): boolean {
  const { path } = splitPathLineSuffix(value.trim());
  return path === "~" || path.startsWith("~/");
}

export function normalizeRuntimeWorkspaceRoot(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!isSupportedAbsolutePath(trimmed) || hasTraversalSegment(trimmed)) return null;
  return normalizeLexicalPath(trimmed, true);
}

export function fileReferenceCopyPath(reference: ResolvedFileReference): string | null {
  switch (reference.locator.authority) {
    case "workspace":
      return reference.locator.localCompanionPath
        ?? (reference.locator.workspacePath || ".");
    case "desktop":
      return reference.locator.absolutePath;
    case "unavailable":
      return reference.parsedPath.trim() || null;
  }
}

/** Return the one suffix match, including an exact match, with runtime casing. */
export function pickFuzzyPathMatch(
  targetPath: string,
  candidatePaths: readonly string[],
): string | null {
  const target = targetPath.toLowerCase();
  if (!target) return null;
  const suffix = `/${target}`;
  const matches = candidatePaths.filter((candidate) => {
    const lower = candidate.toLowerCase();
    return lower === target || lower.endsWith(suffix);
  });
  return matches.length === 1 ? matches[0] : null;
}

export function inlineFileReferenceLabel(
  reference: Pick<ResolvedFileReference, "displayPath" | "line">,
): string {
  if (reference.line === null) return reference.displayPath;
  return `${fileReferenceBasename(reference.displayPath)} (line ${reference.line})`;
}

export function fileReferenceBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function classifyStructuredWorkspacePath(
  suppliedPath: string,
  args: ResolveFileReferenceInput,
): ResolvedFileLocator {
  const validation = validateWorkspacePath(suppliedPath);
  if (validation.kind === "invalid") {
    return { authority: "unavailable", reason: validation.reason };
  }
  return workspaceLocator(validation.path, args);
}

function classifyRawPath(
  parsedPath: string,
  args: ResolveFileReferenceInput,
): ResolvedFileLocator {
  const trimmed = parsedPath.trim();
  if (!trimmed) return { authority: "unavailable", reason: "empty" };
  if (containsNul(trimmed) || hasUnsupportedPrefix(trimmed)) {
    return { authority: "unavailable", reason: "invalid" };
  }
  if (hasTraversalSegment(trimmed)) {
    return { authority: "unavailable", reason: "traversal" };
  }
  if (isHomeRelativeFileReference(trimmed)) return classifyHomeRelativePath(trimmed, args);
  if (trimmed.startsWith("/")) return classifyAbsolutePath(trimmed, args);

  const normalized = normalizeLexicalPath(trimmed, false);
  return workspaceLocator(normalized ?? "", args);
}

function classifyAbsolutePath(
  absolutePath: string,
  args: ResolveFileReferenceInput,
): ResolvedFileLocator {
  if (args.workspaceRoot.status !== "settled") {
    return { authority: "unavailable", reason: "workspace_root_unavailable" };
  }
  const normalizedRoot = normalizeRuntimeWorkspaceRoot(args.workspaceRoot.path);
  const normalizedPath = normalizeRuntimeWorkspaceRoot(absolutePath);
  if (!normalizedRoot || !normalizedPath) {
    return { authority: "unavailable", reason: "workspace_root_unavailable" };
  }

  const workspacePath = workspacePathBelowRoot(normalizedPath, normalizedRoot);
  if (workspacePath !== null) return workspaceLocator(workspacePath, args);

  const originRefusal = nativeAuthorityRefusal(args);
  if (originRefusal) return originRefusal;
  return { authority: "desktop", absolutePath: normalizedPath, syntax: "absolute" };
}

function classifyHomeRelativePath(
  homePath: string,
  args: ResolveFileReferenceInput,
): ResolvedFileLocator {
  const originRefusal = nativeAuthorityRefusal(args);
  if (originRefusal) return originRefusal;

  const homeDirectory = normalizeRuntimeWorkspaceRoot(args.homeDirectory);
  if (!homeDirectory) {
    return { authority: "unavailable", reason: "home_unavailable" };
  }
  const suffix = homePath === "~" ? "" : homePath.slice(2);
  const absolutePath = suffix ? lexicalJoin(homeDirectory, suffix) : homeDirectory;
  return { authority: "desktop", absolutePath, syntax: "home-relative" };
}

function nativeAuthorityRefusal(
  args: ResolveFileReferenceInput,
): Extract<ResolvedFileLocator, { authority: "unavailable" }> | null {
  if (args.filesystemOrigin.status !== "settled") {
    return { authority: "unavailable", reason: "filesystem_origin_unavailable" };
  }
  if (args.filesystemOrigin.origin === "remote") {
    return { authority: "unavailable", reason: "remote_filesystem" };
  }
  if (!args.desktopBridgeAvailable) {
    return { authority: "unavailable", reason: "native_host_required" };
  }
  return null;
}

function workspaceLocator(
  workspacePath: string,
  args: ResolveFileReferenceInput,
): Extract<ResolvedFileLocator, { authority: "workspace" }> {
  let localCompanionPath: string | null = null;
  if (
    args.filesystemOrigin.status === "settled"
    && args.filesystemOrigin.origin === "desktop-local"
    && args.desktopBridgeAvailable
    && args.workspaceRoot.status === "settled"
  ) {
    const root = normalizeRuntimeWorkspaceRoot(args.workspaceRoot.path);
    if (root) localCompanionPath = workspacePath ? lexicalJoin(root, workspacePath) : root;
  }
  return { authority: "workspace", workspacePath, localCompanionPath };
}

function validateWorkspacePath(path: string):
  | { kind: "valid"; path: string }
  | { kind: "invalid"; reason: "invalid" | "traversal" } {
  const trimmed = path.trim();
  if (
    !trimmed
    || containsNul(trimmed)
    || hasUnsupportedPrefix(trimmed)
    || trimmed.startsWith("/")
    || isHomeRelativeFileReference(trimmed)
  ) {
    return { kind: "invalid", reason: "invalid" };
  }
  if (hasTraversalSegment(trimmed)) {
    return { kind: "invalid", reason: "traversal" };
  }
  return { kind: "valid", path: normalizeLexicalPath(trimmed, false) ?? "" };
}

function displayPathForLocator(locator: ResolvedFileLocator, parsedPath: string): string {
  if (locator.authority === "workspace") return locator.workspacePath || ".";
  if (locator.authority === "desktop") return locator.absolutePath;
  return parsedPath.trim() || "File";
}

function hasUnsupportedPrefix(path: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)
    || path.startsWith("//")
    || path.startsWith("\\")
    || path.startsWith("#")
    || (/^~/.test(path) && path !== "~" && !path.startsWith("~/"));
}

function hasTraversalSegment(path: string): boolean {
  return path.split("/").some((segment) => segment === "..");
}

function containsNul(path: string): boolean {
  return path.includes("\0");
}

function isSupportedAbsolutePath(path: string): boolean {
  return path.startsWith("/")
    && !path.startsWith("//")
    && !containsNul(path)
    && !hasUnsupportedPrefix(path);
}

function normalizeLexicalPath(path: string, absolute: boolean): string | null {
  const segments = path.split("/").filter((segment) => segment && segment !== ".");
  if (segments.length === 0) return absolute ? "/" : null;
  return `${absolute ? "/" : ""}${segments.join("/")}`;
}

function workspacePathBelowRoot(path: string, root: string): string | null {
  if (path === root) return "";
  const prefix = root === "/" ? "/" : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function lexicalJoin(root: string, child: string): string {
  if (!child) return root;
  return root === "/" ? `/${child}` : `${root}/${child}`;
}
