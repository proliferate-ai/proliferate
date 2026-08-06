import type { ContentPart } from "@anyharness/sdk";

export type PromptAttachmentSource = "upload" | "paste";

export interface PromptAttachmentSnapshotDescriptor {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text_resource";
  source: PromptAttachmentSource;
}

export interface PromptAttachmentSnapshot<TFile = unknown> {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text_resource";
  source: PromptAttachmentSource;
  file: TFile;
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

export function promptAttachmentSnapshotsToContentParts(
  snapshots: readonly PromptAttachmentSnapshot[],
): ContentPart[] {
  return snapshots.map((snapshot): ContentPart => {
    if (snapshot.kind === "image") {
      return {
        type: "image",
        attachmentId: snapshot.id,
        mimeType: snapshot.mimeType,
        name: snapshot.name,
        size: snapshot.size,
        source: snapshot.source,
      };
    }
    return {
      type: "resource",
      attachmentId: snapshot.id,
      uri: `file://${snapshot.name}`,
      name: snapshot.name,
      mimeType: snapshot.mimeType,
      size: snapshot.size,
      source: snapshot.source,
    };
  });
}
