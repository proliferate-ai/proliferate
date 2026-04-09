import { describe, expect, it } from "vitest";
import {
  getExpandedFileVisualKind,
  getFileVisual,
} from "./file-visuals";

describe("getFileVisual", () => {
  it("maps directories to specialized folder icons", () => {
    expect(getFileVisual("src", "src", "directory")).toEqual({
      kind: "directory-src",
    });
    expect(getFileVisual(".git", ".git", "directory")).toEqual({
      kind: "directory-git",
    });
    expect(getFileVisual(".github", ".github", "directory")).toEqual({
      kind: "directory",
    });
    expect(getFileVisual("docs", "docs", "directory")).toEqual({
      kind: "directory-docs",
    });
  });

  it("maps important config and package files to tool-specific icons", () => {
    expect(getFileVisual("package.json", "package.json", "file")).toEqual({
      kind: "npm",
    });
    expect(getFileVisual("pnpm-lock.yaml", "pnpm-lock.yaml", "file")).toEqual({
      kind: "pnpm",
    });
    expect(getFileVisual("eslint.config.js", "eslint.config.js", "file")).toEqual({
      kind: "eslint",
    });
    expect(getFileVisual("tsconfig.base.json", "tsconfig.base.json", "file")).toEqual({
      kind: "tsconfig",
    });
  });

  it("maps common language files to language-specific icons", () => {
    expect(getFileVisual("main.rs", "src/main.rs", "file")).toEqual({
      kind: "rust",
    });
    expect(getFileVisual("App.tsx", "src/App.tsx", "file")).toEqual({
      kind: "react-ts",
    });
    expect(getFileVisual("index.jsx", "src/index.jsx", "file")).toEqual({
      kind: "react",
    });
    expect(getFileVisual("main.py", "main.py", "file")).toEqual({
      kind: "python",
    });
  });

  it("maps special-purpose filenames before falling back to extensions", () => {
    expect(getFileVisual(".env.local", ".env.local", "file")).toEqual({
      kind: "env",
    });
    expect(getFileVisual("README.md", "README.md", "file")).toEqual({
      kind: "readme",
    });
    expect(getFileVisual("docker-compose.yml", "docker-compose.yml", "file")).toEqual({
      kind: "docker",
    });
    expect(getFileVisual("widget.test.tsx", "widget.test.tsx", "file")).toEqual({
      kind: "test-jsx",
    });
  });
});

describe("getExpandedFileVisualKind", () => {
  it("maps closed folder visuals to their open variants", () => {
    expect(getExpandedFileVisualKind("directory")).toBe("directory-open");
    expect(getExpandedFileVisualKind("directory-src")).toBe("directory-src-open");
    expect(getExpandedFileVisualKind("directory-test")).toBe("directory-test-open");
  });

  it("leaves file visuals unchanged", () => {
    expect(getExpandedFileVisualKind("typescript")).toBe("typescript");
    expect(getExpandedFileVisualKind("docker")).toBe("docker");
  });
});
