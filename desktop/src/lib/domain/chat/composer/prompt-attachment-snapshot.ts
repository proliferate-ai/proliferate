import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import type {
  PromptAttachmentDescriptor,
  PromptAttachmentSource,
} from "@/lib/domain/chat/composer/prompt-attachment-rules";

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
        data: await readAsBase64(snapshot.file),
        mimeType: snapshot.mimeType,
        name: snapshot.name,
        source: snapshot.source,
      });
      continue;
    }
    blocks.push({
      type: "resource",
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

async function readAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function readAsText(file: File): Promise<string> {
  return file.text();
}
