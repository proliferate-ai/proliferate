import { describe, expect, it } from "vitest";
import {
  fileReferenceCopyPath,
  inlineFileReferenceLabel,
  normalizeRuntimeWorkspaceRoot,
  pickFuzzyPathMatch,
  resolveFileReference,
  resolveWorkspaceStatPathKind,
  type RuntimeWorkspaceRootState,
  type WorkspaceFilesystemOriginState,
} from "#product/lib/domain/files/path-references";

const ROOT: RuntimeWorkspaceRootState = { status: "settled", path: "/repo" };
const LOCAL: WorkspaceFilesystemOriginState = {
  status: "settled",
  origin: "desktop-local",
};
const REMOTE: WorkspaceFilesystemOriginState = { status: "settled", origin: "remote" };

function resolve(overrides: Partial<Parameters<typeof resolveFileReference>[0]> = {}) {
  return resolveFileReference({
    rawPath: "src/App.tsx",
    workspaceRoot: ROOT,
    filesystemOrigin: LOCAL,
    desktopBridgeAvailable: true,
    ...overrides,
  });
}

describe("resolveFileReference", () => {
  it.each([
    [".", ""],
    ["./", ""],
    ["./src/App.tsx:12:4", "src/App.tsx"],
    ["src/./App.tsx", "src/App.tsx"],
    ["/repo", ""],
    ["/repo/", ""],
    ["/repo/src/App.tsx", "src/App.tsx"],
  ])("projects %s into workspace path %s", (rawPath, workspacePath) => {
    expect(resolve({ rawPath })).toMatchObject({
      displayPath: workspacePath || ".",
      locator: {
        authority: "workspace",
        workspacePath,
        localCompanionPath: workspacePath ? `/repo/${workspacePath}` : "/repo",
      },
    });
  });

  it("keeps line and column out of normalized and copied paths", () => {
    const reference = resolve({ rawPath: " src/App.tsx:12:4 " });
    expect(reference).toMatchObject({
      parsedPath: "src/App.tsx",
      displayPath: "src/App.tsx",
      line: 12,
      column: 4,
    });
    expect(fileReferenceCopyPath(reference)).toBe("/repo/src/App.tsx");
  });

  it("uses runtime root and provenance only for native companion capability", () => {
    expect(resolve({ filesystemOrigin: REMOTE }).locator).toEqual({
      authority: "workspace",
      workspacePath: "src/App.tsx",
      localCompanionPath: null,
    });
    expect(resolve({ desktopBridgeAvailable: false }).locator).toEqual({
      authority: "workspace",
      workspacePath: "src/App.tsx",
      localCompanionPath: null,
    });
    expect(resolve({ workspaceRoot: { status: "pending", path: null } }).locator).toEqual({
      authority: "workspace",
      workspacePath: "src/App.tsx",
      localCompanionPath: null,
    });
  });

  it.each([
    [REMOTE, true, "remote_filesystem"],
    [{ status: "pending", origin: null } as const, true, "filesystem_origin_unavailable"],
    [{ status: "rejected", origin: null } as const, true, "filesystem_origin_unavailable"],
    [LOCAL, false, "native_host_required"],
  ])("gates an external absolute path for %#", (filesystemOrigin, bridge, reason) => {
    expect(resolve({
      rawPath: "/tmp/file.txt",
      filesystemOrigin,
      desktopBridgeAvailable: bridge,
    }).locator).toEqual({ authority: "unavailable", reason });
  });

  it("classifies authority-proven absolute and home-relative Desktop paths", () => {
    expect(resolve({ rawPath: "/tmp/file.txt" }).locator).toEqual({
      authority: "desktop",
      absolutePath: "/tmp/file.txt",
      syntax: "absolute",
    });
    expect(resolve({ rawPath: "~/.config/file", homeDirectory: "/Users/pablo/" }).locator)
      .toEqual({
        authority: "desktop",
        absolutePath: "/Users/pablo/.config/file",
        syntax: "home-relative",
      });
  });

  it.each([undefined, null, "", "relative", "/bad/../home", "/bad\0home"])(
    "fails closed for invalid native home %s",
    (homeDirectory) => {
      expect(resolve({ rawPath: "~/file", homeDirectory }).locator).toEqual({
        authority: "unavailable",
        reason: "home_unavailable",
      });
    },
  );

  it("does not reclassify a home expansion under the workspace", () => {
    expect(resolve({ rawPath: "~/src/App.tsx", homeDirectory: "/repo" }).locator).toEqual({
      authority: "desktop",
      absolutePath: "/repo/src/App.tsx",
      syntax: "home-relative",
    });
  });

  it.each([
    "https://example.com/file",
    "file:/repo/a",
    "mailto:a@b.test",
    "//server/share",
    "\\\\server\\share",
    "\\rooted",
    "#fragment",
    "C:/repo/a",
    "C:\\repo\\a",
    "~user/file",
    "~\\file",
    "bad\0path",
  ])("rejects raw unsupported syntax %s", (rawPath) => {
    expect(resolve({ rawPath }).locator).toEqual({ authority: "unavailable", reason: "invalid" });
  });

  it.each(["../secret", "src/../secret", "/repo/src/../secret"])(
    "rejects every traversal segment in %s",
    (rawPath) => {
      expect(resolve({ rawPath }).locator).toEqual({
        authority: "unavailable",
        reason: "traversal",
      });
    },
  );

  it("keeps absolute references unavailable while the runtime root is unknown", () => {
    expect(resolve({
      rawPath: "/repo/src/App.tsx",
      workspaceRoot: { status: "unavailable", path: null },
    }).locator).toEqual({ authority: "unavailable", reason: "workspace_root_unavailable" });
  });

  it("treats a supplied structured value as authoritative, including invalid strings", () => {
    expect(resolve({
      rawPath: "/tmp/file.txt",
      workspacePathOverride: "src/App.tsx",
    }).locator).toMatchObject({ authority: "workspace", workspacePath: "src/App.tsx" });
    for (const workspacePathOverride of ["", "   ", "/repo/a", "~/a", "file:a", "#a"]) {
      expect(resolve({ rawPath: "src/fallback.ts", workspacePathOverride }).locator)
        .toEqual({ authority: "unavailable", reason: "invalid" });
    }
    expect(resolve({ rawPath: "src/fallback.ts", workspacePathOverride: "a/../b" }).locator)
      .toEqual({ authority: "unavailable", reason: "traversal" });
  });

  it("maps structured dot paths to workspace root", () => {
    expect(resolve({ rawPath: "/tmp/not-used", workspacePathOverride: "./" }).locator)
      .toMatchObject({ authority: "workspace", workspacePath: "" });
  });

  it("uses neutral display and null copy data only for an empty reference", () => {
    const empty = resolve({ rawPath: "  " });
    expect(empty).toMatchObject({
      parsedPath: "",
      displayPath: "File",
      locator: { authority: "unavailable", reason: "empty" },
    });
    expect(fileReferenceCopyPath(empty)).toBeNull();
    expect(fileReferenceCopyPath(resolve({ rawPath: "../secret" }))).toBe("../secret");
  });

  it("supports / as an authoritative runtime root", () => {
    const reference = resolve({
      rawPath: "/src/App.tsx",
      workspaceRoot: { status: "settled", path: "/" },
    });
    expect(reference.locator).toEqual({
      authority: "workspace",
      workspacePath: "src/App.tsx",
      localCompanionPath: "/src/App.tsx",
    });
  });
});

