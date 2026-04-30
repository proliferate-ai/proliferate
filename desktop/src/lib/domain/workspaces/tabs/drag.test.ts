import { describe, expect, it } from "vitest";
import {
  isSameDropPlacement,
  reorderShellTabsByDrag,
  resolveDragOffsetX,
  resolveDropSide,
  resolveDropTarget,
} from "./drag";

describe("drop geometry", () => {
  it("resolves before or after a target midpoint", () => {
    expect(resolveDropSide({ pointerX: 49, targetLeft: 0, targetWidth: 100 })).toBe("before");
    expect(resolveDropSide({ pointerX: 50, targetLeft: 0, targetWidth: 100 })).toBe("after");
  });

  it("resolves targets inside rows, gaps, and strip edges", () => {
    const rows = [
      { id: "a", left: 0, width: 100 },
      { id: "b", left: 130, width: 100 },
      { id: "c", left: 260, width: 100 },
    ];

    expect(resolveDropTarget({ pointerX: -10, rows })).toEqual({ targetId: "a", side: "before" });
    expect(resolveDropTarget({ pointerX: 70, rows })).toEqual({ targetId: "a", side: "after" });
    expect(resolveDropTarget({ pointerX: 105, rows })).toEqual({ targetId: "a", side: "after" });
    expect(resolveDropTarget({ pointerX: 125, rows })).toEqual({ targetId: "b", side: "before" });
    expect(resolveDropTarget({ pointerX: 380, rows })).toEqual({ targetId: "c", side: "after" });
  });

  it("recognizes unchanged drop placements", () => {
    expect(isSameDropPlacement(
      { targetId: "a", side: "before" },
      { targetId: "a", side: "before" },
    )).toBe(true);
    expect(isSameDropPlacement(
      { targetId: "a", side: "before" },
      { targetId: "a", side: "after" },
    )).toBe(false);
  });

  it("keeps the grabbed point under the cursor after layout shifts", () => {
    expect(resolveDragOffsetX({
      pointerX: 180,
      grabOffsetX: 30,
      currentLeft: 100,
    })).toBe(50);

    expect(resolveDragOffsetX({
      pointerX: 180,
      grabOffsetX: 30,
      currentLeft: 160,
    })).toBe(-10);
  });
});

describe("shell tab drag reorder", () => {
  it("moves standalone shell keys independently", () => {
    expect(reorderShellTabsByDrag({
      orderedKeys: ["chat:a", "file:a.ts", "file:b.ts"],
      draggedKey: "file:b.ts",
      targetKey: "chat:a",
      side: "before",
      unitsBySourceId: new Map(),
    })).toEqual(["file:b.ts", "chat:a", "file:a.ts"]);
  });

  it("moves grouped chat keys as an atomic shell slice", () => {
    const unitsBySourceId = new Map<string, readonly string[]>([
      ["chat:a", ["chat:a", "chat:b"]],
      ["file:src/a.ts", ["file:src/a.ts"]],
    ]);

    expect(reorderShellTabsByDrag({
      orderedKeys: ["chat:a", "chat:b", "file:src/a.ts"],
      draggedKey: "chat:a",
      targetKey: "file:src/a.ts",
      side: "after",
      unitsBySourceId,
    })).toEqual(["file:src/a.ts", "chat:a", "chat:b"]);
  });

  it("snaps drops on grouped chat members outside the full shell slice", () => {
    const unitsBySourceId = new Map<string, readonly string[]>([
      ["chat:a", ["chat:a", "chat:b"]],
      ["file:src/a.ts", ["file:src/a.ts"]],
    ]);

    expect(reorderShellTabsByDrag({
      orderedKeys: ["chat:a", "chat:b", "file:src/a.ts"],
      draggedKey: "file:src/a.ts",
      targetKey: "chat:a",
      side: "before",
      unitsBySourceId,
    })).toEqual(["file:src/a.ts", "chat:a", "chat:b"]);
  });
});
