// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptAttachmentViewer } from "#product/components/workspace/files/PromptAttachmentViewer";
import { promptAttachmentViewerTarget } from "#product/lib/domain/workspaces/viewer/viewer-target";

const attachmentUrlState = vi.hoisted(() => ({
  data: null as string | null,
  blob: null as Blob | null,
  isLoading: false,
  isError: false,
}));

vi.mock("#product/hooks/access/anyharness/sessions/use-prompt-attachment-url", () => ({
  usePromptAttachmentUrl: () => attachmentUrlState,
}));

describe("PromptAttachmentViewer", () => {
  beforeEach(() => {
    attachmentUrlState.data = null;
    attachmentUrlState.blob = null;
    attachmentUrlState.isLoading = false;
    attachmentUrlState.isError = false;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders an in-memory draft image on the read-only viewer surface", () => {
    render(<PromptAttachmentViewer target={promptAttachmentViewerTarget({
      origin: "draft",
      attachmentId: "attachment:image",
      name: "reference.png",
      mimeType: "image/png",
      size: 2048,
      attachmentKind: "image",
      attachmentSource: "upload",
      objectUrl: "blob:reference-image",
    }) as Extract<ReturnType<typeof promptAttachmentViewerTarget>, { kind: "promptAttachment" }>} />);

    expect(screen.getByRole("img", { name: "reference.png" }).getAttribute("src"))
      .toBe("blob:reference-image");
    expect(screen.queryByText("image/png · 2 KB · Read only")).not.toBeNull();
  });

  it("loads pasted draft text without writing it into the workspace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("alpha\nbeta", { status: 200 })));
    render(<PromptAttachmentViewer target={promptAttachmentViewerTarget({
      origin: "draft",
      attachmentId: "attachment:paste",
      name: "paste.txt",
      mimeType: "text/plain",
      attachmentKind: "text_resource",
      attachmentSource: "paste",
      objectUrl: "blob:pasted-text",
    }) as Extract<ReturnType<typeof promptAttachmentViewerTarget>, { kind: "promptAttachment" }>} />);

    await waitFor(() => expect(screen.queryByText(/alpha\s+beta/u)).not.toBeNull());
    expect(fetch).toHaveBeenCalledWith("blob:pasted-text");
  });

  it("shows a clear unavailable state when a draft resource was removed", () => {
    render(<PromptAttachmentViewer target={promptAttachmentViewerTarget({
      origin: "draft",
      attachmentId: "attachment:missing",
      name: "missing.txt",
      mimeType: "text/plain",
      attachmentKind: "text_resource",
      attachmentSource: "upload",
      objectUrl: null,
    }) as Extract<ReturnType<typeof promptAttachmentViewerTarget>, { kind: "promptAttachment" }>} />);

    expect(screen.queryByText("Attachment preview unavailable")).not.toBeNull();
    expect(screen.queryByText("The attachment was removed or could not be read.")).not.toBeNull();
  });

  it("renders submitted text from the fetched session attachment blob", async () => {
    attachmentUrlState.data = "blob:session-text";
    attachmentUrlState.blob = new Blob(["session resource"], { type: "text/plain" });
    render(<PromptAttachmentViewer target={promptAttachmentViewerTarget({
      origin: "session",
      sessionId: "session-1",
      attachmentId: "attachment:sent",
      name: "sent.txt",
      mimeType: "text/plain",
      attachmentKind: "text_resource",
      attachmentSource: "upload",
    }) as Extract<ReturnType<typeof promptAttachmentViewerTarget>, { kind: "promptAttachment" }>} />);

    await waitFor(() => expect(screen.queryByText("session resource")).not.toBeNull());
  });
});