describe("path helpers", () => {
  it.each([
    ["/", "/"],
    ["/repo/./src/", "/repo/src"],
    ["relative", null],
    ["/repo/../tmp", null],
    ["//server/share", null],
  ])("normalizes runtime root %s", (input, expected) => {
    expect(normalizeRuntimeWorkspaceRoot(input)).toBe(expected);
  });

  it("returns the unique fuzzy suffix including an exact candidate", () => {
    expect(pickFuzzyPathMatch("src/app.ts", ["Src/App.ts"])).toBe("Src/App.ts");
    expect(pickFuzzyPathMatch("src/app.ts", ["a/src/App.ts"])).toBe("a/src/App.ts");
    expect(pickFuzzyPathMatch("src/app.ts", ["a/src/App.ts", "b/src/App.ts"])).toBeNull();
  });

  it("does not infer a symlink kind from size", () => {
    expect(resolveWorkspaceStatPathKind({ kind: "file" })).toBe("file");
    expect(resolveWorkspaceStatPathKind({ kind: "directory" })).toBe("directory");
    expect(resolveWorkspaceStatPathKind({ kind: "symlink" })).toBeNull();
  });

  it("renders root and line labels from display paths", () => {
    expect(inlineFileReferenceLabel({ displayPath: ".", line: null })).toBe(".");
    expect(inlineFileReferenceLabel({ displayPath: "src/App.tsx", line: 4 }))
      .toBe("App.tsx (line 4)");
  });
});
