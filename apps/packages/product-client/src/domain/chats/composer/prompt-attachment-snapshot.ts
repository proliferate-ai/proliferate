import type { PromptAttachmentPathKind } from "./prompt-attachment-rules";

export type PromptAttachmentSource = "upload" | "paste";

export interface PromptAttachmentSnapshotDescriptor {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text_resource" | "local_ref";
  source: PromptAttachmentSource;
  localPath?: string;
  pathKind?: PromptAttachmentPathKind;
}

export interface PromptAttachmentSnapshot<TFile = unknown> {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text_resource" | "local_ref";
  source: PromptAttachmentSource;
  /** Null for local_ref attachments, which carry no bytes. */
  file: TFile;
  localPath?: string;
  pathKind?: PromptAttachmentPathKind;
}

export function createPromptAttachmentSnapshot<TFile>(
  descriptor: PromptAttachmentSnapshotDescriptor,
  file: TFile,
): PromptAttachmentSnapshot<TFile> {
  return {
    id: descriptor.id,
    name: descriptor.name,
    mimeType: descriptor.mimeType,
    size: descriptor.size,
    kind: descriptor.kind,
    source: descriptor.source,
    file,
    localPath: descriptor.localPath,
    pathKind: descriptor.pathKind,
  };
}

export function clonePromptAttachmentSnapshot<TFile>(
  snapshot: PromptAttachmentSnapshot<TFile>,
): PromptAttachmentSnapshot<TFile> {
  return {
    ...snapshot,
    file: snapshot.file,
  };
}

/** Encode an absolute POSIX path as a file:// URI. */
export function localPathToFileUri(path: string): string {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`;
}
