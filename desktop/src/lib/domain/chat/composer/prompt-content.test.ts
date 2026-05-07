import { describe, expect, it } from "vitest";
import type { ContentPart } from "@anyharness/sdk";
import {
  formatPromptFileSize,
  isResolvedPlanAttachment,
  normalizeContentParts,
  normalizeDraftAttachments,
  planAttachmentPlaceholderFromPointer,
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
      source: "upload",
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
      source: "paste",
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
      source: "paste",
    });
    expect(part && promptPartSummary(part)).toBe("[paste: README.md]");
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

  it("normalizes plan references as prompt attachment parts", () => {
    const parts: ContentPart[] = [{
      type: "plan_reference",
      planId: "plan-123",
      title: "Implementation Plan",
      bodyMarkdown: "# Implementation Plan\n\nDo the thing.",
      snapshotHash: "hash-123",
      sourceSessionId: "session-123",
      sourceTurnId: "turn-123",
      sourceItemId: "item-123",
      sourceKind: "codex",
      sourceToolCallId: "tool-123",
    }];

    const [part] = normalizeContentParts(parts);

    expect(part).toMatchObject({
      type: "plan_reference",
      id: "plan:plan-123:hash-123",
      name: "Implementation Plan",
      planId: "plan-123",
      title: "Implementation Plan",
      bodyMarkdown: "# Implementation Plan\n\nDo the thing.",
      snapshotHash: "hash-123",
      sourceSessionId: "session-123",
      sourceTurnId: "turn-123",
      sourceItemId: "item-123",
      sourceKind: "codex",
      sourceToolCallId: "tool-123",
    });
    expect(part && promptPartSummary(part)).toBe("[plan: Implementation Plan]");
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
        source: "upload",
        objectUrl: "blob:image",
      },
      {
        id: "draft-file",
        name: "notes.txt",
        mimeType: "text/plain",
        size: 42,
        kind: "text_resource",
        source: "paste",
        objectUrl: null,
      },
      {
        id: "plan:plan-123:hash-123",
        kind: "plan_reference",
        planId: "plan-123",
        title: "Attached plan",
        bodyMarkdown: "# Attached plan",
        snapshotHash: "hash-123",
        sourceSessionId: "session-123",
        sourceKind: "codex",
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
        source: "upload",
      },
      {
        type: "file",
        id: "draft-file",
        name: "notes.txt",
        mimeType: "text/plain",
        size: 42,
        sizeLabel: "42 B",
        objectUrl: null,
        source: "paste",
      },
      {
        type: "plan_reference",
        id: "plan:plan-123:hash-123",
        name: "Attached plan",
        planId: "plan-123",
        title: "Attached plan",
        bodyMarkdown: "# Attached plan",
        snapshotHash: "hash-123",
        sourceSessionId: "session-123",
        sourceTurnId: null,
        sourceItemId: null,
        sourceKind: "codex",
        sourceToolCallId: null,
      },
    ]);
    expect(parts[0]).not.toHaveProperty("file");
    expect(parts[1]).not.toHaveProperty("text");
  });

  it("normalizes unresolved draft plan pointers as visible non-sendable attachments", () => {
    const placeholder = planAttachmentPlaceholderFromPointer({
      id: "plan:plan-123:hash-123",
      kind: "plan_reference",
      planId: "plan-123",
      snapshotHash: "hash-123",
    }, "error", "Plan lookup failed.");

    expect(isResolvedPlanAttachment(placeholder)).toBe(false);
    expect(normalizeDraftAttachments([placeholder])).toEqual([{
      type: "plan_reference",
      id: "plan:plan-123:hash-123",
      name: "Plan unavailable",
      planId: "plan-123",
      title: "Plan unavailable",
      bodyMarkdown: "Plan lookup failed.",
      snapshotHash: "hash-123",
      sourceSessionId: "",
      sourceTurnId: null,
      sourceItemId: null,
      sourceKind: "unknown",
      sourceToolCallId: null,
      resolutionState: "error",
      resolutionMessage: "Plan lookup failed.",
    }]);
  });

  it("formats prompt file sizes using compact binary units", () => {
    expect(formatPromptFileSize(undefined)).toBeUndefined();
    expect(formatPromptFileSize(0)).toBe("0 B");
    expect(formatPromptFileSize(1024)).toBe("1 KB");
    expect(formatPromptFileSize(1536)).toBe("1.5 KB");
    expect(formatPromptFileSize(10 * 1024 * 1024)).toBe("10 MB");
  });
});
