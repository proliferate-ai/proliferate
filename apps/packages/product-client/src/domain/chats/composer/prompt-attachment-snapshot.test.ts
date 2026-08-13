import { describe, expect, it } from "vitest";
import {
  clonePromptAttachmentSnapshot,
  createPromptAttachmentSnapshot,
  promptAttachmentSnapshotsToContentParts,
} from "./prompt-attachment-snapshot";

describe("prompt attachment snapshots", () => {
  it("preserves payload handles while projecting durable content parts", () => {
    const imageFile = { tag: "image-file" };
    const textFile = { tag: "text-file" };
    const image = createPromptAttachmentSnapshot({
      id: "image-1",
      name: "screen.png",
      mimeType: "image/png",
      size: 123,
      kind: "image",
      source: "upload",
    }, imageFile);
    const text = createPromptAttachmentSnapshot({
      id: "text-1",
      name: "notes.txt",
      mimeType: "text/plain",
      size: 456,
      kind: "text_resource",
      source: "paste",
    }, textFile);

    expect(clonePromptAttachmentSnapshot(image).file).toBe(imageFile);
    expect(promptAttachmentSnapshotsToContentParts([image, text])).toEqual([
      {
        type: "image",
        attachmentId: "image-1",
        mimeType: "image/png",
        name: "screen.png",
        size: 123,
        source: "upload",
      },
      {
        type: "resource",
        attachmentId: "text-1",
        uri: "file://notes.txt",
        name: "notes.txt",
        mimeType: "text/plain",
        size: 456,
        source: "paste",
      },
    ]);
  });

  it("projects local references as resource links with encoded file URIs", () => {
    const folder = createPromptAttachmentSnapshot({
      id: "ref-1",
      name: "My Folder",
      mimeType: "inode/directory",
      size: 0,
      kind: "local_ref",
      source: "upload",
      localPath: "/Users/dev/My Folder",
      pathKind: "directory",
    }, null);
    const archive = createPromptAttachmentSnapshot({
      id: "ref-2",
      name: "archive.zip",
      mimeType: "",
      size: 2048,
      kind: "local_ref",
      source: "upload",
      localPath: "/Users/dev/archive.zip",
      pathKind: "file",
    }, null);

    expect(promptAttachmentSnapshotsToContentParts([folder, archive])).toEqual([
      {
        type: "resource_link",
        uri: "file:///Users/dev/My%20Folder",
        name: "My Folder",
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
