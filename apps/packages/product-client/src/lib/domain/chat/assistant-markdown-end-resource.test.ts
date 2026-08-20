import { describe, expect, it } from "vitest";
import { resolveAssistantMarkdownEndResource } from "#product/lib/domain/chat/assistant-markdown-end-resource";
import {
  repairTranscriptFileLinks,
  stabilizeStreamingFileLink,
} from "#product/lib/domain/chat/transcript/file-link-markdown";

describe("resolveAssistantMarkdownEndResource", () => {
  it("selects the final unique Markdown file reference", () => {
    // `Final%20Decision.md:42` still resolves to a space-bearing name, but for
    // a different reason than it used to: the shared raw-reference decoder does
    // one case-insensitive `%20` pass, not `decodeURIComponent`.
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
      "~~~",
      "[tilde fake](tilde-fake.md)",
      "~~~",
      "",
      "    [indented fake](indented-fake.md)",
    ].join("\n"))).toBeNull();
  });

  it("supports MDX references and returns null for non-document files", () => {
    expect(resolveAssistantMarkdownEndResource("[guide](docs/guide.mdx)")?.displayName)
      .toBe("guide.mdx");
    expect(resolveAssistantMarkdownEndResource("[source](src/app.ts)")).toBeNull();
  });

  it("matches .md/.mdx case-insensitively on the exact decoded path", () => {
    expect(resolveAssistantMarkdownEndResource("[a](/repo/Notes.MD)")?.path)
      .toBe("/repo/Notes.MD");
    expect(resolveAssistantMarkdownEndResource("[a](/repo/Notes.MdX:3)")?.path)
      .toBe("/repo/Notes.MdX");
  });

  it("reads the same repaired destination the inline mention renders", () => {
    const source = "Result: [decision](/repo/specs/My Decision.md \"Read it\")";
    expect(repairTranscriptFileLinks(source))
      .toBe("Result: [decision](</repo/specs/My%20Decision.md> \"Read it\")");
    expect(resolveAssistantMarkdownEndResource(source)).toMatchObject({
      path: "/repo/specs/My Decision.md",
      displayName: "My Decision.md",
    });
  });

  it("keeps encoded separators literal instead of reinterpreting them", () => {
    expect(resolveAssistantMarkdownEndResource("[a](/repo/a%2Fb.md)")?.path)
      .toBe("/repo/a%2Fb.md");
    expect(resolveAssistantMarkdownEndResource("[a](/repo/%2E%2E/secret.md)")?.path)
      .toBe("/repo/%2E%2E/secret.md");
  });

  it("treats ? and # as literal path characters rather than delimiters", () => {
    expect(resolveAssistantMarkdownEndResource("[a](/repo/What is it?.md)")?.path)
      .toBe("/repo/What is it?.md");
    expect(resolveAssistantMarkdownEndResource("[a](/repo/notes.md#section)")).toBeNull();
    expect(resolveAssistantMarkdownEndResource("[a](#section)")).toBeNull();
  });

  it("returns the last newly encountered unique document", () => {
    expect(resolveAssistantMarkdownEndResource([
      "[first](/repo/one.md)",
      "[second](/repo/two.md)",
      "[first again](/repo/one.md)",
    ].join("\n\n"))?.path).toBe("/repo/two.md");
  });

  it("produces no card for an incomplete or malformed link", () => {
    expect(resolveAssistantMarkdownEndResource("[a](/repo/notes.md")).toBeNull();
    expect(resolveAssistantMarkdownEndResource("[a](/repo/My Notes.md \"unclosed")).toBeNull();
  });

  it("never consumes a synthetic streaming closure", () => {
    const streaming = "The result is [decision](/repo/specs/My Decision.md";
    expect(stabilizeStreamingFileLink(streaming))
      .toBe("The result is [decision](/repo/specs/My Decision.md)");
    // Extraction reads the settled source, so the tail yields no card until the
    // author's own `)` arrives.
    expect(resolveAssistantMarkdownEndResource(streaming)).toBeNull();
  });
});
