import { describe, expect, it } from "vitest";
import { resolveFileReference } from "./path-references";

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
