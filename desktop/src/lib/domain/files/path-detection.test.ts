import { describe, expect, it } from "vitest";
import { looksLikePath, splitPathLineSuffix } from "./path-detection";

describe("looksLikePath", () => {
  it("accepts relative paths with extensions", () => {
    expect(looksLikePath("src/components/Foo.tsx")).toBe(true);
    expect(looksLikePath("desktop/src/index.css")).toBe(true);
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
