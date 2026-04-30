import { describe, expect, it } from "vitest";
import {
  CHROME_TAB_MAX_WIDTH,
  CHROME_TAB_MIN_WIDTH,
  TAB_GROUP_PILL_WIDTH,
  computeChromeTabPositions,
  computeChromeTabWidths,
  computeHeaderStripLayout,
} from "./chrome-layout";

describe("computeChromeTabWidths", () => {
  it("distributes available width evenly with deterministic remainder pixels", () => {
    expect(computeChromeTabWidths({
      containerWidth: 503,
      reservedWidth: 20,
      tabCount: 4,
    })).toEqual([135, 135, 135, 135]);
  });

  it("clamps tabs between Chrome-like min and max widths", () => {
    expect(computeChromeTabWidths({
      containerWidth: 2000,
      reservedWidth: 0,
      tabCount: 3,
    })).toEqual([CHROME_TAB_MAX_WIDTH, CHROME_TAB_MAX_WIDTH, CHROME_TAB_MAX_WIDTH]);

    expect(computeChromeTabWidths({
      containerWidth: 120,
      reservedWidth: 0,
      tabCount: 4,
    })).toEqual([CHROME_TAB_MIN_WIDTH, CHROME_TAB_MIN_WIDTH, CHROME_TAB_MIN_WIDTH, CHROME_TAB_MIN_WIDTH]);
  });

  it("positions tabs with Chrome-style visual overlap", () => {
    expect(computeChromeTabPositions([184, 184, 184])).toEqual([0, 165, 330]);
  });
});

describe("computeHeaderStripLayout", () => {
  it("reserves fixed width for group pills and shares remaining width across tabs", () => {
    const layout = computeHeaderStripLayout({
      containerWidth: 400,
      rows: [{ kind: "pill" }, { kind: "tab" }, { kind: "tab" }],
    });

    expect(layout.widths).toEqual([TAB_GROUP_PILL_WIDTH, 184, 183]);
    expect(layout.positions).toEqual([0, 52, 217]);
  });

  it("does not overlap pills with adjacent tabs", () => {
    const layout = computeHeaderStripLayout({
      containerWidth: 500,
      rows: [{ kind: "tab" }, { kind: "pill" }, { kind: "tab" }],
    });

    expect(layout.widths).toEqual([184, TAB_GROUP_PILL_WIDTH, 184]);
    expect(layout.positions).toEqual([0, 188, 240]);
  });

  it("clamps tabs when pill rows leave little room", () => {
    const layout = computeHeaderStripLayout({
      containerWidth: 140,
      rows: [{ kind: "pill" }, { kind: "tab" }, { kind: "tab" }],
    });

    expect(layout.widths).toEqual([TAB_GROUP_PILL_WIDTH, 54, 53]);
    expect(layout.positions).toEqual([0, 52, 87]);
  });
});
