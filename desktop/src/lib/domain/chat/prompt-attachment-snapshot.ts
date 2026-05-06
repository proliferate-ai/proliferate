import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import type {
  PromptAttachmentDescriptor,
  PromptAttachmentSource,
} from "@/lib/domain/chat/prompt-content";

export interface PromptAttachmentSnapshot {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text_resource";
  source: PromptAttachmentSource;
  file: File;
}

export function createPromptAttachmentSnapshot(
  descriptor: PromptAttachmentDescriptor,
  file: File,
): PromptAttachmentSnapshot {
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

export function clonePromptAttachmentSnapshot(
  snapshot: PromptAttachmentSnapshot,
): PromptAttachmentSnapshot {
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

export async function promptAttachmentSnapshotsToBlocks(
  text: string,
  snapshots: readonly PromptAttachmentSnapshot[],
): Promise<PromptInputBlock[]> {
  const blocks: PromptInputBlock[] = [];
  if (text.trim()) {
    blocks.push({ type: "text", text });
  }

  for (const snapshot of snapshots) {
    if (snapshot.kind === "image") {
      blocks.push({
        type: "image",
        attachmentId: snapshot.id,
        data: await readAsBase64(snapshot.file),
        mimeType: snapshot.mimeType,
        name: snapshot.name,
        source: snapshot.source,
      });
      continue;
    }
    blocks.push({
      type: "resource",
      attachmentId: snapshot.id,
      text: await readAsText(snapshot.file),
      uri: `file://${snapshot.name}`,
      name: snapshot.name,
      mimeType: snapshot.mimeType,
      size: snapshot.size,
      source: snapshot.source,
    });
  }

  return blocks;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  });
}
