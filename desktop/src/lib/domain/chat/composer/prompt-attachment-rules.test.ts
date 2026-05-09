import { describe, expect, it } from "vitest";
import {
  formatPromptFileSize,
  shouldCreatePasteAttachment,
} from "./prompt-attachment-rules";

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
});
