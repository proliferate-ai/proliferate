import { describe, expect, it } from "vitest";
import { createTabDragController } from "./drag-controller";

describe("tab drag controller", () => {
  it("activates only after crossing the movement threshold", () => {
    const controller = createTabDragController({ thresholdPx: 4 });
    controller.start({ rowId: "a", pointerId: 1, pointerX: 10 });

    expect(controller.move({
      pointerId: 1,
      pointerX: 13,
      placement: { targetId: "b", side: "before" },
    })).toEqual({
      draggingRowId: null,
      placement: null,
      placementChanged: false,
    });

    expect(controller.move({
      pointerId: 1,
      pointerX: 14,
      placement: { targetId: "b", side: "before" },
    })).toEqual({
      draggingRowId: "a",
      placement: { targetId: "b", side: "before" },
      placementChanged: true,
    });
  });

  it("does not emit repeated placements inside the same target half", () => {
    const controller = createTabDragController({ thresholdPx: 4 });
    controller.start({ rowId: "a", pointerId: 1, pointerX: 0 });

    expect(controller.move({
      pointerId: 1,
      pointerX: 5,
      placement: { targetId: "b", side: "after" },
    }).placementChanged).toBe(true);
    expect(controller.move({
      pointerId: 1,
      pointerX: 6,
      placement: { targetId: "b", side: "after" },
    }).placementChanged).toBe(false);
  });

  it("suppresses only the click for the dragged row and clears after consumption", () => {
    const controller = createTabDragController({ thresholdPx: 1 });
    controller.start({ rowId: "a", pointerId: 1, pointerX: 0 });
    controller.move({
      pointerId: 1,
      pointerX: 2,
      placement: { targetId: "b", side: "before" },
    });
    expect(controller.finish(1)).toEqual({ suppressedRowId: "a" });

    expect(controller.consumeSuppressedClick("b")).toBe(false);
    expect(controller.consumeSuppressedClick("a")).toBe(true);
    expect(controller.consumeSuppressedClick("a")).toBe(false);
  });

  it("clears active drag state on cancel", () => {
    const controller = createTabDragController({ thresholdPx: 1 });
    controller.start({ rowId: "a", pointerId: 1, pointerX: 0 });
    controller.move({
      pointerId: 1,
      pointerX: 2,
      placement: { targetId: "b", side: "before" },
    });
    controller.cancel();

    expect(controller.snapshot()).toEqual({
      pendingRowId: null,
      draggingRowId: null,
      pointerId: null,
    });
  });
});
