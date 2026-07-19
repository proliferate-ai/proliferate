import type { GitDiffScope } from "@anyharness/sdk";
import { canPreviewAsRichFile } from "#product/lib/domain/files/document-preview";
import {
  decodeBase64UrlUtf8,
  encodeBase64UrlUtf8,
} from "#product/lib/infra/encoding/base64url";

export type FileViewerMode = "source" | "rendered" | "diff" | "edit";
export type DiffViewerLayout = "unified" | "split";
export type FileDiffViewerScope = Exclude<GitDiffScope, "working_tree" | "base_worktree">;
export type AllChangesViewerScope = FileDiffViewerScope | "working_tree_composite";
export type PromptAttachmentViewerOrigin = "draft" | "session";
export type PromptAttachmentViewerKind = "image" | "text_resource";
export type PromptAttachmentViewerSource = "upload" | "paste";

export type ViewerTarget =
  | { kind: "file"; path: string }
  | {
    kind: "fileDiff";
    scope: FileDiffViewerScope;
    path: string;
    oldPath: string | null;
    baseRef: string | null;
    baseOid: string | null;
    headOid: string | null;
  }
  | {
    kind: "allChanges";
    scope: AllChangesViewerScope;
    baseRef: string | null;
    baseOid: string | null;
    headOid: string | null;
  }
  | {
    kind: "promptAttachment";
    origin: PromptAttachmentViewerOrigin;
    sessionId: string | null;
    attachmentId: string;
    name: string;
    mimeType: string;
    size: number | null;
    attachmentKind: PromptAttachmentViewerKind;
    attachmentSource: PromptAttachmentViewerSource;
    objectUrl: string | null;
  };

export type ViewerTargetKey = `viewer:${string}`;

const VIEWER_TARGET_KEY_PREFIX = "viewer:";

interface ViewerTargetEnvelope {
  v: 1;
  target: ViewerTarget;
}

export function fileViewerTarget(path: string): ViewerTarget {
  return { kind: "file", path };
}

export function fileDiffViewerTarget(args: {
  path: string;
  scope: FileDiffViewerScope;
  oldPath?: string | null;
  baseRef?: string | null;
  baseOid?: string | null;
  headOid?: string | null;
}): ViewerTarget {
  return canonicalizeViewerTarget({
    kind: "fileDiff",
    path: args.path,
    scope: args.scope,
    oldPath: args.oldPath ?? null,
    baseRef: args.baseRef ?? null,
    baseOid: args.baseOid ?? null,
    headOid: args.headOid ?? null,
  });
}

export function allChangesViewerTarget(args: {
  scope: AllChangesViewerScope;
  baseRef?: string | null;
  baseOid?: string | null;
  headOid?: string | null;
}): ViewerTarget {
  return canonicalizeViewerTarget({
    kind: "allChanges",
    scope: args.scope,
    baseRef: args.baseRef ?? null,
    baseOid: args.baseOid ?? null,
    headOid: args.headOid ?? null,
  });
}

export function promptAttachmentViewerTarget(args: {
  origin: PromptAttachmentViewerOrigin;
  sessionId?: string | null;
  attachmentId: string;
  name: string;
  mimeType: string;
  size?: number | null;
  attachmentKind: PromptAttachmentViewerKind;
  attachmentSource: PromptAttachmentViewerSource;
  objectUrl?: string | null;
}): ViewerTarget {
  return canonicalizeViewerTarget({
    kind: "promptAttachment",
    origin: args.origin,
    sessionId: args.sessionId ?? null,
    attachmentId: args.attachmentId,
    name: args.name,
    mimeType: args.mimeType,
    size: args.size ?? null,
    attachmentKind: args.attachmentKind,
    attachmentSource: args.attachmentSource,
    objectUrl: args.objectUrl ?? null,
  });
}

export function viewerTargetKey(target: ViewerTarget): ViewerTargetKey {
  const envelope: ViewerTargetEnvelope = {
    v: 1,
    target: canonicalizeViewerTarget(target),
  };
  return `${VIEWER_TARGET_KEY_PREFIX}${encodeBase64UrlUtf8(JSON.stringify(envelope))}`;
}

export function parseViewerTargetKey(key: string): ViewerTarget | null {
  if (!key.startsWith(VIEWER_TARGET_KEY_PREFIX)) {
    return null;
  }
  const decoded = decodeBase64UrlUtf8(key.slice(VIEWER_TARGET_KEY_PREFIX.length));
  if (!decoded) {
    return null;
  }
  try {
    const parsed = JSON.parse(decoded) as Partial<ViewerTargetEnvelope>;
    if (parsed.v !== 1 || !parsed.target) {
      return null;
    }
    return canonicalizeViewerTarget(parsed.target);
  } catch {
    return null;
  }
}

