import { describe, expect, it } from "vitest";
import {
  looksLikeFileReferenceHref,
  looksLikePath,
  splitPathLineSuffix,
} from "#product/lib/domain/files/path-detection";

describe("looksLikePath", () => {
  it("accepts relative paths with extensions", () => {
    expect(looksLikePath("src/components/Foo.tsx")).toBe(true);
    expect(looksLikePath("apps/desktop/src/index.css")).toBe(true);
    expect(looksLikePath("./relative/file.ts")).toBe(true);
    expect(looksLikePath("../sibling/file.py")).toBe(true);
    expect(looksLikePath("~/.config/foo.toml")).toBe(true);
  });

  it("accepts absolute paths", () => {
    // Absolute paths always pass the heuristic; the resolver decides
    // whether they live inside the workspace.
    expect(looksLikePath("/etc/hosts")).toBe(true);
    expect(looksLikePath("/Users/me/repo/src/file.ts")).toBe(true);
    expect(looksLikePath("/var/log/system.log")).toBe(true);
  });

  it("accepts paths with known root segments even without extension", () => {
    expect(looksLikePath("src/components/ui")).toBe(true);
    expect(looksLikePath("packages/shared")).toBe(true);
    expect(looksLikePath("server/proliferate/db/models")).toBe(true);
  });

  it("accepts trailing-slash directory paths under known roots", () => {
    expect(looksLikePath("src/")).toBe(true);
    expect(looksLikePath("packages/")).toBe(true);
  });

  it("accepts paths with line suffixes", () => {
    expect(looksLikePath("src/foo.ts:42")).toBe(true);
    expect(looksLikePath("src/foo.ts:42:7")).toBe(true);
  });

  it("accepts dotfiles", () => {
    expect(looksLikePath("src/.env")).toBe(true);
    expect(looksLikePath("./.gitignore")).toBe(true);
  });

  it("rejects URLs", () => {
    expect(looksLikePath("https://example.com/foo")).toBe(false);
    expect(looksLikePath("http://example.com")).toBe(false);
    expect(looksLikePath("ftp://x/y")).toBe(false);
    expect(looksLikePath("//cdn.example.com/x.js")).toBe(false);
  });

  it("rejects strings with whitespace", () => {
    expect(looksLikePath("src/foo bar.ts")).toBe(false);
    expect(looksLikePath("src/foo.ts and more")).toBe(false);
  });

  it("rejects globs", () => {
    expect(looksLikePath("src/**/*.ts")).toBe(false);
    expect(looksLikePath("src/foo[0].ts")).toBe(false);
    expect(looksLikePath("src/{a,b}.ts")).toBe(false);
  });

  it("rejects strings without a slash", () => {
    expect(looksLikePath("Foo.tsx")).toBe(false);
    expect(looksLikePath("foo")).toBe(false);
  });

  it("rejects bare directory-shaped strings without known roots", () => {
    expect(looksLikePath("foo/bar")).toBe(false);
    expect(looksLikePath("alpha/beta")).toBe(false);
  });

  it("rejects empty / oversized", () => {
    expect(looksLikePath("")).toBe(false);
    expect(looksLikePath("   ")).toBe(false);
    expect(looksLikePath("a/" + "x".repeat(600))).toBe(false);
  });
});

