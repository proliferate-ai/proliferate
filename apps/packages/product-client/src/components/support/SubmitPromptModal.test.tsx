// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubmitPromptModal } from "#product/components/support/SubmitPromptModal";

vi.mock("#product/hooks/support/facade/use-support-modal-state", () => ({
  useSupportModalState: () => ({
    canSend: false,
    creditConsent: false,
    creditName: "",
    handleCancel: vi.fn(),
    handleSend: vi.fn(),
    isSubmitting: false,
    message: "",
    setCreditConsent: vi.fn(),
    setCreditName: vi.fn(),
    setMessage: vi.fn(),
    stagingError: null,
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

describe("SubmitPromptModal", () => {
  afterEach(() => {
    cleanup();
  });

  // PRO-153: a prompt is prose, not code — the textarea must render in the
  // product sans stack, never the mono/code treatment.
  it("renders the prompt textarea as prose, not mono", () => {
    render(<SubmitPromptModal onClose={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/Prompt a coding agent/);
    const classes = textarea.className.split(" ");
    expect(classes).not.toContain("font-mono");
    expect(classes).toContain("text-ui");
    // The default variant is resize-none; the modal deliberately restores the handle.
    expect(classes).toContain("resize-y");
  });
});
