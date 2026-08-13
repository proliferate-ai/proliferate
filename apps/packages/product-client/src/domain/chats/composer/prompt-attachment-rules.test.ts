import { describe, expect, it } from "vitest";
import {
  droppedPathsMatchFiles,
  formatPromptFileSize,
  partitionDroppedPathCandidates,
  PROMPT_IMAGE_MAX_BYTES,
  promptUploadKind,
  shouldCreatePasteAttachment,
} from "./prompt-attachment-rules";

const allCapabilities = { canAttachImages: true, canAttachEmbeddedContext: true };

describe("prompt attachment rules", () => {
  it("formats prompt file sizes using compact binary units", () => {
    expect(formatPromptFileSize(undefined)).toBeUndefined();
    expect(formatPromptFileSize(0)).toBe("0 B");
    expect(formatPromptFileSize(1024)).toBe("1 KB");
    expect(formatPromptFileSize(1536)).toBe("1.5 KB");
    expect(formatPromptFileSize(10 * 1024 * 1024)).toBe("10 MB");
  });

  it("promotes large pasted text into prompt attachments", () => {
    expect(shouldCreatePasteAttachment("short paste")).toBe(false);
    expect(shouldCreatePasteAttachment("x".repeat(2_000))).toBe(true);
    expect(shouldCreatePasteAttachment(Array.from({ length: 25 }, () => "line").join("\n")))
      .toBe(true);
  });

  it("classifies upload kinds by type, capability, and size limits", () => {
    const png = { type: "image/png", name: "shot.png", size: 10 };
    expect(promptUploadKind(png, allCapabilities)).toBe("image");
    expect(promptUploadKind(png, { ...allCapabilities, canAttachImages: false })).toBeNull();
    expect(promptUploadKind({ ...png, size: PROMPT_IMAGE_MAX_BYTES + 1 }, allCapabilities))
      .toBeNull();
    expect(promptUploadKind({ type: "", name: "notes.md", size: 10 }, allCapabilities))
      .toBe("text_resource");
    expect(promptUploadKind({ type: "", name: "archive.zip", size: 10 }, allCapabilities))
      .toBeNull();
    expect(promptUploadKind({ type: "application/pdf", name: "doc.pdf", size: 10 }, allCapabilities))
      .toBeNull();
  });

  it("partitions dropped paths into byte uploads and local references", () => {
    const image = new File(["png"], "shot.png", { type: "image/png" });
    const archive = new File(["zip-bytes"], "archive.zip", { type: "application/zip" });
    const { uploadFiles, localRefs } = partitionDroppedPathCandidates(
      [
        { path: "/tmp/drop/shot.png", name: "shot.png", isDirectory: false, size: image.size },
        { path: "/tmp/drop/archive.zip", name: "archive.zip", isDirectory: false, size: archive.size },
        { path: "/tmp/drop/logo", name: "logo", isDirectory: true, size: null },
      ],
      [image, archive],
      allCapabilities,
    );

    expect(uploadFiles).toEqual([image]);
    expect(localRefs).toEqual([
      { path: "/tmp/drop/archive.zip", name: "archive.zip", pathKind: "file", size: archive.size },
      { path: "/tmp/drop/logo", name: "logo", pathKind: "directory", size: null },
    ]);
  });

  it("falls back to a local reference when no dropped File matches the path", () => {
    const { uploadFiles, localRefs } = partitionDroppedPathCandidates(
      [{ path: "/tmp/drop/shot.png", name: "shot.png", isDirectory: false, size: 3 }],
      [],
      allCapabilities,
    );

    expect(uploadFiles).toEqual([]);
    expect(localRefs).toEqual([
      { path: "/tmp/drop/shot.png", name: "shot.png", pathKind: "file", size: 3 },
    ]);
  });

  it("attaches upload-ineligible images by reference instead of dropping them", () => {
    const image = new File(["png"], "shot.png", { type: "image/png" });
    const { uploadFiles, localRefs } = partitionDroppedPathCandidates(
      [{ path: "/tmp/drop/shot.png", name: "shot.png", isDirectory: false, size: image.size }],
      [image],
      { ...allCapabilities, canAttachImages: false },
    );

    expect(uploadFiles).toEqual([]);
    expect(localRefs).toEqual([
      { path: "/tmp/drop/shot.png", name: "shot.png", pathKind: "file", size: image.size },
    ]);
  });

  it("keeps unmatched files on the byte path and discards directory FileList entries", () => {
    const promiseDragged = new File(["png"], "elsewhere.png", { type: "image/png" });
    const folderEntry = new File([], "logo", { type: "" });
    const { uploadFiles, localRefs } = partitionDroppedPathCandidates(
      [{ path: "/tmp/drop/logo", name: "logo", isDirectory: true, size: null }],
      [promiseDragged, folderEntry],
      allCapabilities,
    );

    expect(uploadFiles).toEqual([promiseDragged]);
    expect(localRefs).toEqual([
      { path: "/tmp/drop/logo", name: "logo", pathKind: "directory", size: null },
    ]);
  });

  it("detects when pasteboard paths belong to a different drag", () => {
    const candidates = [
      { path: "/tmp/other/a.zip", name: "a.zip", isDirectory: false, size: 5 },
    ];
    expect(droppedPathsMatchFiles(candidates, [{ name: "b.png", type: "image/png" }]))
      .toBe(false);
    expect(droppedPathsMatchFiles(candidates, [{ name: "a.zip", type: "" }])).toBe(true);
    expect(droppedPathsMatchFiles(candidates, [])).toBe(true);
  });
});
