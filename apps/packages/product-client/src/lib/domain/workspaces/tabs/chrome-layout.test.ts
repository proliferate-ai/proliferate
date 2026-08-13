import { describe, expect, it } from "vitest";
import {
  CHROME_DELEGATED_TAB_MAX_WIDTH,
  CHROME_TAB_MAX_WIDTH,
  CHROME_TAB_MIN_WIDTH,
  CHROME_TAB_SMALL_WIDTH,
  TAB_GROUP_PILL_WIDTH,
  computeActiveTabScrollLeft,
  computeChromeTabPositions,
  computeChromeTabWidths,
  computeHeaderStripLayout,
} from "#product/lib/domain/workspaces/tabs/chrome-layout";

describe("computeChromeTabWidths", () => {
  it("distributes available width evenly with deterministic remainder pixels", () => {
    expect(computeChromeTabWidths({
      containerWidth: 503,
      reservedWidth: 20,
      tabCount: 4,
    })).toEqual([136, 136, 136, 136]);
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

  it("positions compact tabs without visual overlap", () => {
    expect(computeChromeTabPositions([
      CHROME_TAB_MAX_WIDTH,
      CHROME_TAB_MAX_WIDTH,
      CHROME_TAB_MAX_WIDTH,
    ])).toEqual([0, 159, 318]);
  });
});

describe("computeHeaderStripLayout", () => {
  it("reserves fixed width for group pills and shares remaining width across tabs", () => {
    const layout = computeHeaderStripLayout({
      containerWidth: 400,
      rows: [{ kind: "pill" }, { kind: "tab" }, { kind: "tab" }],
    });

    expect(layout.widths).toEqual([TAB_GROUP_PILL_WIDTH, CHROME_TAB_MAX_WIDTH, CHROME_TAB_MAX_WIDTH]);
    expect(layout.positions).toEqual([0, 52, 211]);
  });

  it("does not overlap pills with adjacent tabs", () => {
    const layout = computeHeaderStripLayout({
      containerWidth: 500,
      rows: [{ kind: "tab" }, { kind: "pill" }, { kind: "tab" }],
    });

    expect(layout.widths).toEqual([CHROME_TAB_MAX_WIDTH, TAB_GROUP_PILL_WIDTH, CHROME_TAB_MAX_WIDTH]);
    expect(layout.positions).toEqual([0, 160, 212]);
  });

  it("clamps tabs to the soft squish floor when pill rows leave little room", () => {
    const layout = computeHeaderStripLayout({
      containerWidth: 140,
      rows: [{ kind: "pill" }, { kind: "tab" }, { kind: "tab" }],
    });

    expect(layout.widths).toEqual([TAB_GROUP_PILL_WIDTH, CHROME_TAB_MIN_WIDTH, CHROME_TAB_MIN_WIDTH]);
    expect(layout.positions).toEqual([0, 52, 191]);
  });

  it("overflows the container width when too many tabs would squish below the floor", () => {
    const layout = computeHeaderStripLayout({
      containerWidth: 200,
      rows: Array.from({ length: 10 }, () => ({ kind: "tab" as const })),
    });

    expect(layout.widths.every((w) => w === CHROME_TAB_MIN_WIDTH)).toBe(true);
    const last = layout.positions[layout.positions.length - 1] + layout.widths[layout.widths.length - 1];
    expect(last).toBeGreaterThan(200);
  });

  it("yields the min tab width to a narrower strip so the status badge stays in view (PRO-226)", () => {
    expect(computeHeaderStripLayout({
      containerWidth: 116,
      rows: [{ kind: "tab" }],
    }).widths).toEqual([116]);

    expect(computeHeaderStripLayout({
      containerWidth: 116,
      rows: [{ kind: "tab" }, { kind: "tab" }],
    }).widths).toEqual([116, 116]);

    // Pre-measure render (zero container) keeps the floor instead of
    // collapsing every tab to zero width.
    expect(computeHeaderStripLayout({
      containerWidth: 0,
      rows: [{ kind: "tab" }],
    }).widths).toEqual([CHROME_TAB_MIN_WIDTH]);
  });

  it("keeps a min-width tab title visible without scroll ping-pong in a narrower viewport (PRO-226)", () => {
    // Viewport narrower than one min-width tab: never scroll the title start
    // out of view, from rest or from a mid-glitch right-aligned position.
    const geometry = { tabLeft: 0, tabWidth: CHROME_TAB_MIN_WIDTH, clientWidth: 116 };
    expect(computeActiveTabScrollLeft({ ...geometry, scrollLeft: 0 })).toBeNull();
    expect(computeActiveTabScrollLeft({ ...geometry, scrollLeft: 24 })).toBe(0);

    // Second tab wider than the viewport: left-aligns once, then settles.
    const second = { tabLeft: 136, tabWidth: CHROME_TAB_MIN_WIDTH, clientWidth: 116 };
    expect(computeActiveTabScrollLeft({ ...second, scrollLeft: 0 })).toBe(136);
    expect(computeActiveTabScrollLeft({ ...second, scrollLeft: 136 })).toBeNull();
  });

  it("scrolls an overflowing tab into view when it fits the viewport", () => {
    // Right overflow aligns the tab's right edge; left overflow its left edge.
    expect(computeActiveTabScrollLeft({
      tabLeft: 200, tabWidth: 136, scrollLeft: 0, clientWidth: 240,
    })).toBe(96);
    expect(computeActiveTabScrollLeft({
      tabLeft: 40, tabWidth: 136, scrollLeft: 100, clientWidth: 240,
    })).toBe(40);
    expect(computeActiveTabScrollLeft({
      tabLeft: 40, tabWidth: 136, scrollLeft: 40, clientWidth: 240,
    })).toBeNull();
  });

  it("honors narrower max widths for delegated-agent tabs", () => {
    expect(CHROME_DELEGATED_TAB_MAX_WIDTH).toBe(CHROME_TAB_SMALL_WIDTH);

    const layout = computeHeaderStripLayout({
      containerWidth: 600,
      rows: [
        { kind: "tab" },
        { kind: "tab", maxWidth: CHROME_DELEGATED_TAB_MAX_WIDTH },
        { kind: "tab", maxWidth: CHROME_DELEGATED_TAB_MAX_WIDTH },
      ],
    });

    expect(layout.widths).toEqual([
      CHROME_TAB_MAX_WIDTH,
      CHROME_DELEGATED_TAB_MAX_WIDTH,
      CHROME_DELEGATED_TAB_MAX_WIDTH,
    ]);
  });
});
