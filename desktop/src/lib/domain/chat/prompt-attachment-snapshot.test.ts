import { describe, expect, it } from "vitest";
import {
  createPromptAttachmentSnapshot,
  promptAttachmentSnapshotsToContentParts,
} from "@/lib/domain/chat/prompt-attachment-snapshot";

describe("prompt attachment snapshots", () => {
  it("builds optimistic content parts without preview object urls", () => {
    const image = createPromptAttachmentSnapshot({
      id: "image-1",
      name: "screenshot.png",
      mimeType: "image/png",
      size: 2048,
      kind: "image",
      source: "upload",
      objectUrl: "blob://preview",
    }, { name: "screenshot.png" } as File);
    const file = createPromptAttachmentSnapshot({
      id: "file-1",
      name: "notes.txt",
      mimeType: "text/plain",
      size: 120,
      kind: "text_resource",
      source: "paste",
      objectUrl: null,
    }, { name: "notes.txt" } as File);

    expect(promptAttachmentSnapshotsToContentParts([image, file])).toEqual([
      {
        type: "image",
        attachmentId: "image-1",
        mimeType: "image/png",
        name: "screenshot.png",
        size: 2048,
        source: "upload",
      },
      {
        type: "resource",
        attachmentId: "file-1",
        uri: "file://notes.txt",
        name: "notes.txt",
        mimeType: "text/plain",
        size: 120,
        source: "paste",
      },
    ]);
  });
});