export function canonicalizeViewerTarget(target: ViewerTarget): ViewerTarget {
  if (target.kind === "file") {
    return {
      kind: "file",
      path: target.path,
    };
  }
  if (target.kind === "fileDiff") {
    const scope = normalizeFileDiffScope(target.scope);
    if (!scope) {
      throw new Error(`Invalid file diff scope: ${String(target.scope)}`);
    }
    return {
      kind: "fileDiff",
      scope,
      path: target.path,
      oldPath: normalizeNullableTargetPart(target.oldPath),
      baseRef: normalizeNullableTargetPart(target.baseRef),
      baseOid: normalizeNullableTargetPart(target.baseOid),
      headOid: normalizeNullableTargetPart(target.headOid),
    };
  }
  if (target.kind === "promptAttachment") {
    const origin = target.origin === "draft" || target.origin === "session"
      ? target.origin
      : null;
    const attachmentKind = target.attachmentKind === "image"
      || target.attachmentKind === "text_resource"
      ? target.attachmentKind
      : null;
    const attachmentSource = target.attachmentSource === "upload"
      || target.attachmentSource === "paste"
      ? target.attachmentSource
      : null;
    const attachmentId = normalizeRequiredTargetPart(target.attachmentId);
    const name = normalizeRequiredTargetPart(target.name);
    const mimeType = normalizeRequiredTargetPart(target.mimeType);
    const sessionId = normalizeNullableTargetPart(target.sessionId);
    const objectUrl = normalizeNullableTargetPart(target.objectUrl);
    if (
      !origin
      || !attachmentKind
      || !attachmentSource
      || !attachmentId
      || !name
      || !mimeType
      || (origin === "draft" && sessionId)
      || (origin === "session" && objectUrl)
    ) {
      throw new Error("Invalid prompt attachment viewer target");
    }
    return {
      kind: "promptAttachment",
      origin,
      sessionId,
      attachmentId,
      name,
      mimeType,
      size: normalizeNullableTargetSize(target.size),
      attachmentKind,
      attachmentSource,
      objectUrl,
    };
  }
  return {
    kind: "allChanges",
    scope: normalizeAllChangesScope(target.scope),
    baseRef: normalizeNullableTargetPart(target.baseRef),
    baseOid: normalizeNullableTargetPart(target.baseOid),
    headOid: normalizeNullableTargetPart(target.headOid),
  };
}

export function isFileViewerTarget(
  target: ViewerTarget,
): target is Extract<ViewerTarget, { kind: "file" }> {
  return target.kind === "file";
}

export function isPersistableViewerTarget(target: ViewerTarget): boolean {
  return target.kind !== "promptAttachment";
}

export function viewerTargetEditablePath(target: ViewerTarget): string | null {
  if (target.kind === "file" || target.kind === "fileDiff") {
    return target.path;
  }
  return null;
}

export function pathIsWithinWorkspaceEntry(path: string, entryPath: string): boolean {
  return path === entryPath || path.startsWith(`${entryPath}/`);
}

export function remapPathWithinWorkspaceEntry(
  path: string,
  fromEntryPath: string,
  toEntryPath: string,
): string {
  if (path === fromEntryPath) {
    return toEntryPath;
  }
  if (path.startsWith(`${fromEntryPath}/`)) {
    return `${toEntryPath}${path.slice(fromEntryPath.length)}`;
  }
  return path;
}

export function remapViewerTargetPathWithinWorkspaceEntry(
  target: ViewerTarget,
  fromEntryPath: string,
  toEntryPath: string,
): ViewerTarget {
  if (target.kind === "file") {
    return {
      ...target,
      path: remapPathWithinWorkspaceEntry(target.path, fromEntryPath, toEntryPath),
    };
  }
  if (target.kind === "fileDiff") {
    return {
      ...target,
      path: remapPathWithinWorkspaceEntry(target.path, fromEntryPath, toEntryPath),
    };
  }
  return target;
}

export function viewerTargetDisplayPath(target: ViewerTarget): string | null {
  if (target.kind === "file") {
    return target.path;
  }
  if (target.kind === "fileDiff") {
    return target.oldPath ? `${target.oldPath} -> ${target.path}` : target.path;
  }
  return null;
}

export function viewerTargetLabel(target: ViewerTarget): string {
  const displayPath = viewerTargetDisplayPath(target);
  if (displayPath) {
    return displayPath.split("/").pop() ?? displayPath;
  }
  if (target.kind === "allChanges") {
    return target.scope === "working_tree_composite" ? "All changes" : "All branch changes";
  }
  if (target.kind === "promptAttachment") {
    return target.name;
  }
  return "Viewer";
}

export function defaultFileViewerMode(path: string): FileViewerMode {
  return canPreviewAsRichFile(path) ? "rendered" : "source";
}

export function normalizeFileViewerMode(mode: FileViewerMode): Exclude<FileViewerMode, "edit"> {
  return mode === "edit" ? "source" : mode;
}

function normalizeFileDiffScope(scope: FileDiffViewerScope): FileDiffViewerScope | null {
  return scope === "unstaged" || scope === "staged" || scope === "branch" ? scope : null;
}

function normalizeAllChangesScope(
  scope: AllChangesViewerScope | "working_tree",
): AllChangesViewerScope {
  return scope === "working_tree" ? "working_tree_composite" : scope;
}

function normalizeNullableTargetPart(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeRequiredTargetPart(value: string | null | undefined): string | null {
  return normalizeNullableTargetPart(value);
}

function normalizeNullableTargetSize(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
