import { describe, expect, it } from "vitest";
import {
  FILE_TREE_DOCK_DEFAULT_WIDTH,
  FILE_TREE_DOCK_MIN_WIDTH,
  defaultFileTreeDockRecord,
  fileTreeDockRecordsEqual,
  normalizeFileTreeDockWidth,
  parseLegacyFileTreeOverlayWidth,
  parsePersistedFileTreeDockV1,
} from "#product/lib/domain/files/file-tree-dock-state";

describe("normalizeFileTreeDockWidth", () => {
  it("normalizes non-finite and non-numeric values to the default", () => {
    expect(normalizeFileTreeDockWidth(Number.NaN)).toBe(FILE_TREE_DOCK_DEFAULT_WIDTH);
    expect(normalizeFileTreeDockWidth(Number.POSITIVE_INFINITY)).toBe(
      FILE_TREE_DOCK_DEFAULT_WIDTH,
    );
    expect(normalizeFileTreeDockWidth("420")).toBe(FILE_TREE_DOCK_DEFAULT_WIDTH);
    expect(normalizeFileTreeDockWidth(undefined)).toBe(FILE_TREE_DOCK_DEFAULT_WIDTH);
  });

  it("clamps only the durable lower bound and preserves larger finite widths", () => {
    expect(normalizeFileTreeDockWidth(10)).toBe(FILE_TREE_DOCK_MIN_WIDTH);
    expect(normalizeFileTreeDockWidth(-5)).toBe(FILE_TREE_DOCK_MIN_WIDTH);
    expect(normalizeFileTreeDockWidth(2400)).toBe(2400);
  });
});

describe("parsePersistedFileTreeDockV1", () => {
  it("accepts a v1 record and drops non-boolean visibility entries", () => {
    expect(
      parsePersistedFileTreeDockV1({
        version: 1,
        width: 520,
        requestedVisibilityByWorkspace: { "logical-1": true, "logical-2": "yes", "": true },
      }),
    ).toEqual({
      version: 1,
      width: 520,
      requestedVisibilityByWorkspace: { "logical-1": true },
    });
  });

  it("recoverably normalizes a corrupt v1 record instead of rejecting it", () => {
    expect(
      parsePersistedFileTreeDockV1({
        version: 1,
        width: "wide",
        requestedVisibilityByWorkspace: ["logical-1"],
      }),
    ).toEqual(defaultFileTreeDockRecord());
  });

  it("rejects shapes that are not v1 records", () => {
    expect(parsePersistedFileTreeDockV1(undefined)).toBeNull();
    expect(parsePersistedFileTreeDockV1(null)).toBeNull();
    expect(parsePersistedFileTreeDockV1([{ version: 1 }])).toBeNull();
    expect(parsePersistedFileTreeDockV1({ width: 400 })).toBeNull();
    expect(parsePersistedFileTreeDockV1({ version: 2, width: 400 })).toBeNull();
  });
});

describe("parseLegacyFileTreeOverlayWidth", () => {
  it("accepts exactly the unversioned { width: number } payload", () => {
    expect(parseLegacyFileTreeOverlayWidth({ width: 512 })).toBe(512);
    expect(parseLegacyFileTreeOverlayWidth({ width: 12 })).toBe(FILE_TREE_DOCK_MIN_WIDTH);
  });

  it("rejects versioned, non-numeric, and non-object legacy shapes", () => {
    expect(parseLegacyFileTreeOverlayWidth({ version: 1, width: 512 })).toBeNull();
    expect(parseLegacyFileTreeOverlayWidth({ width: "512" })).toBeNull();
    expect(parseLegacyFileTreeOverlayWidth({ width: Number.NaN })).toBeNull();
    expect(parseLegacyFileTreeOverlayWidth({ expandedPaths: ["a"] })).toBeNull();
    expect(parseLegacyFileTreeOverlayWidth(512)).toBeNull();
    expect(parseLegacyFileTreeOverlayWidth(undefined)).toBeNull();
  });
});

describe("fileTreeDockRecordsEqual", () => {
  it("compares width and visibility own keys", () => {
    const base = {
      version: 1 as const,
      width: 400,
      requestedVisibilityByWorkspace: { a: true },
    };
    expect(fileTreeDockRecordsEqual(base, { ...base })).toBe(true);
    expect(fileTreeDockRecordsEqual(base, { ...base, width: 401 })).toBe(false);
    expect(
      fileTreeDockRecordsEqual(base, {
        ...base,
        requestedVisibilityByWorkspace: { a: false },
      }),
    ).toBe(false);
    expect(
      fileTreeDockRecordsEqual(base, {
        ...base,
        requestedVisibilityByWorkspace: { a: true, b: true },
      }),
    ).toBe(false);
  });
});
