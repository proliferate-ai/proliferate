import { describe, expect, it } from "vitest";
import {
  CHAT_SEARCH_TOP,
  computeContentSearchPillSideClearance,
  FILE_OR_REVIEW_SEARCH_TOP,
  resolveContentSearchPillPlacement,
} from "#product/lib/domain/content-search/content-search-placement";

const RIGHT_PANEL_MIN_WIDTH = 380;

describe("resolveContentSearchPillPlacement", () => {
  it("places file search exactly 90px from the shell top (46px strip + 36px header + 8px gap)", () => {
    const placement = resolveContentSearchPillPlacement({
      surface: "file",
      rightPanelOpen: true,
      rightPanelWidth: 420,
      rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH,
    });
    expect(placement.top).toBe(90);
    expect(FILE_OR_REVIEW_SEARCH_TOP).toBe(90);
  });

  it("places review search at the same 90px offset as file", () => {
    const placement = resolveContentSearchPillPlacement({
      surface: "review",
      rightPanelOpen: true,
      rightPanelWidth: 500,
      rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH,
    });
    expect(placement.top).toBe(90);
  });

  it("insets file/review 16px from the content edge regardless of rail width (content already flush to shell edge)", () => {
    const narrow = resolveContentSearchPillPlacement({
      surface: "file",
      rightPanelOpen: true,
      rightPanelWidth: RIGHT_PANEL_MIN_WIDTH,
      rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH,
    });
    const wide = resolveContentSearchPillPlacement({
      surface: "review",
      rightPanelOpen: true,
      rightPanelWidth: 900,
      rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH,
    });
    expect(narrow.right).toBe(16);
    expect(wide.right).toBe(16);
  });

  it("places chat 8px below the 46px shell strip (no owned sub-header)", () => {
    const placement = resolveContentSearchPillPlacement({
      surface: "chat",
      rightPanelOpen: false,
      rightPanelWidth: 0,
      rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH,
    });
    expect(placement.top).toBe(54);
    expect(CHAT_SEARCH_TOP).toBe(54);
  });

  it("chat insets 16px from the main-content edge, adding the effective right rail width when the rail is open", () => {
    const railClosed = resolveContentSearchPillPlacement({
      surface: "chat",
      rightPanelOpen: false,
      rightPanelWidth: 420,
      rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH,
    });
    const railOpenAtFloor = resolveContentSearchPillPlacement({
      surface: "chat",
      rightPanelOpen: true,
      rightPanelWidth: 200,
      rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH,
    });
    const railOpenWide = resolveContentSearchPillPlacement({
      surface: "chat",
      rightPanelOpen: true,
      rightPanelWidth: 500,
      rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH,
    });
    expect(railClosed.right).toBe(16);
    // Rail width is clamped up to its own floor even if raw state reports narrower.
    expect(railOpenAtFloor.right).toBe(16 + RIGHT_PANEL_MIN_WIDTH);
    expect(railOpenWide.right).toBe(16 + 500);
  });

  it("never overlaps the 46px tab strip or 36px owned header (top offsets exceed both)", () => {
    const chat = resolveContentSearchPillPlacement({
      surface: "chat",
      rightPanelOpen: false,
      rightPanelWidth: 0,
      rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH,
    });
    const file = resolveContentSearchPillPlacement({
      surface: "file",
      rightPanelOpen: true,
      rightPanelWidth: RIGHT_PANEL_MIN_WIDTH,
      rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH,
    });
    expect(chat.top).toBeGreaterThanOrEqual(46);
    expect(file.top).toBeGreaterThanOrEqual(46 + 36);
  });
});

describe("computeContentSearchPillSideClearance", () => {
  it("keeps at least 16px clearance for the ~340px pill at the 380px right-panel content floor", () => {
    const clearance = computeContentSearchPillSideClearance(RIGHT_PANEL_MIN_WIDTH, 340, 16);
    expect(clearance).toBeGreaterThanOrEqual(16);
    expect(clearance).toBe(24);
  });
});
