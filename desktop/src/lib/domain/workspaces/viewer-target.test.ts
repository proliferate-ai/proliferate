import { describe, expect, it } from "vitest";
import { encodeBase64UrlUtf8 } from "@/lib/infra/encoding/base64url";
import {
  allChangesViewerTarget,
  defaultFileViewerMode,
  fileDiffViewerTarget,
  fileViewerTarget,
  pathIsWithinWorkspaceEntry,
  parseViewerTargetKey,
  remapPathWithinWorkspaceEntry,
  remapViewerTargetPathWithinWorkspaceEntry,
  viewerTargetEditablePath,
  viewerTargetKey,
} from "./viewer-target";

describe("viewer target keys", () => {
  it("round-trips UTF-8 paths and colon-containing refs", () => {
    const target = fileDiffViewerTarget({
      path: "src/mañana:http.ts",
      scope: "branch",
      oldPath: "src/mañana-old:http.ts",
      baseRef: "refs/heads/feature:files",
      baseOid: "abc123",
      headOid: "def456",
    });

    expect(parseViewerTargetKey(viewerTargetKey(target))).toEqual(target);
  });

  it("normalizes omitted optional fields", () => {
    expect(viewerTargetKey(fileDiffViewerTarget({
      path: "src/App.tsx",
      scope: "unstaged",
    }))).toBe(viewerTargetKey(fileDiffViewerTarget({
      path: "src/App.tsx",
      scope: "unstaged",
      oldPath: null,
      baseRef: null,
      baseOid: null,
      headOid: null,
    })));
  });

  it("returns null for malformed or unknown-version keys", () => {
    expect(parseViewerTargetKey("viewer:not-json")).toBeNull();
    expect(parseViewerTargetKey(`viewer:${encodeBase64UrlUtf8(JSON.stringify({
      v: 2,
      target: fileViewerTarget("README.md"),
    }))}`)).toBeNull();
  });

  it("normalizes legacy working_tree all-changes payloads to composite scope", () => {
    const key = `viewer:${encodeBase64UrlUtf8(JSON.stringify({
      v: 1,
      target: {
        kind: "allChanges",
        scope: "working_tree",
        baseRef: null,
        baseOid: null,
        headOid: null,
      },
    }))}`;

    expect(parseViewerTargetKey(key)).toEqual(allChangesViewerTarget({
      scope: "working_tree_composite",
    }));
  });
});

describe("default file viewer mode", () => {
  it("renders markdown by default and edits other text files", () => {
    expect(defaultFileViewerMode("README.md")).toBe("rendered");
    expect(defaultFileViewerMode("docs/page.mdx")).toBe("rendered");
    expect(defaultFileViewerMode("LICENSE")).toBe("rendered");
    expect(defaultFileViewerMode("CHANGELOG")).toBe("rendered");
    expect(defaultFileViewerMode("package.json")).toBe("edit");
  });
});

describe("viewer target editable path", () => {
  it("uses the destination path for file and file diff targets", () => {
    expect(viewerTargetEditablePath(fileViewerTarget("src/app.ts"))).toBe("src/app.ts");
    expect(viewerTargetEditablePath(fileDiffViewerTarget({
      path: "src/new.ts",
      oldPath: "src/old.ts",
      scope: "unstaged",
    }))).toBe("src/new.ts");
    expect(viewerTargetEditablePath(allChangesViewerTarget({
      scope: "working_tree_composite",
    }))).toBeNull();
  });
});

describe("viewer target path remapping", () => {
  it("matches exact paths and descendants without matching sibling prefixes", () => {
    expect(pathIsWithinWorkspaceEntry("src/app.ts", "src")).toBe(true);
    expect(pathIsWithinWorkspaceEntry("src", "src")).toBe(true);
    expect(pathIsWithinWorkspaceEntry("src-old/app.ts", "src")).toBe(false);
  });

  it("remaps file paths under a renamed entry", () => {
    expect(remapPathWithinWorkspaceEntry("src/app.ts", "src", "lib")).toBe("lib/app.ts");
    expect(remapPathWithinWorkspaceEntry("src", "src", "lib")).toBe("lib");
    expect(remapPathWithinWorkspaceEntry("src-old/app.ts", "src", "lib")).toBe("src-old/app.ts");
  });

  it("remaps editable viewer targets and leaves all-changes targets alone", () => {
    expect(remapViewerTargetPathWithinWorkspaceEntry(
      fileViewerTarget("src/app.ts"),
      "src",
      "lib",
    )).toEqual(fileViewerTarget("lib/app.ts"));
    expect(remapViewerTargetPathWithinWorkspaceEntry(
      fileDiffViewerTarget({
        path: "src/app.ts",
        oldPath: "old/app.ts",
        scope: "unstaged",
      }),
      "src",
      "lib",
    )).toEqual(fileDiffViewerTarget({
      path: "lib/app.ts",
      oldPath: "old/app.ts",
      scope: "unstaged",
    }));
    const allChanges = allChangesViewerTarget({ scope: "working_tree_composite" });
    expect(remapViewerTargetPathWithinWorkspaceEntry(allChanges, "src", "lib")).toBe(allChanges);
  });
});
