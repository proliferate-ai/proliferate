import { describe, expect, it } from "vitest";
import { normalizeLocalFileLinkMarkdown } from "#product/lib/domain/chat/transcript/file-link-markdown";

describe("normalizeLocalFileLinkMarkdown", () => {
  it("repairs explicit local file links containing literal spaces", () => {
    expect(normalizeLocalFileLinkMarkdown(
      "Open [the draft](/Users/pablo/My Project/Final Draft.md).",
    )).toBe(
      "Open [the draft](</Users/pablo/My%20Project/Final%20Draft.md>).",
    );
  });

  it("does not rewrite images, web links, or ordinary prose", () => {
    const source = [
      "![preview](/Users/pablo/My Image.png)",
      "[search](https://example.com/a b)",
      "Plain text (with spaces)",
    ].join("\n");
    expect(normalizeLocalFileLinkMarkdown(source)).toBe(source);
  });

  it("preserves already encoded and angle-wrapped local destinations", () => {
    const source = [
      "[encoded](/Users/pablo/My%20Project/README.md)",
      "[wrapped](</Users/pablo/My Project/README.md>)",
    ].join("\n");

    expect(normalizeLocalFileLinkMarkdown(source)).toBe(source);
  });

  it("preserves inline and fenced code examples", () => {
    const source = [
      "`[inline](/Users/pablo/My Project/README.md)`",
      "```md",
      "[fenced](/Users/pablo/My Project/README.md)",
      "```",
      "~~~md",
      "[tilde fenced](/Users/pablo/My Project/README.md)",
      "~~~",
    ].join("\n");

    expect(normalizeLocalFileLinkMarkdown(source)).toBe(source);
  });

  it("repairs local destinations containing balanced parentheses", () => {
    expect(normalizeLocalFileLinkMarkdown(
      "Open [copy](/Users/pablo/My Project/Final (copy).md).",
    )).toBe(
      "Open [copy](</Users/pablo/My%20Project/Final%20(copy).md>).",
    );
  });
});
