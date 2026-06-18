import { describe, expect, it } from "vitest";
import { pickFuzzyPathMatch, resolveFileReference } from "./path-references";

describe("pickFuzzyPathMatch", () => {
  const tree = [
    "apps/desktop/src/components/content/ui/MarkdownRenderer.tsx",
    "apps/desktop/src/components/content/ui/FilePathLink.tsx",
    "apps/desktop/src/lib/index.ts",
    "server/src/lib/index.ts",
  ];

  it("corrects a partial path to the unique suffix match", () => {
    expect(pickFuzzyPathMatch("content/ui/MarkdownRenderer.tsx", tree))
      .toBe("apps/desktop/src/components/content/ui/MarkdownRenderer.tsx");
  });

  it("returns null when the path already exists (exact match present)", () => {
    expect(pickFuzzyPathMatch("apps/desktop/src/lib/index.ts", tree)).toBeNull();
  });

  it("returns null when the suffix is ambiguous", () => {
    expect(pickFuzzyPathMatch("lib/index.ts", tree)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(pickFuzzyPathMatch("nope/Missing.tsx", tree)).toBeNull();
  });

  it("matches case-insensitively but returns the real casing", () => {
    expect(pickFuzzyPathMatch("content/ui/markdownrenderer.tsx", tree))
      .toBe("apps/desktop/src/components/content/ui/MarkdownRenderer.tsx");
  });
});

describe("resolveFileReference", () => {
  const resolveAbsolute = (path: string) => path.startsWith("/")
    ? path
    : `/repo/${path.startsWith("./") ? path.slice(2) : path}`;

  it("resolves relative paths for sidebar opening while preserving absolute paths", () => {
    expect(resolveFileReference({
      rawPath: "./src/App.tsx:12",
      workspaceRoot: "/repo",
      resolveAbsolute,
    })).toMatchObject({
      path: "./src/App.tsx",
      line: 12,
      column: null,
      absolutePath: "/repo/src/App.tsx",
      workspacePath: "src/App.tsx",
    });
  });

  it("maps absolute paths under the workspace back to workspace-relative paths", () => {
    expect(resolveFileReference({
      rawPath: "/repo/src/App.tsx:12:4",
      workspaceRoot: "/repo",
      resolveAbsolute,
    })).toMatchObject({
      path: "/repo/src/App.tsx",
      line: 12,
      column: 4,
      absolutePath: "/repo/src/App.tsx",
      workspacePath: "src/App.tsx",
    });
  });

  it("does not open external absolute paths in the workspace sidebar", () => {
    expect(resolveFileReference({
      rawPath: "/tmp/file.txt",
      workspaceRoot: "/repo",
      resolveAbsolute,
    })).toMatchObject({
      absolutePath: "/tmp/file.txt",
      workspacePath: null,
    });
  });
});
