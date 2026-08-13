import type { PromptInputBlock } from "@anyharness/sdk";
import {
  localPathToFileUri,
  type PromptAttachmentSnapshot,
} from "#product/domain/chats/composer/prompt-attachment-snapshot";

export type BrowserPromptAttachmentSnapshot = PromptAttachmentSnapshot<File | null>;

export async function promptAttachmentSnapshotsToBlocks(
  text: string,
  snapshots: readonly PromptAttachmentSnapshot[],
): Promise<PromptInputBlock[]> {
  const blocks: PromptInputBlock[] = [];
  if (text.trim()) {
    blocks.push({ type: "text", text });
  }

  for (const snapshot of snapshots) {
    if (snapshot.kind === "local_ref") {
      if (!snapshot.localPath) {
        throw new TypeError("Local reference attachment snapshot is missing its path.");
      }
      blocks.push({
        type: "resource_link",
        uri: localPathToFileUri(snapshot.localPath),
        name: snapshot.name,
        mimeType: snapshot.mimeType || null,
        size: snapshot.pathKind === "directory" ? null : snapshot.size,
      });
      continue;
    }
    const file = requireBrowserFile(snapshot.file);
    if (snapshot.kind === "image") {
      blocks.push({
        type: "image",
        data: await readAsBase64(file),
        mimeType: snapshot.mimeType,
        name: snapshot.name,
        source: snapshot.source,
      });
      continue;
    }
    blocks.push({
      type: "resource",
      text: await readAsText(file),
      uri: `file://${snapshot.name}`,
      name: snapshot.name,
      mimeType: snapshot.mimeType,
      size: snapshot.size,
      source: snapshot.source,
    });
  }

  return blocks;
}

function requireBrowserFile(value: unknown): File {
  if (value instanceof File) {
    return value;
  }
  throw new TypeError("Prompt attachment snapshot is missing a browser File payload.");
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
