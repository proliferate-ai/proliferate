import { describe, expect, it } from "vitest";
import {
  promptAttachmentSnapshotsToBlocks,
  type BrowserPromptAttachmentSnapshot,
} from "#product/lib/access/browser/prompt-attachment-blocks";

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

  it("sends local references as resource links without reading bytes", async () => {
    const blocks = await promptAttachmentSnapshotsToBlocks("", [
      {
        id: "ref-1",
        name: "logo",
        mimeType: "inode/directory",
        size: 0,
        kind: "local_ref",
        source: "upload",
        file: null,
        localPath: "/Users/dev/logo",
        pathKind: "directory",
      },
      {
        id: "ref-2",
        name: "archive.zip",
        mimeType: "",
        size: 2048,
        kind: "local_ref",
        source: "upload",
        file: null,
        localPath: "/Users/dev/archive.zip",
        pathKind: "file",
      },
    ]);

    expect(blocks).toEqual([
      {
        type: "resource_link",
        uri: "file:///Users/dev/logo",
        name: "logo",
        mimeType: "inode/directory",
        size: null,
      },
      {
        type: "resource_link",
        uri: "file:///Users/dev/archive.zip",
        name: "archive.zip",
        mimeType: null,
        size: 2048,
      },
    ]);
  });
});

function snapshot(
  overrides: Pick<BrowserPromptAttachmentSnapshot, "id" | "name" | "mimeType" | "kind"> & {
    file: File;
  },
): BrowserPromptAttachmentSnapshot {
  return {
    size: overrides.file.size,
    source: "upload",
    ...overrides,
  };
}
