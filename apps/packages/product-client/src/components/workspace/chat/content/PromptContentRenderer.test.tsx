// @vitest-environment jsdom

import type { ContentPart } from "@anyharness/sdk";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DraftAttachmentPreviewList,
  PromptContentRenderer,
} from "#product/components/workspace/chat/content/PromptContentRenderer";

const previewActions = vi.hoisted(() => ({
  openAttachmentPreview: vi.fn(),
  closeDraftAttachmentPreview: vi.fn(),
}));

vi.mock("#product/hooks/chat/workflows/use-prompt-attachment-preview-actions", () => ({
  usePromptAttachmentPreviewActions: () => previewActions,
}));

vi.mock("#product/hooks/access/anyharness/sessions/use-prompt-attachment-url", () => ({
  usePromptAttachmentUrl: () => ({
    data: null,
    blob: null,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("#product/components/workspace/chat/transcript/transcript-markdown", () => ({
  renderTranscriptLink: () => null,
}));

vi.mock("#product/components/workspace/chat/content/PlanReferenceAttachmentCard", () => ({
  PlanReferenceAttachmentCard: () => null,
}));

describe("PromptContentRenderer attachment cards", () => {
  beforeEach(() => {
    previewActions.openAttachmentPreview.mockReset();
    previewActions.closeDraftAttachmentPreview.mockReset();
  });

  afterEach(cleanup);

  it("shows useful draft thumbnails and compact file metadata", () => {
    const onRemove = vi.fn();
    render(<DraftAttachmentPreviewList
      attachments={[
        {
          id: "attachment:image",
          name: "reference.png",
          mimeType: "image/png",
          size: 2048,
          kind: "image",
          source: "upload",
          objectUrl: "blob:reference-image",
        },
        {
          id: "attachment:paste",
          name: "paste.txt",
          mimeType: "text/plain",
          size: 3072,
          kind: "text_resource",
          source: "paste",
          objectUrl: "blob:pasted-text",
        },
      ]}
      onRemove={onRemove}
    />);

    expect(screen.getByRole("img", { name: "reference.png" }).classList.contains("size-full"))
      .toBe(true);
    expect(screen.queryByText("Pasted text · 3 KB")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Preview reference.png" }));
    expect(previewActions.openAttachmentPreview).toHaveBeenCalledWith(expect.objectContaining({
      origin: "draft",
      sessionId: null,
      part: expect.objectContaining({ id: "attachment:image", type: "image" }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "Preview paste.txt" }));
    expect(previewActions.openAttachmentPreview).toHaveBeenCalledWith(expect.objectContaining({
      origin: "draft",
      sessionId: null,
      part: expect.objectContaining({ id: "attachment:paste", type: "file" }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "Remove paste.txt" }));
    expect(onRemove).toHaveBeenCalledWith("attachment:paste");
    expect(previewActions.openAttachmentPreview).toHaveBeenCalledTimes(2);
  });

  it("opens a submitted resource through a session-backed preview target", () => {
    const parts: ContentPart[] = [
      {
        type: "image",
        attachmentId: "attachment:image-sent",
        name: "reference.png",
        mimeType: "image/png",
        size: 2048,
        source: "upload",
      },
      {
        type: "resource",
        attachmentId: "attachment:sent",
        uri: "file://notes.md",
        name: "notes.md",
        mimeType: "text/markdown",
        size: 1536,
        source: "upload",
      },
    ];
    render(<PromptContentRenderer
      sessionId="session-1"
      parts={parts}
      includeText={false}
      variant="transcript"
      layout="wrap"
    />);

    expect(screen.queryByText("MD · 1.5 KB")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview reference.png" }));
    expect(previewActions.openAttachmentPreview).toHaveBeenCalledWith(expect.objectContaining({
      origin: "session",
      sessionId: "session-1",
      part: expect.objectContaining({
        attachmentId: "attachment:image-sent",
        type: "image",
      }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Preview notes.md" }));
    expect(previewActions.openAttachmentPreview).toHaveBeenCalledWith(expect.objectContaining({
      origin: "session",
      sessionId: "session-1",
      part: expect.objectContaining({
        attachmentId: "attachment:sent",
        type: "file",
      }),
    }));
  });
});
