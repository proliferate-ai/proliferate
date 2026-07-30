import { describe, expect, it } from "vitest";
import {
  findFileMentionTrigger,
  rankFileMentionResults,
} from "#product/lib/domain/chat/composer/file-mention-search";

describe("findFileMentionTrigger", () => {
  it("opens on an @ token anywhere in the prompt", () => {
    expect(findFileMentionTrigger("@rea", 4)).toEqual({ start: 0, end: 4, query: "rea" });
    expect(findFileMentionTrigger("look at @rea", 12)).toEqual({
      start: 8,
      end: 12,
      query: "rea",
    });
  });

  it("opens with an empty query on a bare @", () => {
    expect(findFileMentionTrigger("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("does not open when the @ is inside a token", () => {
    expect(findFileMentionTrigger("user@host", 9)).toBeNull();
    expect(findFileMentionTrigger("pablo@example.com", 17)).toBeNull();
  });

  it("does not open without an @", () => {
    expect(findFileMentionTrigger("readme", 6)).toBeNull();
    expect(findFileMentionTrigger("", 0)).toBeNull();
  });

  it("reports the full token end so trailing text is replaced whole", () => {
    expect(findFileMentionTrigger("@rea dme", 4)).toEqual({ start: 0, end: 4, query: "rea" });
    expect(findFileMentionTrigger("@readme.md", 4)).toEqual({
      start: 0,
      end: 10,
      query: "rea",
    });
  });

  it("ignores out-of-range offsets and runaway tokens", () => {
    expect(findFileMentionTrigger("@rea", 9)).toBeNull();
    expect(findFileMentionTrigger("@rea", -1)).toBeNull();
    expect(findFileMentionTrigger(`@${"a".repeat(200)}`, 201)).toBeNull();
  });

  it("does not open inside an inline code span", () => {
    const text = "run `echo @host` please";
    // The "@" opens its own whitespace-delimited token, so the plain
    // token-boundary rule alone would trigger here; the backtick pair around
    // it is what must suppress the menu.
    expect(findFileMentionTrigger(text, text.indexOf("@host") + "@host".length)).toBeNull();
  });

  it("does not open inside a fenced code block", () => {
    const text = "```\nimport thing from @proliferate/ui;\n```";
    expect(findFileMentionTrigger(text, text.indexOf("@proliferate") + "@proliferate".length)).toBeNull();
  });

  it("still opens for an @ in prose once any earlier code span is closed", () => {
    const text = "see `readme.md` then check @rea";
    expect(findFileMentionTrigger(text, text.length)).toEqual({
      start: text.indexOf("@rea"),
      end: text.length,
      query: "rea",
    });
  });
});

describe("rankFileMentionResults", () => {
  const candidates = [
    { path: "docs/setup/readme.md", name: "readme.md" },
    { path: "readme.md", name: "readme.md" },
    { path: "src/reader.ts", name: "reader.ts" },
    { path: "src/thread-reader.ts", name: "thread-reader.ts" },
    { path: "src/unrelated.ts", name: "unrelated.ts" },
  ];

  it("ranks basename prefix matches above basename and path substrings", () => {
    const results = rankFileMentionResults(candidates, "read", 10);

    expect(results.map((result) => result.path)).toEqual([
      "docs/setup/readme.md",
      "readme.md",
      "src/reader.ts",
      "src/thread-reader.ts",
    ]);
  });

  it("drops candidates that match nothing", () => {
    expect(rankFileMentionResults(candidates, "zzz", 10)).toEqual([]);
  });

  it("keeps every candidate when the query is empty", () => {
    expect(rankFileMentionResults(candidates, "", 10)).toHaveLength(candidates.length);
  });

  it("matches case-insensitively", () => {
    expect(rankFileMentionResults(candidates, "README", 10)[0]?.path)
      .toBe("docs/setup/readme.md");
  });

  it("exposes the parent directory as the row's disambiguator", () => {
    const results = rankFileMentionResults(candidates, "readme", 10);

    expect(results).toEqual([
      { path: "docs/setup/readme.md", name: "readme.md", parent: "docs/setup" },
      { path: "readme.md", name: "readme.md", parent: "" },
    ]);
  });

  it("drops paths that cannot be expressed as a workspace-relative link", () => {
    const results = rankFileMentionResults(
      [
        { path: "/etc/passwd", name: "passwd" },
        { path: "~/secrets.txt", name: "secrets.txt" },
        { path: "../outside.ts", name: "outside.ts" },
        { path: "https://example.com/x.ts", name: "x.ts" },
        { path: "src/inside.ts", name: "inside.ts" },
      ],
      "",
      10,
    );

    expect(results.map((result) => result.path)).toEqual(["src/inside.ts"]);
  });

  it("dedupes repeated paths and honors the limit", () => {
    const results = rankFileMentionResults(
      [
        { path: "src/a.ts", name: "a.ts" },
        { path: "src/a.ts", name: "a.ts" },
        { path: "src/b.ts", name: "b.ts" },
        { path: "src/c.ts", name: "c.ts" },
      ],
      "",
      2,
    );

    expect(results.map((result) => result.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("normalizes a leading ./ so the same file is not offered twice", () => {
    const results = rankFileMentionResults(
      [
        { path: "./src/a.ts", name: "a.ts" },
        { path: "src/a.ts", name: "a.ts" },
      ],
      "",
      10,
    );

    expect(results.map((result) => result.path)).toEqual(["src/a.ts"]);
  });

  it("falls back to the path basename when a candidate has no name", () => {
    expect(rankFileMentionResults([{ path: "src/deep/file.ts", name: "" }], "file", 10))
      .toEqual([{ path: "src/deep/file.ts", name: "file.ts", parent: "src/deep" }]);
  });
});
