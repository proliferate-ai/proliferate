import { describe, expect, it } from "vitest";
import { resolveUnpinnedAnchorRestore } from "./unpinned-anchor-restore";

describe("resolveUnpinnedAnchorRestore", () => {
  it("uses measured-delta when rows are inserted above the anchor (anchor moves down)", () => {
    // thinking->command split inserts a completed-history row above the anchored
    // first-visible row, so its index increases.
    expect(
      resolveUnpinnedAnchorRestore({ capturedRowIndex: 4, nextRowIndex: 5 }),
    ).toEqual({ kind: "measured-delta" });
  });

  it("uses measured-delta when rows are removed above the anchor (anchor moves up)", () => {
    expect(
      resolveUnpinnedAnchorRestore({ capturedRowIndex: 5, nextRowIndex: 3 }),
    ).toEqual({ kind: "measured-delta" });
  });

  it("uses measured-offset for a below-the-viewport change (anchor index unchanged)", () => {
    // A turn growing below the read position must not shift it: the anchor index
    // is unchanged, so we hold via the measured offset (a no-op for below).
    expect(
      resolveUnpinnedAnchorRestore({ capturedRowIndex: 2, nextRowIndex: 2 }),
    ).toEqual({ kind: "measured-offset" });
  });

  it("uses measured-offset for a same-index height change of the anchor row", () => {
    expect(
      resolveUnpinnedAnchorRestore({ capturedRowIndex: 0, nextRowIndex: 0 }),
    ).toEqual({ kind: "measured-offset" });
  });
});
