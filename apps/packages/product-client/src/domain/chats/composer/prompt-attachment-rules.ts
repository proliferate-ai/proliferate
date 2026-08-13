import type { PromptCapabilities } from "@anyharness/sdk";
import type { PromptPlanAttachmentDescriptor } from "./prompt-plan-attachments";

export const PROMPT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PROMPT_TEXT_RESOURCE_MAX_BYTES = 256 * 1024;
export const PROMPT_PASTE_ATTACHMENT_MIN_CHARS = 2_000;
export const PROMPT_PASTE_ATTACHMENT_MIN_LINES = 25;

export type PromptAttachmentSource = "upload" | "paste";
export type PromptAttachmentPathKind = "file" | "directory";

/** MIME type marking a local_ref attachment as a directory (freedesktop convention). */
export const PROMPT_FOLDER_MIME_TYPE = "inode/directory";

export interface PromptAttachmentDescriptor {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text_resource" | "local_ref";
  source: PromptAttachmentSource;
  objectUrl: string | null;
  /** Absolute local path; only set for local_ref attachments. */
  localPath?: string;
  pathKind?: PromptAttachmentPathKind;
}

export type PromptDraftAttachmentDescriptor =
  | PromptAttachmentDescriptor
  | PromptPlanAttachmentDescriptor;

export interface PromptAttachmentFileCandidate {
  type: string;
  name: string;
}

export function defaultPromptCapabilities(): PromptCapabilities {
  return {
    image: false,
    audio: false,
    embeddedContext: false,
  };
}

export function canAttachPromptContent(capabilities: PromptCapabilities | null | undefined): boolean {
  return !!capabilities?.image || !!capabilities?.embeddedContext;
}

export function isTextFileCandidate(file: PromptAttachmentFileCandidate): boolean {
  if (file.type.startsWith("text/")) {
    return true;
  }
  return /\.(c|cc|cpp|cs|css|go|h|hpp|html|java|js|jsx|json|md|py|rs|sh|sql|swift|toml|ts|tsx|txt|xml|ya?ml)$/i
    .test(file.name);
}

export interface PromptUploadCapabilities {
  canAttachImages: boolean;
  canAttachEmbeddedContext: boolean;
}

/** The byte-upload kind this file is accepted as, or null when it can only be
 * attached by reference (unsupported type or over the upload size limit). */
export function promptUploadKind(
  file: PromptAttachmentFileCandidate & { size: number },
  capabilities: PromptUploadCapabilities,
): "image" | "text_resource" | null {
  if (file.type.startsWith("image/")) {
    return capabilities.canAttachImages && file.size <= PROMPT_IMAGE_MAX_BYTES
      ? "image"
      : null;
  }
  if (
    capabilities.canAttachEmbeddedContext
    && isTextFileCandidate(file)
    && file.size <= PROMPT_TEXT_RESOURCE_MAX_BYTES
  ) {
    return "text_resource";
  }
  return null;
}

/** One dropped item with its absolute local path (from the desktop host). */
export interface DroppedPathCandidate {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number | null;
}

export interface LocalRefCandidate {
  path: string;
  name: string;
  pathKind: PromptAttachmentPathKind;
  size: number | null;
}

/**
 * True when the recovered drag-pasteboard paths plausibly describe this DOM
 * drop. The drag pasteboard is global state without a session token, so a
 * non-empty FileList sharing no names with the recovered paths means the
 * pasteboard belongs to some other drag; callers then keep the byte-based
 * fallback. Folder-only drops may surface an empty FileList, which cannot be
 * cross-checked and is accepted.
 */
export function droppedPathsMatchFiles(
  candidates: readonly DroppedPathCandidate[],
  files: readonly PromptAttachmentFileCandidate[],
): boolean {
  if (files.length === 0) {
    return true;
  }
  const candidateNames = new Set(candidates.map((candidate) => candidate.name));
  return files.some((file) => candidateNames.has(file.name));
}

/**
 * Split a drop with recovered local paths into byte uploads and path
 * references. Items that today's upload pipeline accepts (images, small text
 * files) keep uploading their bytes — that stays cloud-safe and shows the
 * model the actual image — while folders and everything else attach as local
 * references the co-located agent opens by path. Files the pasteboard did not
 * account for are returned as uploads so they keep the legacy byte handling
 * (the caller's add path re-applies eligibility). Generic because this domain
 * layer compiles without DOM libs; callers pass browser `File` objects.
 */
export function partitionDroppedPathCandidates<
  TFile extends PromptAttachmentFileCandidate & { size: number },
>(
  candidates: readonly DroppedPathCandidate[],
  files: readonly TFile[],
  capabilities: PromptUploadCapabilities,
): { uploadFiles: TFile[]; localRefs: LocalRefCandidate[] } {
  const remaining = [...files];
  const uploadFiles: TFile[] = [];
  const localRefs: LocalRefCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.isDirectory) {
      // Discard the FileList entry WebKit surfaces for a directory: its bytes
      // are unreadable, and the path reference already covers the item.
      const matchIndex = remaining.findIndex((file) => file.name === candidate.name);
      if (matchIndex !== -1) {
        remaining.splice(matchIndex, 1);
      }
      localRefs.push({
        path: candidate.path,
        name: candidate.name,
        pathKind: "directory",
        size: null,
      });
      continue;
    }
    const matchIndex = remaining.findIndex((file) =>
      file.name === candidate.name && file.size === candidate.size
    );
    const match = matchIndex === -1 ? null : remaining.splice(matchIndex, 1)[0];
    if (match && promptUploadKind(match, capabilities)) {
      uploadFiles.push(match);
      continue;
    }
    localRefs.push({
      path: candidate.path,
      name: candidate.name,
      pathKind: "file",
      size: candidate.size,
    });
  }
  uploadFiles.push(...remaining);
  return { uploadFiles, localRefs };
}

export function shouldCreatePasteAttachment(text: string): boolean {
  return text.length >= PROMPT_PASTE_ATTACHMENT_MIN_CHARS
    || text.split(/\r\n|\r|\n/u).length >= PROMPT_PASTE_ATTACHMENT_MIN_LINES;
}

export function pasteAttachmentName(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("-");
  return `paste-${stamp}.txt`;
}

export function formatPromptFileSize(size: number | null | undefined): string | undefined {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    return undefined;
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formatted = value >= 10 || Number.isInteger(value)
    ? Math.round(value).toString()
    : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}
