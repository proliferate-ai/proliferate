import { describe, expect, it } from "vitest";
import { canPreviewAsMarkdown } from "@/lib/domain/files/document-preview";

describe("canPreviewAsMarkdown", () => {
  it("supports markdown extensions", () => {
    expect(canPreviewAsMarkdown("docs/README.md")).toBe(true);
    expect(canPreviewAsMarkdown("docs/guide.markdown")).toBe(true);
    expect(canPreviewAsMarkdown("docs/page.mdx")).toBe(true);
  });

  it("supports common extensionless documentation files", () => {
    expect(canPreviewAsMarkdown("LICENSE")).toBe(true);
    expect(canPreviewAsMarkdown("NOTICE")).toBe(true);
    expect(canPreviewAsMarkdown("CHANGELOG")).toBe(true);
    expect(canPreviewAsMarkdown("CODE_OF_CONDUCT")).toBe(true);
  });

  it("keeps ordinary text and structured files in edit mode", () => {
    expect(canPreviewAsMarkdown("notes.txt")).toBe(false);
    expect(canPreviewAsMarkdown("package.json")).toBe(false);
  });
});
