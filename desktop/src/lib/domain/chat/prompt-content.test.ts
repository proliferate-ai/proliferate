import { describe, expect, it } from "vitest";
import type { ContentPart } from "@anyharness/sdk";
import {
  formatPromptFileSize,
  normalizeContentParts,
  normalizeDraftAttachments,
  promptPartSummary,
} from "./prompt-content";

describe("prompt content normalization", () => {
  it("normalizes image content parts with attachment metadata", () => {
    const parts: ContentPart[] = [{
      type: "image",
      attachmentId: "att-image",
      mimeType: "image/png",
      name: "screenshot.png",
      size: 2048,
    }];

    const [part] = normalizeContentParts(parts);

    expect(part).toMatchObject({
      type: "image",
      id: "att-image",
      attachmentId: "att-image",
      name: "screenshot.png",
      mimeType: "image/png",
      size: 2048,
      sizeLabel: "2 KB",
    });
    expect(part && promptPartSummary(part)).toBe("[image: screenshot.png]");
  });

  it("normalizes text resources with bounded preview metadata", () => {
    const parts: ContentPart[] = [{
      type: "resource",
      attachmentId: "att-file",
      uri: "file:///README.md",
      name: "README.md",
      mimeType: "text/markdown",
      size: 1536,
      preview: "# Hello",
    }];

    const [part] = normalizeContentParts(parts);

    expect(part).toMatchObject({
      type: "file",
      id: "att-file",
      attachmentId: "att-file",
      name: "README.md",
      mimeType: "text/markdown",
      size: 1536,
      sizeLabel: "1.5 KB",
      preview: "# Hello",
      uri: "file:///README.md",
    });
    expect(part && promptPartSummary(part)).toBe("[file: README.md]");
  });

  it("normalizes resource links as link display parts", () => {
    const parts: ContentPart[] = [{
      type: "resource_link",
      uri: "file:///workspace/docs/spec.pdf",
      name: "spec.pdf",
      mimeType: "application/pdf",
      size: 5 * 1024 * 1024,
      description: "Design spec",
    }];

    const [part] = normalizeContentParts(parts);

    expect(part).toMatchObject({
      type: "link",
      id: "file:///workspace/docs/spec.pdf",
      name: "spec.pdf",
      mimeType: "application/pdf",
      sizeLabel: "5 MB",
      preview: "Design spec",
      uri: "file:///workspace/docs/spec.pdf",
    });
  });

  it("falls back to legacy text when no content parts are present", () => {
    expect(normalizeContentParts([], "Read [README](file://README.md)")).toEqual([{
      type: "text",
      id: "fallback-text",
      text: "Read [README](file://README.md)",
      isFallback: true,
    }]);
  });

  it("normalizes draft descriptors without raw file bytes", () => {
    const parts = normalizeDraftAttachments([
      {
        id: "draft-image",
        name: "pasted.png",
        mimeType: "image/png",
        size: 512,
        kind: "image",
        objectUrl: "blob:image",
      },
      {
        id: "draft-file",
        name: "notes.txt",
        mimeType: "text/plain",
        size: 42,
        kind: "text_resource",
        objectUrl: null,
      },
    ]);

    expect(parts).toEqual([
      {
        type: "image",
        id: "draft-image",
        name: "pasted.png",
        mimeType: "image/png",
        size: 512,
        sizeLabel: "512 B",
        objectUrl: "blob:image",
      },
      {
        type: "file",
        id: "draft-file",
        name: "notes.txt",
        mimeType: "text/plain",
        size: 42,
        sizeLabel: "42 B",
        objectUrl: null,
      },
    ]);
    expect(parts[0]).not.toHaveProperty("file");
    expect(parts[1]).not.toHaveProperty("text");
  });

  it("formats prompt file sizes using compact binary units", () => {
    expect(formatPromptFileSize(undefined)).toBeUndefined();
    expect(formatPromptFileSize(0)).toBe("0 B");
    expect(formatPromptFileSize(1024)).toBe("1 KB");
    expect(formatPromptFileSize(1536)).toBe("1.5 KB");
    expect(formatPromptFileSize(10 * 1024 * 1024)).toBe("10 MB");
  });
});
