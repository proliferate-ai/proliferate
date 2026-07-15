import { describe, expect, it } from "vitest";
import { stripMarkdownToSearchText } from "./transcript-search-text";

describe("stripMarkdownToSearchText", () => {
  it("returns empty for empty input", () => {
    expect(stripMarkdownToSearchText("")).toBe("");
  });

  it("drops emphasis and strong markers but keeps the text", () => {
    expect(stripMarkdownToSearchText("This is **bold** and *italic* text")).toBe(
      "This is bold and italic text",
    );
    expect(stripMarkdownToSearchText("__strong__ and _em_")).toBe("strong and em");
  });

  it("keeps inline code content without backticks", () => {
    expect(stripMarkdownToSearchText("run `npm test` now")).toBe("run npm test now");
  });

  it("keeps link and image labels and drops the target", () => {
    expect(stripMarkdownToSearchText("see [the docs](https://example.com)")).toBe(
      "see the docs",
    );
    expect(stripMarkdownToSearchText("![alt text](img.png)")).toBe("alt text");
  });

  it("strips heading, blockquote, and list markers", () => {
    expect(stripMarkdownToSearchText("# Heading")).toBe("Heading");
    expect(stripMarkdownToSearchText("> quoted line")).toBe("quoted line");
    expect(stripMarkdownToSearchText("- bullet item")).toBe("bullet item");
    expect(stripMarkdownToSearchText("1. first item")).toBe("first item");
  });

  it("keeps fenced code body but drops the fence markers", () => {
    const input = ["intro", "```ts", "const x = 1;", "```", "outro"].join("\n");
    expect(stripMarkdownToSearchText(input)).toBe(
      ["intro", "const x = 1;", "outro"].join("\n"),
    );
  });

  it("does not treat emphasis markers inside fenced code as markdown", () => {
    const input = ["```", "a = b * c * d", "```"].join("\n");
    expect(stripMarkdownToSearchText(input)).toBe("a = b * c * d");
  });

  it("is deterministic across repeated calls", () => {
    const input = "**a** [b](c) `d`";
    expect(stripMarkdownToSearchText(input)).toBe(stripMarkdownToSearchText(input));
  });
});
