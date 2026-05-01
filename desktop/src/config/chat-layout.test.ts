import { describe, expect, it } from "vitest";
import {
  CHAT_SCROLL_BASE_BOTTOM_PADDING_PX,
  computeChatDockLowerBackdropTopPx,
  computeChatStickyBottomInsetPx,
  computeChatSurfaceBottomInsetPx,
} from "./chat-layout";

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

  it("keeps sticky transcript scrolling above the full dock", () => {
    expect(computeChatStickyBottomInsetPx(220)).toBe(260);
  });
});
