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

  it("keeps a link title outside the repaired destination", () => {
    expect(normalizeLocalFileLinkMarkdown(
      "See [guide](/repo/My Docs/guide.md \"Read the guide\").",
    )).toBe(
      "See [guide](</repo/My%20Docs/guide.md> \"Read the guide\").",
    );
    expect(normalizeLocalFileLinkMarkdown(
      "See [guide](/repo/My Docs/guide.md 'Read the guide').",
    )).toBe(
      "See [guide](</repo/My%20Docs/guide.md> 'Read the guide').",
    );
    expect(normalizeLocalFileLinkMarkdown(
      "See [guide](/repo/My Docs/guide.md (Read the guide)).",
    )).toBe(
      "See [guide](</repo/My%20Docs/guide.md> (Read the guide)).",
    );
  });

  it("leaves a titled link whose destination has no spaces untouched", () => {
    const source = "See [guide](/repo/docs/guide.md \"Read the guide\").";
    expect(normalizeLocalFileLinkMarkdown(source)).toBe(source);
  });

  it("treats a malformed trailing title as part of the destination", () => {
    expect(normalizeLocalFileLinkMarkdown(
      "See [guide](/repo/My Docs/guide.md \"unclosed).",
    )).toBe(
      "See [guide](</repo/My%20Docs/guide.md%20\"unclosed>).",
    );
  });

  it("repairs nested list items indented under a list line", () => {
    // The PRO-161 core case is a list of file links; a 4-space-indented list
    // continuation is not indented code, so it must still be repaired.
    expect(normalizeLocalFileLinkMarkdown([
      "- Docs:",
      "    - [guide](/repo/My Docs/guide.md)",
    ].join("\n"))).toBe([
      "- Docs:",
      "    - [guide](</repo/My%20Docs/guide.md>)",
    ].join("\n"));
  });

  it("preserves indented code blocks introduced by a blank line", () => {
    const source = [
      "Example:",
      "",
      "    [guide](/repo/My Docs/guide.md)",
      "    [other](/repo/My Docs/other.md)",
      "",
      "Done.",
    ].join("\n");

    expect(normalizeLocalFileLinkMarkdown(source)).toBe(source);
  });

  it("does not let an info-string line close a fenced block", () => {
    const source = [
      "```",
      "[fenced](/Users/pablo/My Project/README.md)",
      "```md",
      "[still fenced](/Users/pablo/My Project/README.md)",
      "```",
    ].join("\n");

    expect(normalizeLocalFileLinkMarkdown(source)).toBe(source);
  });

  it("treats an escaped bracket as literal text but still repairs a real link", () => {
    const escaped = "\\[label](/Users/pablo/My Project/README.md)";
    expect(normalizeLocalFileLinkMarkdown(escaped)).toBe(escaped);

    expect(normalizeLocalFileLinkMarkdown(
      "\\\\[label](/Users/pablo/My Project/README.md)",
    )).toBe(
      "\\\\[label](</Users/pablo/My%20Project/README.md>)",
    );
  });

  it("leaves destinations containing angle brackets untouched", () => {
    const source = "[weird](/Users/pablo/My <Project>/README.md)";
    expect(normalizeLocalFileLinkMarkdown(source)).toBe(source);
  });
});
