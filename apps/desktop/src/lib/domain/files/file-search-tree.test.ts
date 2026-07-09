import { describe, expect, it } from "vitest";
import { buildFileSearchTree, truncatePathLabel } from "./file-search-tree";

describe("buildFileSearchTree", () => {
  it("groups matches by parent directory preserving result order", () => {
    const groups = buildFileSearchTree([
      { name: "Button.tsx", path: "src/components/Button.tsx" },
      { name: "button.css", path: "src/styles/button.css" },
      { name: "Badge.tsx", path: "src/components/Badge.tsx" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]!.path).toBe("src/components");
    expect(groups[0]!.files.map((f) => f.name)).toEqual(["Button.tsx", "Badge.tsx"]);
    expect(groups[1]!.path).toBe("src/styles");
    expect(groups[1]!.files.map((f) => f.name)).toEqual(["button.css"]);
  });

  it("groups root-level matches under a '/' label", () => {
    const groups = buildFileSearchTree([
      { name: "package.json", path: "package.json" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.path).toBe("");
    expect(groups[0]!.label).toBe("/");
  });

  it("returns an empty list for no matches", () => {
    expect(buildFileSearchTree([])).toEqual([]);
  });
});

describe("truncatePathLabel", () => {
  it("keeps short labels intact", () => {
    expect(truncatePathLabel("src/components")).toBe("src/components");
  });

  it("middle-truncates long interior segments, keeping edges readable", () => {
    const label = "documentation/processes-and-standards/legal/troubleshooting";
    const truncated = truncatePathLabel(label);
    expect(truncated.startsWith("documentation/")).toBe(true);
    expect(truncated.endsWith("/troubleshooting")).toBe(true);
    expect(truncated).toContain("…");
    expect(truncated.length).toBeLessThan(label.length);
  });

  it("does not truncate two-segment paths", () => {
    const label = "extremely-long-directory-name-here/another-quite-long-name";
    expect(truncatePathLabel(label)).toBe(label);
  });
});
