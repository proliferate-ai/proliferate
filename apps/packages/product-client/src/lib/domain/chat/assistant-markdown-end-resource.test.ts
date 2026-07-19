import { describe, expect, it } from "vitest";
import { resolveAssistantMarkdownEndResource } from "#product/lib/domain/chat/assistant-markdown-end-resource";

describe("resolveAssistantMarkdownEndResource", () => {
  it("selects the final unique Markdown file reference", () => {
    expect(resolveAssistantMarkdownEndResource([
      "See [the implementation](/repo/src/app.ts:12).",
      "Read [the spec](/repo/specs/first.md:8).",
      "The main result is [the decision doc](</repo/specs/Final%20Decision.md:42>).",
    ].join("\n\n"))).toEqual({
      rawPath: "/repo/specs/Final Decision.md:42",
      path: "/repo/specs/Final Decision.md",
      displayName: "Final Decision.md",
      typeLabel: "Document · MD",
    });
  });

  it("ignores images, web links, and link-shaped text inside code", () => {
    expect(resolveAssistantMarkdownEndResource([
      "![diagram](diagram.md)",
      "[Docs](https://example.com/README.md)",
      "`[fake](fake.md)`",
      "```md",
      "[also fake](also-fake.md)",
      "```",
    ].join("\n"))).toBeNull();
  });

  it("supports MDX references and returns null for non-document files", () => {
    expect(resolveAssistantMarkdownEndResource("[guide](docs/guide.mdx)")?.displayName)
      .toBe("guide.mdx");
    expect(resolveAssistantMarkdownEndResource("[source](src/app.ts)")).toBeNull();
  });
});