describe("looksLikeFileReferenceHref", () => {
  it("accepts explicit markdown destinations for bare files", () => {
    expect(looksLikeFileReferenceHref("README.md")).toBe(true);
    expect(looksLikeFileReferenceHref("README.md:12")).toBe(true);
    expect(looksLikeFileReferenceHref("package.json:4:2")).toBe(true);
    expect(looksLikeFileReferenceHref("Makefile")).toBe(true);
  });

  it("accepts extensionless files and directory destinations", () => {
    expect(looksLikeFileReferenceHref("VERSION")).toBe(true);
    expect(looksLikeFileReferenceHref("LICENSE")).toBe(true);
    expect(looksLikeFileReferenceHref("apps")).toBe(true);
    expect(looksLikeFileReferenceHref("anyharness")).toBe(true);
    expect(looksLikeFileReferenceHref("scripts/")).toBe(true);
    expect(looksLikeFileReferenceHref("foo/bar")).toBe(true);
  });

  it("keeps URLs, schemes, and anchors out of file handling", () => {
    expect(looksLikeFileReferenceHref("https://example.com/README.md")).toBe(false);
    expect(looksLikeFileReferenceHref("javascript:1")).toBe(false);
    expect(looksLikeFileReferenceHref("mailto:team@example.com")).toBe(false);
    expect(looksLikeFileReferenceHref("#section")).toBe(false);
  });

  it("accepts a literal U+0020 space handed back by the Markdown parser", () => {
    expect(looksLikeFileReferenceHref("/repo/My Notes.md")).toBe(true);
    expect(looksLikeFileReferenceHref("/repo/My Notes.md:42")).toBe(true);
    expect(looksLikeFileReferenceHref("docs/My Notes.md")).toBe(true);
  });

  it.each([
    ["NUL", "/repo/a\u0000b.md"],
    ["a C0 control", "/repo/a\u0001b.md"],
    ["DEL", "/repo/a\u007Fb.md"],
    ["a tab", "/repo/a\tb.md"],
    ["a newline", "/repo/a\nb.md"],
    ["a carriage return", "/repo/a\rb.md"],
    ["a non-breaking space", "/repo/a\u00A0b.md"],
  ])("rejects %s", (_label, value) => {
    expect(looksLikeFileReferenceHref(value)).toBe(false);
  });

  it.each([
    "file:///repo/README.md",
    "vscode://file/repo/README.md",
    "data:text/plain,x",
    "tel:+15550000",
    "custom-scheme:whatever",
    "//cdn.example.com/README.md",
    "www.example.com/README.md",
  ])("rejects the non-local destination %s", (value) => {
    expect(looksLikeFileReferenceHref(value)).toBe(false);
  });

  it("refuses an executable scheme even when it wears a :digits tail", () => {
    // `name:12` is ambiguous between a scheme and a line suffix; the schemes
    // that can carry executable or out-of-workspace meaning lose the tie.
    expect(looksLikeFileReferenceHref("javascript:1")).toBe(false);
    expect(looksLikeFileReferenceHref("file:1")).toBe(false);
    expect(looksLikeFileReferenceHref("Makefile:12")).toBe(true);
  });

  it("accepts the exact drive-root form syntactically only", () => {
    // Syntactic acceptance grants no filesystem authority: the canonical
    // locator still decides whether a drive-root reference resolves.
    expect(looksLikeFileReferenceHref("C:/repo/My Notes.md")).toBe(true);
    expect(looksLikeFileReferenceHref("C:\\repo\\My Notes.md")).toBe(true);
    expect(looksLikeFileReferenceHref("CC:/repo/notes.md")).toBe(false);
    expect(looksLikeFileReferenceHref("C:repo/notes.md")).toBe(false);
  });

  it("treats ? and # as literal path characters, and rejects glob syntax", () => {
    expect(looksLikeFileReferenceHref("/repo/What is it?.md")).toBe(true);
    expect(looksLikeFileReferenceHref("/repo/Note #3.md")).toBe(true);
    expect(looksLikeFileReferenceHref("/repo/*.md")).toBe(false);
    expect(looksLikeFileReferenceHref("/repo/[set].md")).toBe(false);
    expect(looksLikeFileReferenceHref("/repo/{a,b}.md")).toBe(false);
  });

  it("does not strip a query- or fragment-looking suffix off the reference", () => {
    // The card and the mention must resolve the same target, so `?`/`#` may
    // never truncate the destination into a different path.
    expect(looksLikeFileReferenceHref("?onlyquery")).toBe(true);
    expect(looksLikeFileReferenceHref("#onlyfragment")).toBe(false);
  });
});

describe("looksLikePath stays unchanged for non-href callers", () => {
  it("still rejects whitespace and ? for inline-code detection", () => {
    // Inline-code path detection has no explicit "this is a link" signal, so
    // its stricter grammar is intentionally untouched by the href change.
    expect(looksLikePath("/repo/My Notes.md")).toBe(false);
    expect(looksLikePath("src/What is it?.md")).toBe(false);
    expect(looksLikePath("src/foo.ts")).toBe(true);
  });
});

describe("splitPathLineSuffix", () => {
  it("returns the path unchanged when there is no suffix", () => {
    expect(splitPathLineSuffix("src/foo.ts")).toEqual({
      path: "src/foo.ts",
      line: null,
      column: null,
    });
  });

  it("parses :line", () => {
    expect(splitPathLineSuffix("src/foo.ts:42")).toEqual({
      path: "src/foo.ts",
      line: 42,
      column: null,
    });
  });

  it("parses :line:col", () => {
    expect(splitPathLineSuffix("src/foo.ts:42:7")).toEqual({
      path: "src/foo.ts",
      line: 42,
      column: 7,
    });
  });
});
