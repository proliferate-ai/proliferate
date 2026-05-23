import type { PromptInputBlock } from "@anyharness/sdk";
import type { PromptAttachmentSnapshot } from "@proliferate/product-model/chats/composer/prompt-attachment-snapshot";

export type BrowserPromptAttachmentSnapshot = PromptAttachmentSnapshot<File>;

export async function promptAttachmentSnapshotsToBlocks(
  text: string,
  snapshots: readonly PromptAttachmentSnapshot[],
): Promise<PromptInputBlock[]> {
  const blocks: PromptInputBlock[] = [];
  if (text.trim()) {
    blocks.push({ type: "text", text });
  }

  for (const snapshot of snapshots) {
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
