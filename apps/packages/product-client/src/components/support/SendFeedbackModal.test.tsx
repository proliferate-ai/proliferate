// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SendFeedbackModal } from "#product/components/support/SendFeedbackModal";

vi.mock("#product/hooks/support/facade/use-support-modal-state", () => ({
  useSupportModalState: () => ({
    attachments: [],
    canSend: false,
    creditConsent: false,
    creditName: "",
    handleAttachmentDragOver: vi.fn(),
    handleAttachmentDrop: vi.fn(),
    handleAttachmentInputChange: vi.fn(),
    handleAttachmentPaste: vi.fn(),
    handleCancel: vi.fn(),
    handleSend: vi.fn(),
    includeLogs: false,
    isSubmitting: false,
    message: "",
    notifyMe: false,
    removeAttachment: vi.fn(),
    setCreditConsent: vi.fn(),
    setCreditName: vi.fn(),
    setIncludeLogs: vi.fn(),
    setMessage: vi.fn(),
    setNotifyMe: vi.fn(),
    setUrgent: vi.fn(),
    stagingError: null,
    urgent: false,
  }),
}));

vi.mock("#product/hooks/support/facade/use-support-outreach-email", () => ({
  useSupportOutreachEmail: () => ({
    effectiveEmail: "trial@proliferate.com",
    isEditing: false,
    draft: "",
    setDraft: vi.fn(),
    isSaving: false,
    error: null,
    beginEdit: vi.fn(),
    cancelEdit: vi.fn(),
    save: vi.fn(),
  }),
}));

describe("SendFeedbackModal", () => {
  afterEach(() => {
    cleanup();
  });

  // PRO-153: feedback is prose, not code — same ruling as SubmitPromptModal.
  it("renders the feedback textarea as prose, not mono", () => {
    render(<SendFeedbackModal onClose={vi.fn()} />);

    const textarea = screen.getByPlaceholderText("What happened?");
    const classes = textarea.className.split(" ");
    expect(classes).not.toContain("font-mono");
    expect(classes).toContain("text-ui");
    // The default variant is resize-none; the modal deliberately restores the handle.
    expect(classes).toContain("resize-y");
  });
});
