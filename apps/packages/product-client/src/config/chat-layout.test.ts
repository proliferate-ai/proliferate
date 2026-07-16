import { describe, expect, it } from "vitest";
import {
  CHAT_SCROLL_BASE_BOTTOM_PADDING_PX,
  CHAT_SCROLL_STICKY_BOTTOM_GAP_PX,
  computeChatDockLowerBackdropTopPx,
  computeChatStableBottomInsetPx,
  computeChatSurfaceBottomInsetPx,
} from "#product/config/chat-layout";

describe("chat layout", () => {

  it("keeps the baseline padding before the dock is measured", () => {
    expect(computeChatSurfaceBottomInsetPx({
      dockHeightPx: 0,
      composerSurfaceHeightPx: 0,
      composerSurfaceOffsetTopPx: 0,
    })).toBe(CHAT_SCROLL_BASE_BOTTOM_PADDING_PX);
  });

  it("targets one third down from the top of the composer surface", () => {
    expect(computeChatSurfaceBottomInsetPx({
      dockHeightPx: 220,
      composerSurfaceHeightPx: 120,
      composerSurfaceOffsetTopPx: 80,
    })).toBe(100);
  });

  it("rounds fractional measured values upward", () => {
    expect(computeChatSurfaceBottomInsetPx({
      dockHeightPx: 220.2,
      composerSurfaceHeightPx: 120.3,
      composerSurfaceOffsetTopPx: 80.1,
    })).toBe(101);
  });

  it("starts the lower dock backdrop halfway down the composer surface", () => {
    expect(computeChatDockLowerBackdropTopPx({
      composerSurfaceHeightPx: 120,
      composerSurfaceOffsetTopPx: 80,
    })).toBe(140);
  });

  it("omits the lower dock backdrop before the composer surface is measured", () => {
    expect(computeChatDockLowerBackdropTopPx({
      composerSurfaceHeightPx: 0,
      composerSurfaceOffsetTopPx: 0,
    })).toBeNull();
  });

  it("rests the sticky gap on the measured dock height when available", () => {
    // 240 = surface metrics (224) + the dock's physical bottom padding, which
    // only the measured height captures; the gap must clear the real dock.
    expect(computeChatStableBottomInsetPx({
      dockHeightPx: 240,
      composerSurfaceHeightPx: 120,
      composerSurfaceOffsetTopPx: 80,
      composerFooterHeightPx: 24,
    })).toBe(240 + CHAT_SCROLL_STICKY_BOTTOM_GAP_PX);
  });

  it("falls back to surface metrics before the dock is measured", () => {
    expect(computeChatStableBottomInsetPx({
      composerSurfaceHeightPx: 120,
      composerSurfaceOffsetTopPx: 80,
      composerFooterHeightPx: 24,
    })).toBe(80 + 120 + 24 + CHAT_SCROLL_STICKY_BOTTOM_GAP_PX);
  });
});
