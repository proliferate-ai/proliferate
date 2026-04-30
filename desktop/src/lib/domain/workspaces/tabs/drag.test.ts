import { describe, expect, it } from "vitest";
import {
  buildChatDragUnit,
  isSameDropPlacement,
  reorderChatTabsByDrag,
  reorderFileTabsByDrag,
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

describe("chat tab drag reorder", () => {
  const childToParent = new Map([
    ["a-child-1", "a"],
    ["a-child-2", "a"],
    ["b-child", "b"],
  ]);

  it("builds a top-level group unit from a parent or collapsed pill source", () => {
    expect(buildChatDragUnit({
      sourceId: "a",
      orderedIds: ["x", "a", "a-child-1", "a-child-2", "z"],
      childToParent,
    })).toEqual({
      kind: "topLevel",
      ids: ["a", "a-child-1", "a-child-2"],
    });
  });

  it("builds a child unit for child tabs", () => {
    expect(buildChatDragUnit({
      sourceId: "a-child-1",
      orderedIds: ["a", "a-child-1", "a-child-2"],
      childToParent,
    })).toEqual({
      kind: "child",
      childId: "a-child-1",
      parentId: "a",
    });
  });

  it("moves a group as a contiguous slice", () => {
    expect(reorderChatTabsByDrag({
      orderedIds: ["a", "a-child-1", "a-child-2", "b", "c"],
      draggedId: "a",
      targetId: "c",
      side: "after",
      childToParent,
    })).toEqual(["b", "c", "a", "a-child-1", "a-child-2"]);
  });

  it("moves a collapsed group using the full persisted group slice", () => {
    expect(reorderChatTabsByDrag({
      orderedIds: ["a", "a-child-1", "a-child-2", "b", "c"],
      draggedId: "a",
      targetId: "b",
      side: "after",
      childToParent,
    })).toEqual(["b", "a", "a-child-1", "a-child-2", "c"]);
  });

  it("does not split a group when dragging a standalone tab around a child target", () => {
    expect(reorderChatTabsByDrag({
      orderedIds: ["x", "a", "a-child-1", "a-child-2", "z"],
      draggedId: "x",
      targetId: "a-child-2",
      side: "after",
      childToParent,
    })).toEqual(["a", "a-child-1", "a-child-2", "x", "z"]);
  });

  it("reorders a child only among siblings in the same group", () => {
    expect(reorderChatTabsByDrag({
      orderedIds: ["a", "a-child-1", "a-child-2", "b", "b-child"],
      draggedId: "a-child-2",
      targetId: "a-child-1",
      side: "before",
      childToParent,
    })).toEqual(["a", "a-child-2", "a-child-1", "b", "b-child"]);
  });

  it("ignores child drops outside the same group", () => {
    const orderedIds = ["a", "a-child-1", "a-child-2", "b", "b-child"];
    expect(reorderChatTabsByDrag({
      orderedIds,
      draggedId: "a-child-2",
      targetId: "b-child",
      side: "before",
      childToParent,
    })).toBe(orderedIds);

    expect(reorderChatTabsByDrag({
      orderedIds,
      draggedId: "a-child-2",
      targetId: "b",
      side: "before",
      childToParent,
    })).toBe(orderedIds);
  });
});

describe("file tab drag reorder", () => {
  it("reorders file tabs independently", () => {
    expect(reorderFileTabsByDrag({
      orderedPaths: ["a.ts", "b.ts", "c.ts"],
      draggedPath: "c.ts",
      targetPath: "a.ts",
      side: "before",
    })).toEqual(["c.ts", "a.ts", "b.ts"]);
  });
});
