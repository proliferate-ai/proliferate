import { describe, expect, it } from "vitest";
import {
  fileReferenceBasename,
  inlineFileReferenceLabel,
  pickFuzzyPathMatch,
  resolveFileReference,
  resolveFileReferencePrimaryAction,
} from "#product/lib/domain/files/path-references";

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

  it("infers a relative workspace path when nullable metadata was omitted on the wire", () => {
    expect(resolveFileReference({
      rawPath: "src/App.tsx",
      workspaceRoot: "/repo",
      resolveAbsolute,
      workspacePathOverride: null,
    })).toMatchObject({
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
      workspacePathOverride: null,
    })).toMatchObject({
      absolutePath: "/tmp/file.txt",
      workspacePath: null,
    });
  });

  it("expands a home-relative hidden path without treating it as a workspace path", () => {
    expect(resolveFileReference({
      rawPath: "~/.proliferate-local/dev/app/diagnostics-dev.env:12",
      workspaceRoot: "/repo",
      resolveAbsolute: () => null,
      homeDirectory: "/Users/pablo/",
    })).toMatchObject({
      path: "~/.proliferate-local/dev/app/diagnostics-dev.env",
      line: 12,
      absolutePath: "/Users/pablo/.proliferate-local/dev/app/diagnostics-dev.env",
      workspacePath: null,
    });
  });

  it("normalizes absolute traversal before deciding workspace membership", () => {
    expect(resolveFileReference({
      rawPath: "/repo/sub/../../tmp/file.txt",
      workspaceRoot: "/repo",
      resolveAbsolute,
      workspacePathOverride: null,
    })).toMatchObject({
      workspacePath: null,
    });

    expect(resolveFileReference({
      rawPath: "/repo/src/../App.tsx",
      workspaceRoot: "/repo",
      resolveAbsolute,
      workspacePathOverride: null,
    })).toMatchObject({
      workspacePath: "App.tsx",
    });
  });

  it("rejects a relative path that escapes the workspace after normalization", () => {
    expect(resolveFileReference({
      rawPath: "src/../../tmp/file.txt",
      workspaceRoot: "/repo",
      resolveAbsolute,
      workspacePathOverride: null,
    })).toMatchObject({
      workspacePath: null,
    });
  });
});

describe("resolveFileReferencePrimaryAction", () => {
  it.each([
    [{
      pathKind: "file" as const,
      canOpenViewer: true,
      canOpenExternal: true,
      canReveal: true,
    }, "open-viewer"],
    [{
      pathKind: "file" as const,
      canOpenViewer: false,
      canOpenExternal: true,
      canReveal: true,
    }, "open-external"],
    [{
      pathKind: "file" as const,
      canOpenViewer: false,
      canOpenExternal: false,
      canReveal: true,
    }, "unavailable"],
    [{
      pathKind: "directory" as const,
      canOpenViewer: true,
      canOpenExternal: true,
      canReveal: true,
    }, "reveal"],
    [{
      pathKind: "directory" as const,
      canOpenViewer: true,
      canOpenExternal: true,
      canReveal: false,
    }, "unavailable"],
    [{
      pathKind: null,
      canOpenViewer: true,
      canOpenExternal: true,
      canReveal: true,
    }, "unavailable"],
  ])("routes %o to %s", (input, expected) => {
    expect(resolveFileReferencePrimaryAction(input)).toBe(expected);
  });
});

describe("inlineFileReferenceLabel", () => {
  const resolveAbsolute = (path: string) => path;

  it("renders a markdown link's path:line destination as basename plus line", () => {
    const reference = resolveFileReference({
      rawPath: "/Users/x/proliferate/docs/FORMATTING.md:7",
      workspaceRoot: null,
      resolveAbsolute,
    });

    expect(inlineFileReferenceLabel(reference)).toBe("FORMATTING.md (line 7)");
  });

  it("prefers the workspace-relative basename when the reference is inside the workspace", () => {
    const reference = resolveFileReference({
      rawPath: "/repo/apps/web/src/App.tsx:42:8",
      workspaceRoot: "/repo",
      resolveAbsolute,
    });

    expect(inlineFileReferenceLabel(reference)).toBe("App.tsx (line 42)");
  });

  it("keeps the path when there is no line to anchor on", () => {
    const reference = resolveFileReference({
      rawPath: "apps/web/src/App.tsx",
      workspaceRoot: "/repo",
      resolveAbsolute,
    });

    expect(inlineFileReferenceLabel(reference)).toBe("apps/web/src/App.tsx");
  });

  it("tolerates a bare basename reference", () => {
    expect(inlineFileReferenceLabel({
      path: "FORMATTING.md",
      workspacePath: null,
      line: 7,
    })).toBe("FORMATTING.md (line 7)");
  });
});

describe("fileReferenceBasename", () => {
  it("takes the last segment of posix and windows paths", () => {
    expect(fileReferenceBasename("a/b/c.md")).toBe("c.md");
    expect(fileReferenceBasename("a\\b\\c.md")).toBe("c.md");
    expect(fileReferenceBasename("c.md")).toBe("c.md");
    expect(fileReferenceBasename("a/b/")).toBe("b");
  });
});
