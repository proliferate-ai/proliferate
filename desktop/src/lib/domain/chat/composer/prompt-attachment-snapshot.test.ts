import { describe, expect, it } from "vitest";
import {
  promptAttachmentSnapshotsToBlocks,
  type PromptAttachmentSnapshot,
} from "@/lib/domain/chat/composer/prompt-attachment-snapshot";

describe("promptAttachmentSnapshotsToBlocks", () => {
  it("does not send client attachment ids with inline payload blocks", async () => {
    const blocks = await promptAttachmentSnapshotsToBlocks("Use this", [
      snapshot({
        id: "image-local-id",
        name: "image.png",
        mimeType: "image/png",
        kind: "image",
        file: new File(["image-bytes"], "image.png", { type: "image/png" }),
      }),
      snapshot({
        id: "text-local-id",
        name: "notes.txt",
        mimeType: "text/plain",
        kind: "text_resource",
        file: new File(["notes"], "notes.txt", { type: "text/plain" }),
      }),
    ]);

    expect(blocks[0]).toMatchObject({ type: "text", text: "Use this" });
    expect(blocks[1]).toMatchObject({ type: "image", name: "image.png" });
    expect(blocks[1]).not.toHaveProperty("attachmentId");
    expect(blocks[2]).toMatchObject({ type: "resource", name: "notes.txt", text: "notes" });
    expect(blocks[2]).not.toHaveProperty("attachmentId");
  });
});

function snapshot(
  overrides: Pick<PromptAttachmentSnapshot, "id" | "name" | "mimeType" | "kind" | "file">,
): PromptAttachmentSnapshot {
  return {
    size: overrides.file.size,
    source: "upload",
    ...overrides,
  };
}
