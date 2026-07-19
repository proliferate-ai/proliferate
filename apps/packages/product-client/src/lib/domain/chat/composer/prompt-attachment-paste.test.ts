import { describe, expect, it, vi } from "vitest";
import { handlePromptAttachmentPaste } from "#product/lib/domain/chat/composer/prompt-attachment-paste";

describe("handlePromptAttachmentPaste", () => {
  it("never duplicates a rich Markdown paste already owned by the editor", () => {
    const addFiles = vi.fn();
    const addTextPaste = vi.fn(() => true);

    expect(handlePromptAttachmentPaste({
      defaultPrevented: true,
      canAcceptAttachments: true,
      fileCount: 1,
      plainText: "- **first**\n- second",
      addFiles,
      addTextPaste,
    })).toBe(false);
    expect(addFiles).not.toHaveBeenCalled();
    expect(addTextPaste).not.toHaveBeenCalled();
  });

  it("gives files precedence and reports when the surface should prevent default", () => {
    const addFiles = vi.fn();
    const addTextPaste = vi.fn(() => true);

    expect(handlePromptAttachmentPaste({
      defaultPrevented: false,
      canAcceptAttachments: true,
      fileCount: 2,
      plainText: "clipboard fallback",
      addFiles,
      addTextPaste,
    })).toBe(true);
    expect(addFiles).toHaveBeenCalledOnce();
    expect(addTextPaste).not.toHaveBeenCalled();
  });
});
